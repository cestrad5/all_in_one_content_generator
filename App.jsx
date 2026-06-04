import { useState, useRef, useEffect } from "react";

// ── Constantes ────────────────────────────────────────────────────────────────
const CATEGORIES = ["Alcancias","Cajas y Empaques","Porta Llaves","Portarretratos","Temporada","Varios"];
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
const JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

// Perfiles de compresión
const QUALITY_PRESETS = {
  alta:     { label:"Alta calidad",    webpQ:0.88, maxPx:2400, desc:"Mínima pérdida · archivos más grandes" },
  media:    { label:"Balanceada ★",    webpQ:0.78, maxPx:1800, desc:"Mejor balance calidad/peso · recomendado" },
  agresiva: { label:"Máx. compresión", webpQ:0.65, maxPx:1200, desc:"Archivos muy pequeños · algo de pérdida" },
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

// ── Compresión con Canvas API ─────────────────────────────────────────────────
function compressImage(file, quality, maxPx) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        try {
          // Calcular nuevas dimensiones respetando aspect ratio
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          
          if (w > maxPx || h > maxPx) {
            const ratio = Math.min(maxPx / w, maxPx / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          
          const canvas = document.createElement("canvas");
          canvas.width  = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { alpha: false });
          
          // Fondo blanco para imágenes con transparencia
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          
          // Usar mejor algoritmo de suavizado
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          
          ctx.drawImage(img, 0, 0, w, h);
          
          canvas.toBlob(
            blob => {
              if (blob) {
                resolve({ blob, w, h });
              } else {
                reject(new Error("Canvas toBlob falló - posible problema de memoria"));
              }
            },
            "image/webp",
            quality
          );
        } catch (err) {
          reject(new Error(`Error procesando imagen: ${err.message}`));
        }
      };
      
      img.onerror = () => {
        reject(new Error(`No se pudo cargar la imagen: ${file.name}`));
      };
      
      // Usar data URL en lugar de blob URL para evitar CSP
      img.src = e.target.result;
    };
    
    reader.onerror = () => {
      reject(new Error(`Error leyendo archivo: ${file.name}`));
    };
    
    // Leer como Data URL para evitar problemas de CSP
    reader.readAsDataURL(file);
  });
}

// ── JSZip loader ──────────────────────────────────────────────────────────────
function loadJSZip() {
  return new Promise((resolve, reject) => {
    if (window.JSZip) return resolve(window.JSZip);
    const s = document.createElement("script");
    s.src = JSZIP_CDN;
    s.onload  = () => window.JSZip ? resolve(window.JSZip) : reject(new Error("JSZip no disponible"));
    s.onerror = () => reject(new Error("No se pudo cargar JSZip"));
    document.head.appendChild(s);
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; 
  a.download = filename;
  document.body.appendChild(a); 
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ── Estilos base ──────────────────────────────────────────────────────────────
const inp = { 
  width:"100%", padding:"9px 12px", border:"1px solid #d1d5db", borderRadius:8,
  fontSize:14, color:"#1f2937", background:"white", boxSizing:"border-box", outline:"none" 
};

const mkBtn = (c, sm) => {
  const map = { amber:"#d97706", green:"#059669", blue:"#2563eb", gray:"#6b7280" };
  return { 
    background:map[c], color:"white", border:"none",
    padding: sm ? "8px 16px" : "11px 22px", borderRadius:8, fontWeight:700,
    fontSize: sm ? 13 : 14, cursor:"pointer", transition:"opacity 0.2s"
  };
};

// ── Sub-componentes ───────────────────────────────────────────────────────────
const Card = ({title, children}) => (
  <div style={{background:"white",borderRadius:12,boxShadow:"0 1px 6px rgba(0,0,0,.08)",padding:20,marginBottom:16}}>
    <div style={{fontWeight:700,fontSize:15,color:"#1f2937",marginBottom:14,paddingBottom:10,borderBottom:"1px solid #f3f4f6"}}>{title}</div>
    {children}
  </div>
);

const Field = ({label, children}) => (
  <div>
    <label style={{display:"block",fontSize:13,fontWeight:600,color:"#374151",marginBottom:6}}>{label}</label>
    {children}
  </div>
);

const CheckRow = ({checked, onChange, label}) => (
  <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:"#374151"}}>
    <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}
      style={{accentColor:"#d97706",width:15,height:15}} />
    {label}
  </label>
);

const ProgressBar = ({value, label, color="#d97706"}) => (
  <div>
    <div style={{background:"#e5e7eb",borderRadius:999,height:26,overflow:"hidden"}}>
      <div style={{width:`${Math.min(value,100)}%`,
        background:`linear-gradient(90deg,${color === "#d97706" ? "#f59e0b,#d97706" : "#34d399,#059669"})`,
        height:"100%", transition:"width .25s", display:"flex", alignItems:"center", justifyContent:"center"}}>
        {value >= 12 && <span style={{color:"white",fontSize:12,fontWeight:700}}>{Math.round(value)}%</span>}
      </div>
    </div>
    {label && <div style={{fontSize:12,color:"#6b7280",textAlign:"center",marginTop:5}}>{label}</div>}
  </div>
);

const SavingsBadge = ({original, compressed}) => {
  if (!original || !compressed) return null;
  const pct = Math.round((1 - compressed/original)*100);
  const color = pct >= 40 ? "#059669" : pct >= 20 ? "#d97706" : "#6b7280";
  return (
    <span style={{background:color,color:"white",borderRadius:999,padding:"2px 8px",fontSize:11,fontWeight:700,marginLeft:8}}>
      -{pct}%
    </span>
  );
};

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [productName, setProductName] = useState("");
  const [productRef,  setProductRef]  = useState("");
  const [category,    setCategory]    = useState("Temporada");
  const [mats, setMats] = useState({pino:true,mdf:true,vinilo:true,propalcote:true,propalcoteAdhesivo:true,cristal:true});
  const [addBonetto, setAddBonetto] = useState(true);
  const [addNum,     setAddNum]     = useState(true);
  const [qualityKey, setQualityKey] = useState("media");
  const [files,    setFiles]    = useState([]);
  const [results,  setResults]  = useState([]);
  const [phase,    setPhase]    = useState("idle");
  const [progress, setProgress] = useState(0);
  const [progLabel,setProgLabel]= useState("");
  const [error,    setError]    = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  useEffect(() => { loadJSZip().catch(()=>{}); }, []);

  const selectedMats = MATERIALS.filter(m => mats[m.key]);
  const matText = selectedMats.length === 1 ? MATERIAL_SLUG[selectedMats[0].key] : "madera";
  const preset  = QUALITY_PRESETS[qualityKey];

  const addFiles = fs => {
    const imgs = Array.from(fs).filter(f => f.type.startsWith("image/"));
    if (imgs.length === 0) {
      setError("No se detectaron archivos de imagen válidos");
      return;
    }
    setFiles(prev => [...prev, ...imgs].slice(0,10));
    setResults([]); setPhase("idle"); setProgress(0); setError("");
  };
  
  const removeFile = i => {
    setFiles(prev => prev.filter((_,idx)=>idx!==i));
    setResults([]); setPhase("idle");
  };
  
  const onDrop = e => {
    e.preventDefault(); 
    e.stopPropagation();
    setDragOver(false); 
    addFiles(e.dataTransfer.files);
  };

  // ── Procesar ─────────────────────────────────────────────────────────────────
  const processImages = async () => {
    if (!productName.trim() || files.length===0) {
      setError("Por favor ingresa un nombre de producto y carga al menos una imagen");
      return;
    }
    
    setPhase("processing"); 
    setProgress(0); 
    setResults([]); 
    setError("");
    
    const out = [];
    let failedCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      setProgLabel(`Comprimiendo imagen ${i+1} de ${files.length}…`);
      
      try {
        const { blob, w, h } = await compressImage(files[i], preset.webpQ, preset.maxPx);
        const meta = buildMeta(productName.trim(), productRef.trim(), category, matText, i, files.length, addBonetto, addNum);
        
        out.push({
          file: files[i],
          compressedBlob: blob,
          originalName: files[i].name,
          originalSize: files[i].size,
          compressedSize: blob.size,
          dimensions: `${w}×${h}px`,
          ...meta
        });
      } catch(err) {
        console.error(`Error comprimiendo ${files[i].name}:`, err);
        failedCount++;
        
        // Usar archivo original como fallback
        const meta = buildMeta(productName.trim(), productRef.trim(), category, matText, i, files.length, addBonetto, addNum);
        out.push({ 
          file:files[i], 
          compressedBlob:files[i], 
          originalName:files[i].name,
          originalSize:files[i].size, 
          compressedSize:files[i].size, 
          dimensions:"Original sin comprimir", 
          error: err.message,
          ...meta 
        });
      }
      
      setProgress(Math.round(((i+1)/files.length)*100));
    }
    
    setResults(out); 
    setPhase("done"); 
    setProgLabel("");
    
    if (failedCount > 0) {
      setError(`⚠️ ${failedCount} imagen(es) no pudieron comprimirse y se usaron los archivos originales`);
    }
  };

  // ── Descargar ZIP ─────────────────────────────────────────────────────────────
  const downloadZip = async () => {
    setError(""); 
    setPhase("zipping"); 
    setProgress(0);
    setProgLabel("Generando ZIP con imágenes comprimidas…");
    
    try {
      const JSZip = await loadJSZip();
      const zip   = new JSZip();
      
      for (let i = 0; i < results.length; i++) {
        const buf = await results[i].compressedBlob.arrayBuffer();
        zip.file(results[i].newName, buf);
        setProgress(Math.round(((i+1)/results.length)*70));
      }
      
      const blob = await zip.generateAsync(
        { type:"blob", compression:"DEFLATE", compressionOptions:{level:6} },
        meta => setProgress(70 + Math.round(meta.percent*0.3))
      );
      
      triggerDownload(blob, `imagenes-${normalize(productName)}.zip`);
      setPhase("done"); 
      setProgress(100); 
      setProgLabel("");
    } catch(err) {
      console.error("Error generando ZIP:", err);
      setError(`Error al generar el ZIP: ${err.message}`);
      setPhase("done"); 
      setProgress(0); 
      setProgLabel("");
    }
  };

  // ── Descargar CSV ─────────────────────────────────────────────────────────────
  const downloadCSV = () => {
    const esc   = v => `"${String(v).replace(/"/g,'""')}"`;
    const heads = ["archivo_original","archivo_nuevo","tamaño_original","tamaño_comprimido","ahorro","dimensiones","alt_text","title","caption","description","keywords","copyright"];
    const rows  = results.map(r => {
      const pct = Math.round((1-r.compressedSize/r.originalSize)*100);
      return [
        r.originalName, r.newName, fmtBytes(r.originalSize), fmtBytes(r.compressedSize),
        `${pct}%`, r.dimensions, r.altText, r.title, r.caption, r.description, r.keywords, r.copyright
      ].map(esc).join(",");
    });
    triggerDownload(
      new Blob(["\uFEFF"+[heads.join(","),...rows].join("\n")],{type:"text/csv;charset=utf-8"}),
      `seo-metadata-${normalize(productName)}.csv`
    );
  };

  // ── Descargar TXT ─────────────────────────────────────────────────────────────
  const downloadTXT = () => {
    const txt = results.map((r,i) => {
      const pct = Math.round((1-r.compressedSize/r.originalSize)*100);
      return [
        `━━━ IMAGEN ${i+1} / ${results.length} ━━━`,
        `Original   : ${r.originalName} (${fmtBytes(r.originalSize)})`,
        `Nuevo      : ${r.newName} (${fmtBytes(r.compressedSize)} · -${pct}%)`,
        `Dimensiones: ${r.dimensions}`, ``,
        `[ALT TEXT] ★ campo más importante`, r.altText, ``,
        `[TITLE]`, r.title, ``,
        `[CAPTION]`, r.caption, ``,
        `[DESCRIPTION]`, r.description, ``,
        `[KEYWORDS]`, r.keywords, ``,
        `[COPYRIGHT]`, r.copyright,
      ].join("\n");
    }).join("\n\n");
    triggerDownload(
      new Blob([txt],{type:"text/plain;charset=utf-8"}),
      `seo-metadata-${normalize(productName)}.txt`
    );
  };

  const reset = () => { 
    setFiles([]); 
    setResults([]); 
    setPhase("idle"); 
    setProgress(0); 
    setProductName("");
    setProductRef("");
    setError(""); 
  };
  
  const isProcessing = phase==="processing" || phase==="zipping";
  const isDone       = phase==="done";
  const previewName  = productName
    ? `${productRef?`ref-${productRef}-`:""}${normalize(productName)||"…"}-${normalize(category)}-${matText}${addBonetto?"-bonetto":""}${addNum?"-001":""}.webp`
    : null;

  // Stats globales
  const totalOriginal    = results.reduce((s,r)=>s+r.originalSize,0);
  const totalCompressed  = results.reduce((s,r)=>s+r.compressedSize,0);
  const totalSavingsPct  = totalOriginal > 0 ? Math.round((1-totalCompressed/totalOriginal)*100) : 0;

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#fdf6ec,#fef3e2)",padding:"24px",fontFamily:"system-ui,sans-serif"}}>
      <div style={{maxWidth:780,margin:"0 auto"}}>

        {/* Header */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:26,fontWeight:800,color:"#92400e"}}>🪵 Bonetto con Amor</div>
          <div style={{fontSize:13,color:"#b45309",marginTop:4}}>Optimizador SEO · v3.2 · Compresión WebP + Sistema REF</div>
        </div>

        {/* Errores globales */}
        {error && phase !== "done" && (
          <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:12,marginBottom:16,color:"#b91c1c",fontSize:13}}>
            ⚠️ {error}
          </div>
        )}

        {/* 1 · Producto */}
        <Card title="1 · Información del Producto">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
            <Field label="Nombre del Producto">
              <input value={productName} onChange={e=>setProductName(e.target.value)}
                placeholder="Ej: Arbol Americano" style={inp} />
            </Field>
            <Field label="REF (Referencia)">
              <input value={productRef} onChange={e=>setProductRef(e.target.value)}
                placeholder="Ej: 9049" style={inp} maxLength={10} />
            </Field>
          </div>

          <div style={{marginBottom:16}}>
            <Field label="Categoría">
              <select value={category} onChange={e=>setCategory(e.target.value)} style={inp}>
                {CATEGORIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Materiales — marca los que aplican">
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:6}}>
              {MATERIALS.map(m=>(
                <label key={m.key} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:14,color:"#374151"}}>
                  <input type="checkbox" checked={mats[m.key]} onChange={()=>setMats(p=>({...p,[m.key]:!p[m.key]}))}
                    style={{accentColor:"#d97706",width:15,height:15}} />
                  {m.label}
                </label>
              ))}
            </div>
          </Field>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16}}>
            <CheckRow checked={addBonetto} onChange={setAddBonetto} label='Incluir "bonetto" en nombre' />
            <CheckRow checked={addNum}     onChange={setAddNum}     label="Sufijos numéricos (001, 002…)" />
          </div>

          {previewName && (
            <div style={{marginTop:14,padding:"8px 12px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:12,color:"#92400e"}}>
              <span style={{fontWeight:600}}>Vista previa: </span>
              <code style={{background:"#fef3c7",padding:"2px 6px",borderRadius:4,wordBreak:"break-all"}}>{previewName}</code>
              {productRef && (
                <div style={{marginTop:6,fontSize:11,color:"#b45309"}}>
                  💡 La REF <b>{productRef}</b> facilita buscar todas las imágenes de este producto en tu repositorio
                </div>
              )}
            </div>
          )}
        </Card>

        {/* 2 · Compresión */}
        <Card title="2 · Perfil de Compresión">
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            {Object.entries(QUALITY_PRESETS).map(([key,p])=>(
              <div key={key} onClick={()=>setQualityKey(key)}
                style={{border:`2px solid ${qualityKey===key?"#d97706":"#e5e7eb"}`,borderRadius:10,
                  padding:"12px 14px",cursor:"pointer",background:qualityKey===key?"#fffbeb":"white",
                  transition:"all .15s"}}>
                <div style={{fontWeight:700,fontSize:14,color:qualityKey===key?"#92400e":"#374151",marginBottom:4}}>
                  {p.label}
                </div>
                <div style={{fontSize:11,color:"#6b7280",lineHeight:1.4}}>{p.desc}</div>
                <div style={{marginTop:8,fontSize:11,color:"#9ca3af"}}>
                  Calidad {Math.round(p.webpQ*100)}% · Máx. {p.maxPx}px
                </div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,padding:"8px 12px",background:"#f0fdf4",border:"1px solid #bbf7d0",
            borderRadius:8,fontSize:12,color:"#166534"}}>
            💡 <b>Balanceada</b> es ideal para ecommerce: calidad visual excelente con archivos hasta <b>60% más pequeños</b> que el original.
          </div>
        </Card>

        {/* 3 · Imágenes */}
        <Card title="3 · Cargar Imágenes">
          <div onDragOver={e=>{e.preventDefault();e.stopPropagation();setDragOver(true)}}
               onDragEnter={e=>{e.preventDefault();e.stopPropagation();setDragOver(true)}}
               onDragLeave={e=>{e.preventDefault();e.stopPropagation();setDragOver(false)}}
               onDrop={onDrop}
               onClick={()=>fileRef.current?.click()}
               style={{border:`2px dashed ${dragOver?"#d97706":"#d1d5db"}`,borderRadius:10,padding:"28px 20px",
                 textAlign:"center",cursor:"pointer",background:dragOver?"#fffbeb":"#fafafa",transition:"all .2s"}}>
            <div style={{fontSize:36,marginBottom:8}}>📁</div>
            <div style={{fontWeight:600,color:"#374151",marginBottom:4}}>Arrastra tus imágenes aquí</div>
            <div style={{fontSize:13,color:"#6b7280"}}>o haz click para seleccionar · Máx. 10 imágenes</div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{display:"none"}}
              onChange={e=>addFiles(e.target.files)} />
          </div>

          {files.length > 0 && (
            <div style={{marginTop:14}}>
              <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:8}}>
                {files.length}/10 archivo{files.length!==1?"s":""} seleccionado{files.length!==1?"s":""}
              </div>
              {files.map((f,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"6px 10px",background:i%2===0?"#f9fafb":"white",borderRadius:6,marginBottom:3,fontSize:13}}>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"85%",color:"#374151"}}>
                    <span style={{color:"#d97706",marginRight:6,fontWeight:700}}>#{i+1}</span>
                    {f.name}
                    <span style={{color:"#9ca3af",marginLeft:6}}>({fmtBytes(f.size)})</span>
                  </span>
                  <button onClick={e=>{e.stopPropagation();removeFile(i)}}
                    style={{border:"none",background:"none",cursor:"pointer",color:"#9ca3af",fontSize:18,flexShrink:0}}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Progreso */}
        {isProcessing && (
          <Card title={phase==="zipping" ? "Generando ZIP…" : "Comprimiendo imágenes…"}>
            <ProgressBar value={progress} label={progLabel} color={phase==="zipping"?"#059669":"#d97706"} />
          </Card>
        )}

        {/* Botón principal */}
        <div style={{textAlign:"center",margin:"20px 0"}}>
          <button onClick={processImages}
            disabled={!productName.trim()||files.length===0||isProcessing}
            style={{...mkBtn("amber"), opacity:(!productName.trim()||files.length===0||isProcessing)?0.45:1}}>
            ⚙️ {phase==="processing" ? "Comprimiendo…" : "Comprimir y optimizar imágenes"}
          </button>
        </div>

        {/* Resultados */}
        {isDone && results.length > 0 && (
          <Card title="4 · Resultados">

            {/* Errores en resultados */}
            {error && (
              <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:12,marginBottom:16,color:"#92400e",fontSize:13}}>
                {error}
              </div>
            )}

            {/* Resumen global */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:20}}>
              {[
                ["Tamaño original", fmtBytes(totalOriginal), "#374151"],
                ["Tamaño final",    fmtBytes(totalCompressed), "#059669"],
                ["Ahorro total",    `${totalSavingsPct}% menos`, "#d97706"],
              ].map(([label,val,color])=>(
                <div key={label} style={{background:"#f9fafb",borderRadius:10,padding:"14px",textAlign:"center",border:"1px solid #e5e7eb"}}>
                  <div style={{fontSize:11,color:"#6b7280",marginBottom:4,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</div>
                  <div style={{fontSize:20,fontWeight:800,color}}>{val}</div>
                </div>
              ))}
            </div>

            {/* Tabla por imagen */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:8}}>Detalle por imagen</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:1,fontSize:11,
                background:"#e5e7eb",borderRadius:8,overflow:"hidden"}}>
                {["Nombre original","Nombre nuevo · tamaño"].map(h=>(
                  <div key={h} style={{background:"#f3f4f6",padding:"6px 10px",fontWeight:700,color:"#374151"}}>{h}</div>
                ))}
                {results.map((r,i)=>{
                  const pct = Math.round((1-r.compressedSize/r.originalSize)*100);
                  return [
                    <div key={`a${i}`} style={{background:i%2===0?"white":"#fafafa",padding:"7px 10px",
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#6b7280"}} title={r.originalName}>
                      {r.originalName}
                    </div>,
                    <div key={`b${i}`} style={{background:i%2===0?"white":"#fafafa",padding:"7px 10px",
                      display:"flex",alignItems:"center",gap:4,overflow:"hidden"}}>
                      <span style={{color:"#92400e",fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.newName}>
                        {r.newName}
                      </span>
                      <span style={{color:"#9ca3af",whiteSpace:"nowrap"}}>{fmtBytes(r.compressedSize)}</span>
                      <SavingsBadge original={r.originalSize} compressed={r.compressedSize} />
                    </div>
                  ];
                })}
              </div>
            </div>

            {/* Preview metadata */}
            <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:14,marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:700,color:"#92400e",marginBottom:10}}>📋 Vista previa de metadata — imagen 1</div>
              {[
                ["Alt Text ⭐ (campo más importante para SEO)", results[0].altText],
                ["Title (Media Library WP)",                   results[0].title],
                ["Caption (visible al usuario)",               results[0].caption],
                ["Description (attachment page)",              results[0].description],
                ["Keywords IPTC",                              results[0].keywords],
              ].map(([label,val])=>(
                <div key={label} style={{marginBottom:9}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#b45309",textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</div>
                  <div style={{fontSize:12,color:"#374151",background:"white",padding:"6px 8px",borderRadius:6,marginTop:3,border:"1px solid #e5e7eb"}}>{val}</div>
                </div>
              ))}
            </div>

            {/* Botones */}
            <div style={{display:"flex",flexWrap:"wrap",gap:12,justifyContent:"center",marginBottom:16}}>
              <button onClick={downloadZip}  disabled={isProcessing} style={{...mkBtn("amber"), opacity:isProcessing?0.6:1}}>📦 Descargar imágenes (ZIP)</button>
              <button onClick={downloadCSV}  style={mkBtn("green")}>📊 Descargar CSV</button>
              <button onClick={downloadTXT}  style={mkBtn("blue")}>📄 Descargar TXT</button>
            </div>

            {phase==="zipping" && <div style={{marginBottom:16}}><ProgressBar value={progress} label="Comprimiendo ZIP…" color="#059669"/></div>}

            {/* Próximos pasos */}
            <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:14,fontSize:13}}>
              <div style={{fontWeight:700,color:"#166534",marginBottom:8}}>✅ Próximos pasos en WooCommerce</div>
              {["Descarga el ZIP → extrae las imágenes ya renombradas y comprimidas.",
                "En WooCommerce, sube cada imagen al producto correspondiente.",
                "En la Media Library, pega Alt Text, Title, Caption y Description del CSV.",
                "El Alt Text es el campo MÁS IMPORTANTE — priorízalo siempre.",
                "Opcional: instala Yoast SEO o RankMath para validar optimización on-page."
               ].map((s,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:5,color:"#166534"}}>
                  <b style={{minWidth:16}}>{i+1}.</b><span>{s}</span>
                </div>
              ))}
            </div>
            <div style={{textAlign:"center",marginTop:18}}>
              <button onClick={reset} style={mkBtn("gray")}>🔄 Procesar otro producto</button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
