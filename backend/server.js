const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const { Readable } = require('stream');
const http = require('http');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5002;

// Configurar CORS
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://publicador.bonettoconamor.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por políticas CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Configurar multer para almacenar archivos en memoria
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Máx 10MB por archivo
});

// Inicializar Google Auth
const getGoogleAuth = () => {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './service-account.json';
  return new google.auth.GoogleAuth({
    keyFile: keyFile,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
};// Generador de Copia SEO usando Ollama Local
async function generateSeoCopy(apiKey, ref, name, category, originalDescription) {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://172.18.0.2:11434';
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1';
  console.log(`[SEO] Iniciando generación para REF:${ref} | modelo:${ollamaModel} | url:${ollamaUrl}`);

  try {
    const prompt = `Actúa como un experto en SEO y Copywriting para comercio electrónico, especializado en la plataforma Yoast SEO y redacción persuasiva de marca. Tu objetivo es optimizar los metadatos y redactar la descripción de un producto artesanal de madera de Bonetto con Amor.

Datos del producto a trabajar:
- Nombre: ${name}
- Referencia (REF): ${ref}
- Categoría: ${category}
- Descripción original / Materiales: ${originalDescription}

Genera un objeto JSON válido con la siguiente estructura exacta:
{
  "keyphrase": "Frase clave objetivo de Yoast",
  "seoTitle": "Título SEO (máx 60 caracteres)",
  "slug": "slug-amigable",
  "metaDescription": "Meta descripción persuasiva (140-156 caracteres)",
  "altText": "Texto ALT sugerido para Google Imágenes",
  "technicalHtml": "Bloque de código HTML con REF, medidas estimadas en cm y valoración 4.8+ con estrellas como el ejemplo",
  "longDescription": "Descripción larga (+300 palabras) según las directrices",
  "socialMedia": {
    "instagram": "copy aquí",
    "facebook": "copy aquí",
    "whatsapp": "copy aquí",
    "tiktok": "copy aquí"
  },
  "nanoBananaPrompt": "Prompt integral para Nano Banana Pro aquí"
}

Directrices estrictas para el contenido en el JSON:

1. CONFIGURACIÓN YOAST SEO:
- keyphrase: Elige una palabra clave transaccional de alto volumen en español neutro o local (ej. si es para anchetas, usa "Guacal de madera para anchetas" o "Bandeja de madera para desayuno sorpresa").
- seoTitle: Debe incluir la frase clave objetivo al principio, el nombre del modelo y la marca "Bonetto con Amor", sin superar los 60 caracteres.
- slug: Amigable, limpio, separado por guiones y que contenga la frase clave.
- metaDescription: Texto persuasivo e inductivo a la acción que incluya la frase clave exacta y tenga entre 140 y 156 caracteres.
- altText: Texto ALT sugerido para Google Imágenes en formato "frase-clave modelo-producto Bonetto con Amor hecho a mano en colombia".

2. INFORMACIÓN TÉCNICA (HTML):
El campo technicalHtml debe contener exactamente el siguiente formato HTML (inventa medidas lógicas y una valoración alta):
<strong>REF: </strong>${ref}<br>
[Medidas en cm: Alto x Ancho x Profundidad]<br>
(1100+ Valoraciones) Global 4.8+/5: <span style="font-size: 150%; color: orange;">★★★★<span style="background: linear-gradient(to right, orange 85%, transparent 15%); -webkit-background-clip: text; color: transparent;">★</span></span><br>
[Una frase ganadora, corta y comercial con 2 emojis alusivos].

3. DESCRIPCIÓN LARGA (longDescription):
Redacta una descripción extensa y fluida:
- Densidad de palabras clave: Introduce la "Frase clave objetivo" (keyphrase) de forma idéntica e hilada naturalmente exactamente entre 4 y 5 veces a lo largo del texto, ponla siempre en **negrita**.
- Estructura de encabezados: Divide el texto usando un título principal (párrafo introductorio), un encabezado H2, un encabezado H3, y un encabezado H2 final (utiliza formato markdown para los encabezados ## y ###).
- Conectores Yoast SEO: Cada uno de los párrafos debe iniciar OBLIGATORIAMENTE con un conector de transición positivo (ej. "En primer lugar,", "Además,", "Por lo tanto,", "Por consiguiente,", "Por otra parte,", "Sin embargo,", "En consecuencia,", "Por esta razón,").
- Enlace externo: En el primer bloque H2, enlaza de manera natural una palabra clave relevante a Wikipedia usando el formato Markdown [texto](URL de Wikipedia) (ej: [Madera de pino](https://es.wikipedia.org/wiki/Pinus)).
- Enlace interno: En el párrafo de cierre, invita al usuario a seguir navegando usando el formato [https://publicador.bonettoconamor.com/varios] (o la categoría correspondiente en minúsculas).
- Perspectiva de marca: Usa la voz de la marca intercalando la primera persona del plural ("Nosotros fabricamos", "En Bonetto con Amor diseñamos") con los beneficios directos para el comprador en segunda persona ("Tú puedes organizar", "Para que tú sorprendas").
- Cierre: Termina el texto con la palabra "REF: ${ref}".

4. COPIES PARA REDES SOCIALES (socialMedia):
Eres el redactor de contenido de Bonetto con Amor, marca colombiana de productos decorativos en madera para emprendedoras de detalles y negocios de regalos. Genera 4 copies, uno por cada red social, basados en esta información:
- Producto: ${name}
- Categoría: ${category}
- Palabras clave: ${originalDescription}
Tono: cercano, humano, enfocado en emprendedoras. Creativo y alineado con tendencias actuales. Pocos emojis (máximo 2 por copy). Extensión media: 3 a 5 líneas.
Palabras clave de marca (alterna entre ellas, no uses la misma en los 4 copies): "Hecho en Colombia" / "Ideal para emprendedoras" / "Listo para personalizar" / "Fabricación local" / "Entrega rápida" / "Producto colombiano".
Instrucciones por red:
- instagram: Tono emocional y aspiracional. Incluye hashtags relevantes y al menos 2 palabras clave en tendencia del momento para productos de regalo o emprendimiento en Colombia.
- facebook: Más descriptivo. Explica el uso y los beneficios del producto. Mantén cercanía y calidez.
- whatsapp: Directo, máximo 3 líneas, orientado a venta inmediata. Sin hashtags. Incluye CTA suave como "Haz tu pedido" o "Escríbenos hoy".
- tiktok: Dinámico, con hook de apertura impactante en la primera línea. Usa palabras clave virales actuales. Ritmo ágil, frases cotas.

5. PROMPT PARA NANO BANANA PRO (nanoBananaPrompt):
Genera un prompt estructurado integral en español para copiar y pegar en Nano Banana Pro para ambientar la imagen de este producto. El prompt debe ser redactado de la siguiente forma exacta:
PRESERVE: El producto principal (${name}) debe permanecer exactamente igual: su forma, color, textura, materiales (${originalDescription}) y proporciones no deben cambiar. Mantenlo centrado, completamente visible, con una sombra suave y natural debajo. No alteres la perspectiva ni el ángulo del producto.
CHANGE: Reemplaza el fondo actual por un escenario lifestyle creativo y fotorrealista coherente con su entorno de uso natural y típico para la categoría "${category}". Escribe una descripción detallada del fondo adaptada específicamente a este producto (${name}) e inspirada en estas directrices de la categoría:
- Cajas y empaques: mesa de madera clara o escritorio de emprendedora, con props sutiles como flores pequeñas, taza de café o libro.
- Alcancías: repisa decorativa o escritorio juvenil, con props como plantas pequeñas o cuadernos.
- Porta Llaves: mesa de recibidor o pared neutra con textura suave, props mínimos como llaves decorativas o planta pequeña.
- Portarretratos: sala acogedora o mesa auxiliar, con props como vela, libro o flor cortada.
- Varios / Temporada: ambiente cálido, hogareño y coherente con el objeto.
CONSTRAINTS:
- Actúa como fotógrafo publicitario profesional y diseñador de producto.
- Generar una imagen fotorrealista del producto en su entorno de uso natural y típico.
- Iluminación suave, cálida y natural de estudio comercial, coherente con el producto.
- Profundidad de campo suave (background ligeramente desenfocado con lente de 50mm o 85mm) para mantener el producto como protagonista visual.
- Props secundarios de alta calidad que acompañen, nunca compitiendo ni tapando el producto. Composición limpia, moderna y estética premium. Sin texto, sin logos, ni marcas de agua. Relación de aspecto: 1:1 (cuadrado).
UNACCEPTABLE: fondo con texto, producto distorsionado, producto recortado, props que tapen el producto, iluminación artificial dura.

Devuelve exclusivamente el JSON sin código Markdown adicional alrededor, para que pueda ser parseado directamente con JSON.parse.`;

    const url = new URL(`${ollamaUrl}/api/generate`);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const responseBody = await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`Ollama responded with status: ${res.statusCode}`));
          }
        });
      });
      req.on('error', (err) => { reject(err); });
      req.write(JSON.stringify({
        model: ollamaModel,
        prompt: prompt,
        format: 'json',
        stream: false
      }));
      req.end();
    });

    const data = JSON.parse(responseBody);
    let text = data.response;
    console.log(`[SEO] Respuesta Ollama recibida (${text.length} chars). Parseando JSON...`);
    
    // Limpieza de bloques de código markdown
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    // Extraer solo el bloque JSON si hay texto extra
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No se encontró bloque JSON en la respuesta de Ollama');
    const parsed = JSON.parse(jsonMatch[0]);
    console.log('[SEO] JSON parseado correctamente. Campos:', Object.keys(parsed).join(', '));
    return parsed;
  } catch (err) {
    console.error('[SEO] Error llamando a Ollama:', err.message);
    return null;
  }
}

// Ruta de diagnóstico
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Ruta principal para subir el lote e integrar Sheets
app.post('/api/upload-batch', upload.array('files', 20), async (req, res) => {
  const { ref, name, category, description, parentFolderId } = req.body;
  const files = req.files;
  const geminiApiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;

  if (!ref) return res.status(400).json({ error: 'La referencia (ref) es obligatoria.' });

  // 1. Generar Copywriting siempre primero
  const seoCopy = await generateSeoCopy(geminiApiKey, ref, name, category, description);

  // Ejecución no bloqueante para Drive y Sheets
  (async () => {
    try {
      const auth = getGoogleAuth();
      const drive = google.drive({ version: 'v3', auth });
      const sheets = google.sheets({ version: 'v4', auth });

      const folderName = `REF-${ref.trim()}`;
      const pFolderId = parentFolderId || process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
      const folderQuery = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and ${pFolderId ? `'${pFolderId}' in parents and ` : ""}trashed = false`;
      
      let folderId;
      const searchFolder = await drive.files.list({ q: folderQuery, fields: 'files(id)', spaces: 'drive' });
      
      if (searchFolder.data.files && searchFolder.data.files.length > 0) {
        folderId = searchFolder.data.files[0].id;
      } else {
        const folderMetadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: pFolderId ? [pFolderId] : [] };
        const newFolder = await drive.files.create({ requestBody: folderMetadata, fields: 'id' });
        folderId = newFolder.data.id;
      }

      const imageUrls = [];
      for (const file of files) {
        const driveFile = await drive.files.create({
          requestBody: { name: file.originalname, parents: [folderId] },
          media: { mimeType: file.mimetype, body: Readable.from(file.buffer) },
          fields: 'id, webViewLink'
        });
        await drive.permissions.create({ fileId: driveFile.data.id, requestBody: { role: 'reader', type: 'anyone' } });
        imageUrls.push(driveFile.data.webViewLink);
      }

      if (seoCopy) {
        const socialMediaTxt = seoCopy.socialMedia ? `\n\n--- REDES SOCIALES ---\nInstagram:\n${seoCopy.socialMedia.instagram}\n\nFacebook:\n${seoCopy.socialMedia.facebook}\n\nWhatsApp:\n${seoCopy.socialMedia.whatsapp}\n\nTikTok:\n${seoCopy.socialMedia.tiktok}` : '';
        const nanoBananaTxt = seoCopy.nanoBananaPrompt ? `\n\n--- PROMPT NANO BANANA PRO ---\n${seoCopy.nanoBananaPrompt}` : '';
        const txtContent = `--- CONFIGURACIÓN YOAST SEO ---\nFrase clave: ${seoCopy.keyphrase}\n--- DESCRIPCIÓN LARGA ---\n${seoCopy.longDescription}${socialMediaTxt}${nanoBananaTxt}`;
        await drive.files.create({
          requestBody: { name: `yoast-seo-ref-${ref}.txt`, parents: [folderId] },
          media: { mimeType: 'text/plain', body: Readable.from(Buffer.from(txtContent, 'utf-8')) }
        });
      }

      const sheetId = process.env.GOOGLE_SHEET_ID;
      if (sheetId) {
        const finalDescription = seoCopy ? `${seoCopy.technicalHtml}\n\n${seoCopy.longDescription}` : (description || '');
        const row = [ref.trim(), name || '', category || '', finalDescription, ...imageUrls.slice(0, 10)];
        await sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: 'A:N', valueInputOption: 'USER_ENTERED', requestBody: { values: [row] } });
      }
    } catch (e) {
      console.error('Error en proceso en background (Drive/Sheets):', e);
    }
  })();

  res.json({ success: true, seoGenerated: !!seoCopy, seoData: seoCopy || null });
});

// Sistema de jobs asíncronos para generación SEO (evita timeouts HTTP)
const seoJobs = new Map(); // jobId -> { status, seoData, error, createdAt }

// POST /api/generate-seo → lanza el job y retorna jobId inmediatamente
app.post('/api/generate-seo', (req, res) => {
  const { ref, name, category, description } = req.body;
  if (!ref) return res.status(400).json({ error: 'La referencia (ref) es obligatoria.' });

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  seoJobs.set(jobId, { status: 'pending', seoData: null, error: null, createdAt: Date.now() });

  console.log(`[SEO] Job ${jobId} creado para REF:${ref}`);

  // Ejecutar en background sin bloquear la respuesta HTTP
  (async () => {
    try {
      const seoCopy = await generateSeoCopy(null, ref, name, category, description);
      if (seoCopy) {
        seoJobs.set(jobId, { status: 'done', seoData: seoCopy, error: null, createdAt: Date.now() });
        console.log(`[SEO] Job ${jobId} completado exitosamente.`);
      } else {
        seoJobs.set(jobId, { status: 'error', seoData: null, error: 'El LLM no retornó datos válidos.', createdAt: Date.now() });
        console.error(`[SEO] Job ${jobId} falló - LLM retornó null.`);
      }
    } catch (err) {
      seoJobs.set(jobId, { status: 'error', seoData: null, error: err.message, createdAt: Date.now() });
      console.error(`[SEO] Job ${jobId} falló con excepción:`, err.message);
    }
    // Limpiar jobs viejos (> 30 min)
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, job] of seoJobs) {
      if (job.createdAt < cutoff) seoJobs.delete(id);
    }
  })();

  res.json({ jobId, status: 'pending' });
});

// GET /api/seo-status/:jobId → polling para obtener resultado
app.get('/api/seo-status/:jobId', (req, res) => {
  const job = seoJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`Servidor de optimización escuchando en el puerto ${PORT}`);
});
