import { useState, useRef, useEffect } from "react";
import { Upload, X, Settings2, Download, Archive, Info, FileText, Image as ImageIcon, Sparkles, AlertCircle, Check, AlertTriangle } from "lucide-react";

// ── Constantes ────────────────────────────────────────────────────────────────
const CATEGORIES = ["Alcancias", "Cajas y Empaques", "Porta Llaves", "Portarretratos", "Temporada", "Varios"];
const MATERIALS  = [
  { key:"pino",               label:"Pino" },
  { key:"mdf",                label:"MDF" },
  { key:"vinilo",             label:"Vinilo adhesivo" },
  { key:"propalcote",         label:"Propalcote" },
  { key:"propalcoteAdhesivo", label:"Propalcote Adhesivo" },
  { key:"cristal",            label:"Cristal plástico" },
];
const MATERIAL_SLUG = {
  pino:"pino", mdf:"mdf", vinilo:"vinilo",
  propalcote:"propalcote", propalcoteAdhesivo:"propalcote-adhesivo", cristal:"cristal"
};
const CAT_KW = {
  "Alcancias":       "alcancia en madera, alcancia personalizada, regalo para ninos, decoracion infantil, alcancia decorativa, alcancia mdf, caja de ahorro decorativa",
  "Cajas y Empaques":"base para ancheta, base de regalo, base personalizada, ancheta artesanal, empaques personalizados, base de madera pino, regalo especial",
  "Porta Llaves":    "portallaves de madera, organizador de llaves, portallaves decorativo, portallaves artesanal, colgador de llaves, regalo para casa nueva",
  "Portarretratos":  "portarretratos en madera, marco de fotos, portafoto personalizado, portarretrato decorativo, regalo con foto, marco artesanal, decoracion del hogar",
  "Temporada":       "decoracion navidena, articulos de navidad, adornos en madera, decoracion de temporada, regalo navideno artesanal, articulos de temporada, regalos colombianos",
  "Varios":          "accesorios decorativos, articulos decorativos, decoracion artesanal, productos decorativos, regalo decorativo",
};
const BASE_KW = "bonetto con amor, productos en madera, regalos personalizados, decoracion artesanal, hechos en colombia, emprendimientos colombianos";

const QUALITY_PRESETS = {
  alta:     { label:"Alta calidad",    webpQ:0.88, desc:"Mínima pérdida visual" },
  media:    { label:"Balanceada ★",    webpQ:0.78, desc:"Mejor balance peso/calidad" },
  agresiva: { label:"Máx. compresión", webpQ:0.65, desc:"Archivos más pequeños" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalize = t =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
   .replace(/[^a-z0-9\s]/g,"").trim().replace(/\s+/g,"-");

const fmtBytes = b => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(2)} MB`;

function buildMeta(productName, productRef, category, matText, index, total, addBonetto, addNum) {
  const slug       = normalize(productName);
  const catSlg     = normalize(category);
  const refPart    = productRef ? `ref-${productRef}-` : "";
  const bonettoSfx = addBonetto ? "-bonetto" : "";
  const numSfx     = (addNum || total > 1) ? `-${String(index+1).padStart(3,"0")}` : "";
  const newName    = `${refPart}${slug}-${catSlg}-${matText}${bonettoSfx}${numSfx}.webp`;
  const altText    = `${productName.toLowerCase()} en madera ${matText} hecho a mano bonetto con amor colombia`.substring(0,125);
  const title      = `${productName} en ${matText.toUpperCase()} | Bonetto con Amor`;
  const caption    = `${productName} artesanal en madera ${matText} — Bonetto con Amor, hecho en Colombia`;
  const desc       = `${productName} elaborado en madera ${matText}. Producto artesanal y personalizado de Bonetto con Amor. Fabricado en Colombia. Ideal como regalo o articulo decorativo para ${category.toLowerCase()}.`;
  const kwList     = [...BASE_KW.split(", "), ...CAT_KW[category].split(", ").slice(0,6), `madera ${matText}`].slice(0,13);
  return { newName, altText, title, caption, description: desc, keywords: kwList.join(", "), copyright:"© Bonetto con Amor - Colombia" };
}

// ── Remoción de Fondo & Procesamiento ─────────────────────────────────────────
let imglyModule = null;

async function loadImglyBackgroundRemoval() {
  if (imglyModule) return imglyModule;
  try {
    const pkg = await import("@imgly/background-removal");
    if (pkg.removeBackground) {
      imglyModule = pkg.removeBackground;
    } else if (typeof pkg.default === "function") {
      imglyModule = pkg.default;
    } else if (typeof pkg === "function") {
      imglyModule = pkg;
    } else if (pkg.default && pkg.default.removeBackground) {
      imglyModule = pkg.default.removeBackground;
    } else {
      throw new Error("No se encontró la función removeBackground en el módulo");
    }
    return imglyModule;
  } catch (err) {
    throw new Error(`No se pudo cargar @imgly/background-removal: ${err.message}`);
  }
}

function detectObjectBounds(canvas, bgRemoved) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  let minX = canvas.width, maxX = 0, minY = canvas.height, maxY = 0;
  let pixelCount = 0;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    let isObject = false;
    if (bgRemoved) {
      // Si se removió el fondo, el fondo es completamente transparente. Todo lo demás (a > 10) es el objeto.
      isObject = a > 10;
    } else {
      // Fallback: Detectar píxeles que no son blancos puros y que no son transparentes.
      isObject = a > 10 && (r < 250 || g < 250 || b < 250);
    }
    
    if (isObject) {
      const pixelIdx = i / 4;
      const x = pixelIdx % canvas.width;
      const y = Math.floor(pixelIdx / canvas.width);
      
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      pixelCount++;
    }
  }
  
  if (maxX < minX || maxY < minY || pixelCount < 100) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function processImageTo1200(file, enableBgRemoval, paddingPct, setDownloadProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const originalCanvas = document.createElement("canvas");
          originalCanvas.width = img.width;
          originalCanvas.height = img.height;
          const ctx = originalCanvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          
          let processedCanvas = originalCanvas;
          let bgRemoved = false;
          let bgRemovedError = null;
          
          if (enableBgRemoval) {
            try {
              const removeBackground = await loadImglyBackgroundRemoval();
              
              // El config nos permite reportar el progreso si los modelos se están descargando.
              const config = {
                progress: (key, current, total) => {
                  if (key.includes("fetch") && total && setDownloadProgress) {
                     setDownloadProgress(Math.round((current / total) * 100));
                  }
                }
              };
              
              // Pasamos el archivo directamente para evitar incompatibilidades con canvas en el SDK
              const blob = await removeBackground(file, config);
              if (setDownloadProgress) setDownloadProgress(100);
              
              const bgRemovedImg = new Image();
              bgRemovedImg.src = URL.createObjectURL(blob);
              await new Promise((res, rej) => {
                bgRemovedImg.onload = res;
                bgRemovedImg.onerror = () => rej(new Error("Error decodificando el resultado transparente"));
              });
              
              const bgRemovedCanvas = document.createElement("canvas");
              bgRemovedCanvas.width = bgRemovedImg.width;
              bgRemovedCanvas.height = bgRemovedImg.height;
              bgRemovedCanvas.getContext("2d").drawImage(bgRemovedImg, 0, 0);
              
              processedCanvas = bgRemovedCanvas;
              bgRemoved = true;
              URL.revokeObjectURL(bgRemovedImg.src);
            } catch (bgErr) {
              console.warn(`Fallo remoción de fondo: ${bgErr.message}`);
              bgRemovedError = bgErr.message;
            }
          }
          
          const bounds = detectObjectBounds(processedCanvas, bgRemoved);
          
          // ── Requerimiento: EXACTAMENTE 1200x1200px con fondo BLANCO ──
          const outputSize = 1200;
          const padding = Math.round((paddingPct / 100) * outputSize);
          const contentSize = outputSize - (padding * 2);
          
          const outputCanvas = document.createElement("canvas");
          outputCanvas.width = outputSize;
          outputCanvas.height = outputSize;
          const outCtx = outputCanvas.getContext("2d");
          
          // Fondo blanco sólido
          outCtx.fillStyle = "#ffffff";
          outCtx.fillRect(0, 0, outputSize, outputSize);
          
          // Centrado manteniendo el aspect ratio del recorte
          const objAspect = bounds.width / bounds.height;
          let drawWidth, drawHeight;
          if (objAspect > 1) {
            drawWidth = contentSize;
            drawHeight = contentSize / objAspect;
          } else {
            drawHeight = contentSize;
            drawWidth = contentSize * objAspect;
          }
          
          const x = padding + (contentSize - drawWidth) / 2;
          const y = padding + (contentSize - drawHeight) / 2;
          
          // Suavizado premium
          outCtx.imageSmoothingEnabled = true;
          outCtx.imageSmoothingQuality = "high";
          
          outCtx.drawImage(
            processedCanvas,
            bounds.x, bounds.y, bounds.width, bounds.height,
            x, y, drawWidth, drawHeight
          );
          
          resolve({ canvas: outputCanvas, width: outputSize, height: outputSize, bgRemoved, bgRemovedError });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("Error decodificando imagen"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Error leyendo archivo"));
    reader.readAsDataURL(file);
  });
}

function compressImage(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve({ blob });
      else reject(new Error("Canvas toBlob falló"));
    }, "image/webp", quality);
  });
}

// ── JSZip Loader ──────────────────────────────────────────────────────────────
async function getJSZip() {
  if (window.JSZip) return window.JSZip;
  try {
    const pkg = await import("jszip");
    return pkg.default || pkg;
  } catch (e) {
    throw new Error("No se pudo cargar jszip");
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function ResultPreview({ blob, alt }) {
  const [url, setUrl] = useState("");
  
  useEffect(() => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  
  if (!url) {
    return <div className="result-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", color: "var(--text-muted)" }}>...</div>;
  }
  return <img src={url} alt={alt} className="result-thumb" />;
}

// ── App Component ─────────────────────────────────────────────────────────────
export default function App() {
  const [productName, setProductName] = useState("");
  const [productRef,  setProductRef]  = useState("");
  const [category,    setCategory]    = useState("Temporada");
  const [mats, setMats] = useState({pino:true,mdf:true,vinilo:true,propalcote:true,propalcoteAdhesivo:true,cristal:true});
  
  const [addBonetto, setAddBonetto] = useState(true);
  const [addNum,     setAddNum]     = useState(true);
  const [enableBgRemoval, setEnableBgRemoval] = useState(true);
  const [paddingPct, setPaddingPct] = useState(6);
  const [qualityKey, setQualityKey] = useState("media");
  
  const [files,    setFiles]    = useState([]);
  const [results,  setResults]  = useState([]);
  
  const [phase,    setPhase]    = useState("idle");
  const [progress, setProgress] = useState(0);
  const [progLabel,setProgLabel]= useState("");
  const [modelProgress, setModelProgress] = useState(null);
  
  const [error,    setError]    = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const selectedMats = MATERIALS.filter(m => mats[m.key]);
  const matText = selectedMats.length === 1 ? MATERIAL_SLUG[selectedMats[0].key] : "madera";
  const preset  = QUALITY_PRESETS[qualityKey];

  const addFiles = fs => {
    const imgs = Array.from(fs).filter(f => f.type.startsWith("image/"));
    if (imgs.length === 0) {
      setError("No se detectaron archivos de imagen válidos");
      return;
    }
    setFiles(prev => [...prev, ...imgs].slice(0, 20));
    setResults([]); setPhase("idle"); setProgress(0); setError("");
  };

  const processImages = async () => {
    if (!productName.trim() || files.length===0) {
      setError("Ingresa un nombre de producto y carga imágenes."); return;
    }
    
    setPhase("processing"); setProgress(0); setResults([]); setError(""); setModelProgress(null);
    const out = [];
    let failedCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      setProgLabel(`Analizando imagen ${i+1}/${files.length}…`);
      try {
        const { canvas, bgRemoved, bgRemovedError } = await processImageTo1200(
          files[i], enableBgRemoval, paddingPct, 
          (p) => { if(enableBgRemoval && i===0) { setProgLabel("Descargando IA de visión…"); setModelProgress(p); } }
        );
        setModelProgress(null);
        setProgLabel(`Comprimiendo WebP ${i+1}/${files.length}…`);
        
        const { blob } = await compressImage(canvas, preset.webpQ);
        const meta = buildMeta(productName.trim(), productRef.trim(), category, matText, i, files.length, addBonetto, addNum);
        
        out.push({
          file: files[i], compressedBlob: blob, originalName: files[i].name,
          originalSize: files[i].size, compressedSize: blob.size,
          dimensions: "1200×1200px", bgRemoved, bgRemovedError, ...meta
        });
      } catch(err) {
        console.error(err);
        failedCount++;
      }
      setProgress(Math.round(((i+1)/files.length)*100));
    }
    
    if (out.length === 0) {
      setError("No se pudieron procesar imágenes. Revisa la consola.");
      setPhase("idle"); return;
    }
    
    setResults(out); setPhase("done"); setProgLabel("");
    if (failedCount > 0) setError(`⚠️ ${failedCount} imágenes fallaron.`);
  };

  const downloadZip = async () => {
    setPhase("zipping"); setProgress(0); setProgLabel("Empaquetando ZIP…");
    try {
      const JSZip = await getJSZip();
      const zip = new JSZip();
      for (let i = 0; i < results.length; i++) {
        zip.file(results[i].newName, await results[i].compressedBlob.arrayBuffer());
        setProgress(Math.round(((i+1)/results.length)*70));
      }
      const blob = await zip.generateAsync({ type:"blob", compression:"DEFLATE", compressionOptions:{level:6} },
        meta => setProgress(70 + Math.round(meta.percent*0.3))
      );
      triggerDownload(blob, `imagenes-${normalize(productName)}.zip`);
      setPhase("done"); setProgress(100);
    } catch(err) {
      setError(err.message); setPhase("done");
    }
  };

  const downloadCSV = () => {
    const esc = v => `"${String(v).replace(/"/g,'""')}"`;
    const heads = ["archivo_original","archivo_nuevo","tamaño_original","tamaño_comprimido","dimensiones","IA_recorte","alt_text","title","caption","description","keywords","copyright"];
    const rows  = results.map(r => [
      r.originalName, r.newName, fmtBytes(r.originalSize), fmtBytes(r.compressedSize), r.dimensions, r.bgRemoved?"Si":"No",
      r.altText, r.title, r.caption, r.description, r.keywords, r.copyright
    ].map(esc).join(","));
    triggerDownload(new Blob(["\uFEFF"+[heads.join(","),...rows].join("\n")],{type:"text/csv;charset=utf-8"}), `seo-${normalize(productName)}.csv`);
  };

  const isProcessing = phase==="processing" || phase==="zipping";
  const previewName = productName ? `${productRef?`ref-${productRef}-`:""}${normalize(productName)||"…"}-${normalize(category)}-${matText}${addBonetto?"-bonetto":""}${addNum?"-001":""}.webp` : null;
  const totalSavings = results.reduce((s,r)=>s+r.originalSize,0) > 0 ? Math.round((1 - results.reduce((s,r)=>s+r.compressedSize,0)/results.reduce((s,r)=>s+r.originalSize,0))*100) : 0;

  return (
    <div className="app-container">
      <div style={{ textAlign: "center", marginBottom: "40px" }} className="animate-fade-in">
        <h1 style={{ fontSize: "2.5rem", color: "var(--primary)", marginBottom: "8px", display:"flex", alignItems:"center", justifyContent:"center", gap:"12px" }}>
          <Sparkles size={32} /> Optimizador Bonetto
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>
          Recorte por IA · 1200x1200px · Optimización WebP y SEO
        </p>
      </div>

      {error && phase !== "done" && (
        <div className="glass-card animate-fade-in" style={{ borderColor: "var(--danger)", background: "rgba(254, 226, 226, 0.9)" }}>
          <div style={{ color: "var(--danger)", display:"flex", gap:"8px", fontWeight:600 }}><AlertCircle/> {error}</div>
        </div>
      )}

      <div className="glass-card animate-fade-in" style={{animationDelay:"0.1s"}}>
        <h2 className="card-title"><Settings2 size={22}/> Detalles del Producto</h2>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"20px", marginBottom:"20px" }}>
          <div>
            <label className="input-label">Nombre del Producto</label>
            <input className="input-field" value={productName} onChange={e=>setProductName(e.target.value)} placeholder="Ej: Árbol de la Vida" />
          </div>
          <div>
            <label className="input-label">Referencia (REF)</label>
            <input className="input-field" value={productRef} onChange={e=>setProductRef(e.target.value)} placeholder="Opcional" />
          </div>
        </div>

        <div style={{ marginBottom:"20px" }}>
          <label className="input-label">Categoría Principal</label>
          <select className="input-field" value={category} onChange={e=>setCategory(e.target.value)}>
            {CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>

        <label className="input-label" style={{marginTop:"24px"}}>Materiales (se combinan en la descripción)</label>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:"12px", marginTop:"10px", marginBottom:"24px" }}>
          {MATERIALS.map(m=>(
            <label key={m.key} className="checkbox-row">
              <input type="checkbox" className="checkbox-input" checked={mats[m.key]} onChange={()=>setMats(p=>({...p,[m.key]:!p[m.key]}))} />
              {m.label}
            </label>
          ))}
        </div>

        {previewName && (
          <div style={{ padding:"12px", background:"rgba(217, 119, 6, 0.08)", borderRadius:"8px", border:"1px dashed var(--primary)" }}>
            <span style={{ fontSize:"0.85rem", color:"var(--primary)", fontWeight:700 }}>Previsualización SEO: </span>
            <code style={{ fontSize:"0.9rem", color:"var(--text-main)", wordBreak:"break-all" }}>{previewName}</code>
          </div>
        )}
      </div>

      <div className="glass-card animate-fade-in" style={{animationDelay:"0.2s"}}>
        <h2 className="card-title"><ImageIcon size={22}/> Recorte IA & Diseño</h2>
        
        <label className="checkbox-row" style={{marginBottom:"20px", padding:"12px", background:"#f0fdf4", borderRadius:"8px", border:"1px solid #bbf7d0"}}>
          <input type="checkbox" className="checkbox-input" checked={enableBgRemoval} onChange={e=>setEnableBgRemoval(e.target.checked)} />
          <span style={{color:"#166534", fontWeight:600}}>Remover fondo usando Inteligencia Artificial (Red Neuronal)</span>
        </label>
        
        <label className="input-label">Margen de seguridad: {paddingPct}% ({Math.round(1200 * paddingPct/100)}px)</label>
        <input type="range" className="range-slider" min="0" max="30" value={paddingPct} onChange={e=>setPaddingPct(Number(e.target.value))} style={{marginBottom:"24px"}}/>
        <div style={{fontSize:"0.8rem", color:"var(--text-muted)", marginTop:"-16px", marginBottom:"24px"}}>
          Define cuánto espacio en blanco se dejará alrededor del producto en el lienzo final de 1200x1200px.
        </div>

        <label className="input-label">Calidad WebP de salida</label>
        <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:"12px"}}>
          {Object.entries(QUALITY_PRESETS).map(([k, p])=>(
            <div key={k} className={`selection-card ${qualityKey===k?"selected":""}`} onClick={()=>setQualityKey(k)}>
              <div style={{fontWeight:700, marginBottom:"4px", color:qualityKey===k?"var(--primary)":"inherit"}}>{p.label}</div>
              <div style={{fontSize:"0.8rem", color:"var(--text-muted)"}}>{p.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card animate-fade-in" style={{animationDelay:"0.3s"}}>
        <div 
          className={`drop-zone ${dragOver ? "active" : ""}`}
          onDragOver={e=>{e.preventDefault(); setDragOver(true)}}
          onDragLeave={()=>{setDragOver(false)}}
          onDrop={e=>{e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files);}}
          onClick={()=>fileRef.current?.click()}
        >
          <Upload size={48} className="drop-icon" />
          <h3 style={{marginBottom:"8px"}}>Sube o arrastra tus imágenes</h3>
          <p style={{color:"var(--text-muted)", fontSize:"0.95rem"}}>Hasta 20 archivos simultáneamente. La IA hará su magia.</p>
          <input ref={fileRef} type="file" multiple accept="image/*" style={{display:"none"}} onChange={e=>addFiles(e.target.files)} />
        </div>

        {files.length > 0 && (
          <div style={{marginTop:"20px"}}>
            <h4 style={{marginBottom:"12px"}}>{files.length} imágenes listas</h4>
            <div style={{maxHeight:"200px", overflowY:"auto"}}>
              {files.map((f,i)=>(
                <div key={i} className="file-item">
                  <span style={{overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{f.name}</span>
                  <button onClick={(e)=>{e.stopPropagation(); setFiles(files.filter((_, idx)=>idx!==i));}} style={{background:"none", border:"none", cursor:"pointer", color:"var(--danger)"}}>
                    <X size={18}/>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {isProcessing && (
        <div className="glass-card animate-fade-in">
          <div style={{marginBottom:"12px", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <h3 style={{fontSize:"1rem"}}>{progLabel}</h3>
            <span style={{fontWeight:700, color:"var(--primary)"}}>{progress}%</span>
          </div>
          <div className="progress-container">
            <div className="progress-fill" style={{width:`${progress}%`}} />
          </div>
          {modelProgress !== null && (
            <div style={{marginTop:"10px", fontSize:"0.8rem", color:"#059669"}}>
              Descargando/Cargando modelo neuronal de alta precisión: {modelProgress}% 
              <br/>(Solo se requiere descargar una vez, 84MB)
            </div>
          )}
        </div>
      )}

      <div style={{textAlign:"center", margin:"32px 0"}}>
        <button className="btn btn-primary" style={{padding:"16px 40px", fontSize:"1.2rem"}} disabled={!productName.trim() || files.length===0 || isProcessing} onClick={processImages}>
          <Sparkles /> Procesar Lote Mágico
        </button>
      </div>

      {phase === "done" && results.length > 0 && (
        <div className="glass-card animate-fade-in">
          <h2 className="card-title" style={{color:"var(--secondary)"}}>✅ ¡Proceso Terminado!</h2>
          
          <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:"16px", marginBottom:"24px"}}>
            <div style={{padding:"16px", background:"#f9fafb", borderRadius:"12px", textAlign:"center"}}>
              <div style={{fontSize:"0.85rem", color:"var(--text-muted)", textTransform:"uppercase", fontWeight:700}}>Ahorro de Peso</div>
              <div style={{fontSize:"2rem", fontWeight:800, color:"var(--secondary)"}}>-{totalSavings}%</div>
            </div>
            <div style={{padding:"16px", background:"#f9fafb", borderRadius:"12px", textAlign:"center"}}>
              <div style={{fontSize:"0.85rem", color:"var(--text-muted)", textTransform:"uppercase", fontWeight:700}}>Resolución</div>
              <div style={{fontSize:"2rem", fontWeight:800, color:"var(--text-main)"}}>1200x1200px</div>
            </div>
            <div style={{padding:"16px", background:"#f9fafb", borderRadius:"12px", textAlign:"center"}}>
              <div style={{fontSize:"0.85rem", color:"var(--text-muted)", textTransform:"uppercase", fontWeight:700}}>Recortes IA Exitosos</div>
              <div style={{fontSize:"2rem", fontWeight:800, color:"var(--primary)"}}>{results.filter(r=>r.bgRemoved).length} / {results.length}</div>
            </div>
          </div>

          <div style={{display:"flex", flexWrap:"wrap", gap:"16px", justifyContent:"center", paddingBottom:"20px", borderBottom:"1px solid rgba(0,0,0,0.05)"}}>
            <button className="btn btn-primary" onClick={downloadZip}><Archive size={18}/> Descargar Lote (.zip)</button>
            <button className="btn btn-secondary" onClick={downloadCSV}><FileText size={18}/> Bajar Metadata (.csv)</button>
          </div>

          <div style={{marginTop:"24px"}}>
            <h3 style={{fontSize:"1rem", marginBottom:"12px", display:"flex", alignItems:"center", gap:"8px"}}><ImageIcon size={18}/> Imágenes Procesadas ({results.length})</h3>
            <div className="results-grid">
              {results.map((r, idx) => (
                <div key={idx} className="result-card">
                  <ResultPreview blob={r.compressedBlob} alt={r.newName} />
                  <div className="result-info">
                    <div className="result-filename" title={r.newName}>{r.newName}</div>
                    <div className="result-meta">
                      <span>{fmtBytes(r.originalSize)} → <strong>{fmtBytes(r.compressedSize)}</strong></span>
                      <span className="badge badge-info">-{Math.round((1 - r.compressedSize/r.originalSize)*100)}%</span>
                      {r.bgRemoved ? (
                        <span className="badge badge-success" style={{ display: "flex", alignItems: "center", gap: "2px" }}><Check size={10} /> IA Recorte</span>
                      ) : r.bgRemovedError ? (
                        <span className="badge badge-danger" title={r.bgRemovedError} style={{ display: "flex", alignItems: "center", gap: "2px" }}><AlertTriangle size={10} /> IA Falló</span>
                      ) : (
                        <span className="badge badge-warning" style={{ display: "flex", alignItems: "center", gap: "2px" }}>Original</span>
                      )}
                    </div>
                  </div>
                  <div className="result-actions">
                    <button className="btn btn-outline" style={{ padding: "6px 12px", fontSize: "0.85rem" }} onClick={() => triggerDownload(r.compressedBlob, r.newName)}>
                      <Download size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{marginTop:"24px"}}>
            <h3 style={{fontSize:"1rem", marginBottom:"12px", display:"flex", alignItems:"center", gap:"8px"}}><Info size={18}/> Vista Previa SEO</h3>
            <div style={{background:"#f9fafb", borderRadius:"12px", padding:"16px", border:"1px solid #e5e7eb", fontSize:"0.9rem"}}>
              <p style={{marginBottom:"8px"}}><strong style={{color:"var(--primary)"}}>Alt Text:</strong> {results[0].altText}</p>
              <p style={{marginBottom:"8px"}}><strong>Title:</strong> {results[0].title}</p>
              <p style={{marginBottom:"8px"}}><strong>Description:</strong> {results[0].description}</p>
            </div>
          </div>
          
        </div>
      )}
    </div>
  );
}
