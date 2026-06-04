const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const { Readable } = require('stream');
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

// Ruta de diagnóstico
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Ruta principal para subir el lote e insertar en Sheets
app.post('/api/upload-batch', upload.array('files', 20), async (req, res) => {
  try {
    const { ref, name, category, description, parentFolderId } = req.body;
    const files = req.files;
    
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

    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Buscar o Crear carpeta en Google Drive con la Referencia
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

    // 2. Subir cada imagen a la carpeta y hacerla pública
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

    // 3. Alimentar la tabla de Google Sheets
    // Estructura: REF | Nombre | Cetegoria | Description | Imagen 1 | ... | Imagen 10
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (sheetId) {
      const row = [
        ref.trim(),
        name || '',
        category || '',
        description || ''
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
      imageUrls: imageUrls
    });

  } catch (error) {
    console.error('Error procesando subida:', error);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de optimización escuchando en el puerto ${PORT}`);
});
