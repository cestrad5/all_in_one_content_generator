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
  try {
    const { ref, name, category, description, parentFolderId } = req.body;
    const files = req.files;
    
    // Obtener la API key de Gemini (desde cabeceras o desde .env)
    const geminiApiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
    
    // Parsear los nombres de archivo enviados desde el cliente
    let filenames = [];
    try {
      filenames = JSON.parse(req.body.filenames || '[]');
    } catch (e) {
      filenames = files.map(f => f.originalname);
    }

    if (!ref) {
      return res.status(400).json({ error: 'La referencia (ref) es obligatoria.' });
    }
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No se enviaron archivos para procesar.' });
    }

    // 1. Generar Copywriting optimizado con Gemini si hay API Key disponible
    console.log('Llamando a generador de SEO/Copywriting...');
    const seoCopy = await generateSeoCopy(geminiApiKey, ref, name, category, description);
    
    let finalDescription = description || '';
    if (seoCopy) {
      finalDescription = `${seoCopy.technicalHtml}\n\n${seoCopy.longDescription}`;
      console.log('Copia SEO generada con éxito.');
    } else {
      console.log('No se pudo generar copia SEO con IA. Usando descripción básica.');
    }

    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 2. Buscar o Crear carpeta en Google Drive con la Referencia
    const folderName = `REF-${ref.trim()}`;
    const pFolderId = parentFolderId || process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    
    const parentPart = pFolderId ? `'${pFolderId}' in parents and ` : "";
    const folderQuery = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and ${parentPart}trashed = false`;
    
    let folderId;
    const searchFolder = await drive.files.list({
      q: folderQuery,
      fields: 'files(id)',
      spaces: 'drive'
    });

    if (searchFolder.data.files && searchFolder.data.files.length > 0) {
      folderId = searchFolder.data.files[0].id;
    } else {
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      };
      if (pFolderId) {
        folderMetadata.parents = [pFolderId];
      }
      const newFolder = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });
      folderId = newFolder.data.id;
    }

    // 3. Subir cada imagen a la carpeta y hacerla pública
    const imageUrls = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const targetName = filenames[i] || file.originalname;

      const fileMetadata = {
        name: targetName,
        parents: [folderId]
      };

      const media = {
        mimeType: file.mimetype || 'image/webp',
        body: Readable.from(file.buffer)
      };

      const driveFile = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink'
      });

      // Hacer que el archivo sea accesible de manera pública (lectura)
      await drive.permissions.create({
        fileId: driveFile.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });

      // Guardar el enlace
      imageUrls.push(driveFile.data.webViewLink);
    }

    // 4. Subir archivo TXT de configuración Yoast SEO a Drive si se generó
    if (seoCopy) {
      const txtContent = `--- CONFIGURACIÓN YOAST SEO ---
Frase clave objetivo: ${seoCopy.keyphrase}
Título SEO: ${seoCopy.seoTitle}
Slug: ${seoCopy.slug}
Meta descripción: ${seoCopy.metaDescription}
Texto ALT sugerido: ${seoCopy.altText}

--- INFORMACIÓN TÉCNICA (HTML) ---
${seoCopy.technicalHtml.replace(/<br>/g, '\n')}

--- DESCRIPCIÓN LARGA (+300 PALABRAS) ---
${seoCopy.longDescription}
`;

      const txtMetadata = {
        name: `yoast-seo-ref-${ref}.txt`,
        parents: [folderId]
      };

      const txtMedia = {
        mimeType: 'text/plain',
        body: Readable.from(Buffer.from(txtContent, 'utf-8'))
      };

      await drive.files.create({
        requestBody: txtMetadata,
        media: txtMedia,
        fields: 'id'
      });
    }

    // 5. Alimentar la tabla de Google Sheets
    // Estructura: REF | Nombre | Cetegoria | Description | Imagen 1 | ... | Imagen 10
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (sheetId) {
      const row = [
        ref.trim(),
        name || '',
        category || '',
        finalDescription
      ];

      // Añadir links de imágenes hasta 10
      for (let i = 0; i < 10; i++) {
        row.push(imageUrls[i] || '');
      }

      const range = 'A:N'; // Columnas de la A a la N (14 columnas)
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [row]
        }
      });
    }

    res.json({
      success: true,
      folderId: folderId,
      folderName: folderName,
      uploadedCount: files.length,
      imageUrls: imageUrls,
      seoGenerated: !!seoCopy,
      seoData: seoCopy || null
    });

  } catch (error) {
    console.error('Error procesando subida:', error);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de optimización escuchando en el puerto ${PORT}`);
});
