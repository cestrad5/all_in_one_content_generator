const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const { Readable } = require('stream');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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
};

// Generador de Copia SEO usando Gemini
async function generateSeoCopy(apiKey, ref, name, category, originalDescription) {
  if (!apiKey) {
    console.log('Gemini API Key no proporcionada. Usando fallback.');
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Usar gemini-2.5-flash por velocidad y precisión
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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
  "longDescription": "Descripción larga (+300 palabras) según las directrices"
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

Devuelve exclusivamente el JSON sin código Markdown adicional alrededor, para que pueda ser parseado directamente con JSON.parse.`;

    const result = await model.generateContent(prompt);
    let text = result.response.text();
    // Limpieza de bloques de código markdown
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(text);
  } catch (err) {
    console.error('Error llamando a Gemini API:', err);
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
        const txtContent = `--- CONFIGURACIÓN YOAST SEO ---\nFrase clave: ${seoCopy.keyphrase}\n--- DESCRIPCIÓN LARGA ---\n${seoCopy.longDescription}`;
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

app.listen(PORT, () => {
  console.log(`Servidor de optimización escuchando en el puerto ${PORT}`);
});
