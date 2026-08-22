// ── Pipeline de imagen ────────────────────────────────────────────────────────
// Decodificación → remoción de fondo (IA) → refinado de máscara alfa →
// recorte por límites reales → reescalado progresivo → codificación adaptativa.

// Resolución máxima de trabajo. Reduce antes de refinar la máscara para acotar
// el costo de los pases por píxel, manteniendo el doble del detalle final.
const MAX_WORK_SIZE = 2400;

// ── Carga perezosa de @imgly/background-removal ───────────────────────────────
let imglyModule = null;
let gpuUnavailable = false;

async function loadImglyBackgroundRemoval() {
  if (imglyModule) return imglyModule;
  try {
    const pkg = await import("@imgly/background-removal");
    const fn =
      pkg.removeBackground ||
      (typeof pkg.default === "function" ? pkg.default : null) ||
      (typeof pkg === "function" ? pkg : null) ||
      pkg.default?.removeBackground;
    if (!fn) throw new Error("No se encontró la función removeBackground en el módulo");
    imglyModule = fn;
    return imglyModule;
  } catch (err) {
    throw new Error(`No se pudo cargar @imgly/background-removal: ${err.message}`, { cause: err });
  }
}

async function hasWebGPU() {
  if (gpuUnavailable || !navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) return true;
  } catch { /* sin WebGPU */ }
  gpuUnavailable = true;
  return false;
}

// ── Utilidades de canvas ──────────────────────────────────────────────────────
function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function ctx2d(canvas, opts) {
  return canvas.getContext("2d", opts);
}

// Reescalado progresivo: reduce a la mitad hasta acercarse al destino y luego
// hace el paso final. Un solo drawImage de 4000px a 1100px produce aliasing
// incluso con imageSmoothingQuality "high"; el halving lo evita.
function smoothResize(source, sx, sy, sw, sh, dw, dh) {
  let current = makeCanvas(Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
  let c = ctx2d(current);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.drawImage(source, sx, sy, sw, sh, 0, 0, current.width, current.height);

  while (current.width > dw * 2 && current.height > dh * 2) {
    const next = makeCanvas(Math.max(1, Math.round(current.width / 2)), Math.max(1, Math.round(current.height / 2)));
    const nc = ctx2d(next);
    nc.imageSmoothingEnabled = true;
    nc.imageSmoothingQuality = "high";
    nc.drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }

  if (current.width === dw && current.height === dh) return current;

  const out = makeCanvas(dw, dh);
  const oc = ctx2d(out);
  oc.imageSmoothingEnabled = true;
  oc.imageSmoothingQuality = "high";
  oc.drawImage(current, 0, 0, dw, dh);
  return out;
}

// ── Decodificación ────────────────────────────────────────────────────────────
// createImageBitmap respeta la orientación EXIF (las fotos de celular ya no
// salen rotadas) y evita el data URL intermedio que duplicaba memoria.
async function decodeToCanvas(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Error decodificando imagen")); };
      img.src = url;
    });
  }

  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;
  if (!width || !height) throw new Error("Imagen sin dimensiones válidas");

  const scale = Math.min(1, MAX_WORK_SIZE / Math.max(width, height));
  const canvas =
    scale < 1
      ? smoothResize(bitmap, 0, 0, width, height, Math.round(width * scale), Math.round(height * scale))
      : (() => {
          const c = makeCanvas(width, height);
          ctx2d(c).drawImage(bitmap, 0, 0);
          return c;
        })();

  bitmap.close?.();
  return { canvas, sourceWidth: width, sourceHeight: height };
}

// ── Refinado de máscara alfa ──────────────────────────────────────────────────
// El modelo de segmentación deja un halo semitransparente con el color del
// fondo original alrededor del objeto. Tres correcciones:
//   1. Curva de niveles sobre alfa: elimina el halo débil, conserva el
//      antialiasing legítimo del borde.
//   2. Filtro de componentes: descarta manchas sueltas lejos del objeto.
//   3. Despill: reemplaza el RGB contaminado del borde por el color del píxel
//      opaco más cercano, para que no quede un contorno del fondo viejo.

const LEVELS_LO = 0.10;
const LEVELS_HI = 0.92;

function applyAlphaLevels(data) {
  const lut = new Uint8Array(256);
  for (let a = 0; a < 256; a++) {
    const n = (a / 255 - LEVELS_LO) / (LEVELS_HI - LEVELS_LO);
    lut[a] = n <= 0 ? 0 : n >= 1 ? 255 : Math.round(n * 255);
  }
  for (let i = 3; i < data.length; i += 4) data[i] = lut[data[i]];
}

// Etiquetado de componentes sobre una máscara reducida (máx 256 px de lado).
// Conserva sólo los componentes con área >= minRatio del mayor; el resto se
// descarta. Elimina los blobs fantasma del modelo y las motas de suciedad que
// de otro modo secuestran el recorte.
function componentKeepCells(mask, width, height, minRatio) {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 256));
  const mw = Math.ceil(width / step);
  const mh = Math.ceil(height / step);
  const small = new Uint8Array(mw * mh);

  // Muestreo por bloque: la celda se marca si algún píxel del bloque pertenece
  // al objeto. Muestrear sólo la esquina perdía objetos delgados.
  for (let y = 0; y < height; y++) {
    const my = (y / step) | 0;
    const rowBase = my * mw;
    const src = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[src + x]) small[rowBase + ((x / step) | 0)] = 1;
    }
  }

  const labels = new Int32Array(mw * mh).fill(-1);
  const areas = [];
  const stack = new Int32Array(mw * mh);

  for (let start = 0; start < small.length; start++) {
    if (!small[start] || labels[start] !== -1) continue;
    const label = areas.length;
    let area = 0;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    while (sp > 0) {
      const idx = stack[--sp];
      area++;
      const x = idx % mw;
      const y = (idx / mw) | 0;
      if (x > 0)      { const n = idx - 1;  if (small[n] && labels[n] === -1) { labels[n] = label; stack[sp++] = n; } }
      if (x < mw - 1) { const n = idx + 1;  if (small[n] && labels[n] === -1) { labels[n] = label; stack[sp++] = n; } }
      if (y > 0)      { const n = idx - mw; if (small[n] && labels[n] === -1) { labels[n] = label; stack[sp++] = n; } }
      if (y < mh - 1) { const n = idx + mw; if (small[n] && labels[n] === -1) { labels[n] = label; stack[sp++] = n; } }
    }
    areas.push(area);
  }

  if (areas.length <= 1) return null; // nada que descartar

  const maxArea = Math.max(...areas);
  const keepLabel = areas.map(a => (a >= maxArea * minRatio ? 1 : 0));
  if (keepLabel.every(k => k === 1)) return null;

  // Celdas a conservar, dilatadas un anillo. Sin la dilatación, el borde
  // suavizado del objeto (que cae en celdas muestreadas como fondo) se
  // recortaría junto con las manchas, comiéndose hasta un paso completo.
  const keepCell = new Uint8Array(mw * mh);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label !== -1 && keepLabel[label]) keepCell[i] = 1;
  }
  const dilated = new Uint8Array(keepCell);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (!keepCell[y * mw + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
          dilated[ny * mw + nx] = 1;
        }
      }
    }
  }
  return { keepCell: dilated, mw, mh, step };
}

function applyComponentFilter(data, width, height, minRatio) {
  const mask = new Uint8Array(width * height);
  for (let p = 0, i = 3; p < mask.length; p++, i += 4) mask[p] = data[i] >= 128 ? 1 : 0;

  const built = componentKeepCells(mask, width, height, minRatio);
  if (!built) return;
  const { keepCell, mw, step } = built;

  for (let y = 0; y < height; y++) {
    const rowBase = ((y / step) | 0) * mw;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) continue;
      if (!keepCell[rowBase + ((x / step) | 0)]) {
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 0;
      }
    }
  }
}

// Propaga el color de los píxeles opacos hacia la banda semitransparente, de
// modo que el borde no conserve el tinte del fondo que se acaba de quitar.
const DESPILL_PASSES = 3;
const OPAQUE_MIN = 250;

function applyDespill(data, width, height) {
  // solid[p] = el píxel p tiene color confiable (opaco, o ya corregido)
  const solid = new Uint8Array(width * height);
  for (let p = 0, i = 3; p < solid.length; p++, i += 4) {
    solid[p] = data[i] >= OPAQUE_MIN ? 1 : 0;
  }

  const neighbors = [-1, 1, -width, width];
  for (let pass = 0; pass < DESPILL_PASSES; pass++) {
    const added = [];
    for (let p = 0; p < solid.length; p++) {
      if (solid[p]) continue;
      const idx = p * 4;
      if (data[idx + 3] === 0) continue; // transparente puro: no se ve
      const x = p % width;
      let r = 0, g = 0, b = 0, count = 0;
      for (let n = 0; n < 4; n++) {
        if (n === 0 && x === 0) continue;
        if (n === 1 && x === width - 1) continue;
        const q = p + neighbors[n];
        if (q < 0 || q >= solid.length || !solid[q]) continue;
        const qi = q * 4;
        r += data[qi]; g += data[qi + 1]; b += data[qi + 2]; count++;
      }
      if (count === 0) continue;
      data[idx] = (r / count) | 0;
      data[idx + 1] = (g / count) | 0;
      data[idx + 2] = (b / count) | 0;
      added.push(p);
    }
    if (added.length === 0) break;
    for (const p of added) solid[p] = 1;
  }
}

function refineMatte(canvas, { componentFilter = true, despill = true } = {}) {
  const c = ctx2d(canvas, { willReadFrequently: true });
  const imageData = c.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  applyAlphaLevels(data);
  if (componentFilter) applyComponentFilter(data, canvas.width, canvas.height, 0.02);
  if (despill) applyDespill(data, canvas.width, canvas.height);

  c.putImageData(imageData, 0, 0);
  return imageData;
}

// ── Detección de límites ──────────────────────────────────────────────────────
// Construye la máscara del objeto, descarta los componentes insignificantes
// (motas, polvo, un reflejo suelto) y luego proyecta filas y columnas. Fijar el
// recorte con min/max por píxel dejaba que una sola mota arruinara el encuadre.
const BOUNDS_ALPHA_MIN = 16;
const BOUNDS_COMPONENT_RATIO = 0.05;

export function detectObjectBounds(canvas, bgRemoved, imageData) {
  const width = canvas.width;
  const height = canvas.height;
  const data = (imageData || ctx2d(canvas, { willReadFrequently: true }).getImageData(0, 0, width, height)).data;

  const mask = new Uint8Array(width * height);
  let total = 0;
  for (let p = 0, idx = 0; p < mask.length; p++, idx += 4) {
    const a = data[idx + 3];
    let isObject;
    if (bgRemoved) {
      isObject = a >= BOUNDS_ALPHA_MIN;
    } else {
      // Sin remoción de fondo: descarta el blanco de estudio, pero exige que
      // los tres canales estén cerca del blanco para no comer productos claros.
      isObject = a >= BOUNDS_ALPHA_MIN && (data[idx] < 244 || data[idx + 1] < 244 || data[idx + 2] < 244);
    }
    if (isObject) { mask[p] = 1; total++; }
  }

  if (total < 100) return { x: 0, y: 0, width, height };

  const built = componentKeepCells(mask, width, height, BOUNDS_COMPONENT_RATIO);
  if (built) {
    const { keepCell, mw, step } = built;
    for (let y = 0; y < height; y++) {
      const rowBase = ((y / step) | 0) * mw;
      const src = y * width;
      for (let x = 0; x < width; x++) {
        if (mask[src + x] && !keepCell[rowBase + ((x / step) | 0)]) mask[src + x] = 0;
      }
    }
  }

  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  let kept = 0;
  for (let y = 0; y < height; y++) {
    const src = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[src + x]) { rows[y]++; cols[x]++; kept++; }
    }
  }
  if (kept < 100) return { x: 0, y: 0, width, height };

  const scan = arr => {
    let lo = 0, hi = arr.length - 1;
    while (lo < arr.length && arr[lo] === 0) lo++;
    while (hi > lo && arr[hi] === 0) hi--;
    return [lo, hi];
  };
  const [minY, maxY] = scan(rows);
  const [minX, maxX] = scan(cols);
  if (maxY < minY || maxX < minX) return { x: 0, y: 0, width, height };

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// ── Enfoque (unsharp mask) ────────────────────────────────────────────────────
// Compensa el ablandamiento del reescalado. Sólo toca RGB, nunca alfa, para no
// reintroducir bordes duros en la máscara.
export function applyUnsharp(canvas, amount = 0.35) {
  if (amount <= 0) return;
  const c = ctx2d(canvas, { willReadFrequently: true });
  const imageData = c.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;
  const original = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      if (original[idx + 3] < 8) continue;
      for (let ch = 0; ch < 3; ch++) {
        const p = idx + ch;
        const blur =
          (original[p - width * 4 - 4] + original[p - width * 4] + original[p - width * 4 + 4] +
           original[p - 4]             + original[p]             + original[p + 4] +
           original[p + width * 4 - 4] + original[p + width * 4] + original[p + width * 4 + 4]) / 9;
        data[p] = original[p] + amount * (original[p] - blur);
      }
    }
  }
  c.putImageData(imageData, 0, 0);
}

// ── Codificación adaptativa ───────────────────────────────────────────────────
function encode(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error(`Canvas toBlob falló para ${type}`))),
      type,
      quality
    );
  });
}

/**
 * Codifica a WebP buscando el archivo más liviano que respete el objetivo de
 * peso. Si `targetBytes` es null usa la calidad pedida tal cual.
 * Búsqueda binaria: ~5 codificaciones, converge a ±2% del objetivo.
 */
export async function compressImage(canvas, quality, targetBytes = null, minQuality = 0.45) {
  const first = await encode(canvas, "image/webp", quality);
  if (!targetBytes || first.size <= targetBytes) return { blob: first, quality };

  let lo = minQuality;
  let hi = quality;
  let best = first;
  let bestQ = quality;

  for (let i = 0; i < 5 && hi - lo > 0.02; i++) {
    const mid = (lo + hi) / 2;
    const blob = await encode(canvas, "image/webp", mid);
    if (blob.size <= targetBytes) {
      best = blob; bestQ = mid; lo = mid; // cabe: intenta subir calidad
    } else {
      hi = mid;
    }
    if (best.size > targetBytes && blob.size < best.size) { best = blob; bestQ = mid; }
  }
  return { blob: best, quality: bestQ };
}

// ── Proceso completo ──────────────────────────────────────────────────────────
/**
 * @param {File} file
 * @param {object} options
 * @param {boolean} options.enableBgRemoval
 * @param {boolean} options.preserveBackground  conserva fondo y encuadre original
 * @param {number}  options.paddingPct          margen sobre el lienzo final
 * @param {number}  options.outputSize          lado del lienzo cuadrado
 * @param {number}  options.sharpen             0 = sin enfoque
 * @param {boolean} options.highPrecision       usa el modelo isnet completo
 * @param {(pct:number)=>void} options.onModelProgress
 */
export async function processImage(file, options) {
  const {
    enableBgRemoval,
    preserveBackground = false,
    paddingPct = 6,
    outputSize = 1200,
    sharpen = 0.35,
    highPrecision = true,
    onModelProgress,
  } = options;

  const doBgRemoval = enableBgRemoval && !preserveBackground;

  let working;
  let sourceWidth;
  let sourceHeight;
  let bgRemoved = false;
  let bgRemovedError = null;
  let matteData = null;

  if (doBgRemoval) {
    try {
      const removeBackground = await loadImglyBackgroundRemoval();
      const useGpu = await hasWebGPU();
      const blob = await removeBackground(file, {
        // isnet completo: matiz de borde notablemente más limpio que los
        // cuantizados por defecto, a cambio de un modelo más pesado.
        model: highPrecision ? "isnet" : "isnet_fp16",
        device: useGpu ? "gpu" : "cpu",
        output: { format: "image/png", quality: 1 },
        progress: (key, current, total) => {
          if (key.includes("fetch") && total && onModelProgress) {
            onModelProgress(Math.round((current / total) * 100));
          }
        },
      });
      onModelProgress?.(100);
      const decoded = await decodeToCanvas(blob);
      working = decoded.canvas;
      sourceWidth = decoded.sourceWidth;
      sourceHeight = decoded.sourceHeight;
      bgRemoved = true;
      matteData = refineMatte(working);
    } catch (bgErr) {
      console.warn(`Fallo remoción de fondo: ${bgErr.message}`);
      bgRemovedError = bgErr.message;
    }
  }

  if (!working) {
    const decoded = await decodeToCanvas(file);
    working = decoded.canvas;
    sourceWidth = decoded.sourceWidth;
    sourceHeight = decoded.sourceHeight;
  }

  const bounds = preserveBackground
    ? { x: 0, y: 0, width: working.width, height: working.height }
    : detectObjectBounds(working, bgRemoved, bgRemoved ? matteData : null);

  const padding = Math.round((paddingPct / 100) * outputSize);
  const contentSize = outputSize - padding * 2;
  const objAspect = bounds.width / bounds.height;

  let drawWidth, drawHeight;
  if (objAspect > 1) {
    drawWidth = contentSize;
    drawHeight = contentSize / objAspect;
  } else {
    drawHeight = contentSize;
    drawWidth = contentSize * objAspect;
  }

  // Nunca ampliar por encima del recorte real: subir escala sólo agrega peso y
  // desenfoque sin aportar detalle.
  const upscale = Math.max(drawWidth / bounds.width, drawHeight / bounds.height);
  if (upscale > 1) {
    drawWidth /= upscale;
    drawHeight /= upscale;
  }
  drawWidth = Math.max(1, Math.round(drawWidth));
  drawHeight = Math.max(1, Math.round(drawHeight));

  const scaled = smoothResize(working, bounds.x, bounds.y, bounds.width, bounds.height, drawWidth, drawHeight);
  if (sharpen > 0) applyUnsharp(scaled, sharpen);

  const outputCanvas = makeCanvas(outputSize, outputSize);
  const outCtx = ctx2d(outputCanvas);
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(
    scaled,
    Math.round((outputSize - drawWidth) / 2),
    Math.round((outputSize - drawHeight) / 2)
  );

  return {
    canvas: outputCanvas,
    width: outputSize,
    height: outputSize,
    sourceWidth,
    sourceHeight,
    bgRemoved,
    bgRemovedError,
  };
}
