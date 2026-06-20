import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import nodemailer from "nodemailer";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import compression from "compression";

// 1️⃣ Cargar variables de entorno
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Crear directorio de uploads si no existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 🛡️ Manejadores globales: registrar cualquier error no capturado en vez de
// morir en silencio (causa de respuestas vacías / ERR_EMPTY_RESPONSE en el cliente).
process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 unhandledRejection:', reason);
});

// 2️⃣ Crear app
const app = express();
// 🔎 Logger de TODAS las peticiones entrantes (antes de cualquier parsing/auth).
// Sirve para confirmar si una petición (p.ej. PUT actividades) llega realmente
// al proceso Node o muere antes en el proxy (Traefik) → ERR_EMPTY_RESPONSE.
app.use((req, res, next) => {
  console.log(`➡️  ${req.method} ${req.originalUrl} (len=${req.headers['content-length'] || 0})`);
  res.on('finish', () => console.log(`⬅️  ${req.method} ${req.originalUrl} → ${res.statusCode}`));
  res.on('close', () => { if (!res.writableEnded) console.log(`✂️  ${req.method} ${req.originalUrl} → conexión cerrada SIN respuesta`); });
  next();
});
// Private Network Access (Chrome/Edge 130+): autorizar peticiones desde un origen
// público (*.sslip.io) hacia una IP privada (192.168.x). Sin este header el navegador
// bloquea el preflight con ERR_EMPTY_RESPONSE.
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.header('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});
// CORS DEBE ir antes de compression para que el preflight OPTIONS no quede colgado
app.use(cors({
  origin: [
    'http://192.168.60.109',
    'https://192.168.60.109',
    'http://192.168.60.109/taxcontrol',
    'https://taxcontrolapp.192.168.60.109.sslip.io',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));
// Responder explícitamente a preflight para todas las rutas
app.options(/.*/, cors());
app.use(compression()); // ⚡ Gzip compression for all responses
// 50MB para soportar archivos en base64 (PDFs, imágenes grandes)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🚀 Simple in-memory cache for documents list (60s TTL)
const docsCache = new Map();
const DOCS_CACHE_TTL = 60 * 1000;
const getCachedDocs = (key) => {
  const entry = docsCache.get(key);
  if (!entry) return null;
  if (entry.cachedAt + DOCS_CACHE_TTL < Date.now()) { docsCache.delete(key); return null; }
  return entry.data;
};
const setCachedDocs = (key, data) => docsCache.set(key, { data, cachedAt: Date.now() });
const invalidateDocsCache = () => docsCache.clear();

// Sincroniza el estado del documento según sus actividades, replicando la lógica
// del frontend (syncDocumentStatus): todas completadas → 'Completado';
// hay actividades pero no todas → 'En progreso'; sin actividades → 'Inicializado'.
// Si el estado cambia, persiste y notifica por email (igual que PUT /api/documents/:id).
// Valores canónicos (types.ts): 'Inicializado' | 'En progreso' | 'Completado'.
const syncDocumentStatusFromActivities = async (docId, changedBy) => {
  try {
    // Contar actividades totales y completadas
    const [stats] = await pool.query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed
       FROM activities WHERE document_id = ?`,
      [docId]
    );
    const total = Number(stats[0].total);
    const completed = Number(stats[0].completed);

    // Misma regla que el frontend (DocumentDetail.tsx → syncDocumentStatus)
    let newStatus;
    if (total > 0 && total === completed) newStatus = 'Completado';
    else if (total > 0) newStatus = 'En progreso';
    else newStatus = 'Inicializado';

    // Leer estado actual para detectar cambio
    const [docRows] = await pool.query(
      'SELECT status, title, trarnite_number, authority FROM documents WHERE id = ?',
      [docId]
    );
    if (docRows.length === 0) return;
    const oldStatus = docRows[0].status;
    if (oldStatus === newStatus) return; // sin cambio, no hacer nada

    await pool.query('UPDATE documents SET status = ? WHERE id = ?', [newStatus, docId]);
    invalidateDocsCache();
    console.log(`🔄 Documento ${docId}: "${oldStatus}" → "${newStatus}" (${completed}/${total} actividades)`);

    // Notificar por email el cambio de estado (igual que PUT /api/documents/:id)
    try {
      const recipients = await getDocumentRecipients(docId);
      const doc = docRows[0];
      const emailTemplate = getStatusChangeEmailContent(
        doc.title, doc.trarnite_number, oldStatus, newStatus, changedBy, doc.authority
      );
      await sendNotificationEmail(recipients, emailTemplate.subject, emailTemplate.html, docId, 'status_change');
    } catch (mailErr) {
      console.error('Error enviando notificación de cambio de estado:', mailErr.message);
    }
  } catch (error) {
    console.error('Error sincronizando estado del documento:', error);
  }
};

// Resuelve el document_id de una actividad y sincroniza el estado del documento.
const syncDocumentStatusByActivity = async (activityId, changedBy) => {
  try {
    const [activity] = await pool.query(
      'SELECT document_id FROM activities WHERE id = ?',
      [activityId]
    );
    if (activity.length === 0) return;
    await syncDocumentStatusFromActivities(activity[0].document_id, changedBy);
  } catch (error) {
    console.error('Error resolviendo documento de la actividad:', error);
  }
};

// Calcula la fecha de descanso observada según reglas de traslado Ecuador (Ley Orgánica Reformatoria)
// Domingo(0)→Lunes, Martes(2)→Lunes previo, Miércoles(3)→Viernes, Jueves(4)→Viernes, Lunes/Viernes→se mantiene
function calculateCalendarDate(officialDateStr) {
  const [y, m, d] = officialDateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0);
  const dow = date.getDay();
  const result = new Date(date);
  if (dow === 0)      result.setDate(result.getDate() + 1); // Domingo → Lunes
  else if (dow === 2) result.setDate(result.getDate() - 1); // Martes → Lunes previo
  else if (dow === 3) result.setDate(result.getDate() + 2); // Miércoles → Viernes
  else if (dow === 4) result.setDate(result.getDate() + 1); // Jueves → Viernes
  const ry = result.getFullYear();
  const rm = String(result.getMonth() + 1).padStart(2, '0');
  const rd = String(result.getDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

// 📁 Archivo de persistencia para cambios de feriados cuando BD no está disponible
const HOLIDAYS_FALLBACK_FILE = path.join(__dirname, 'holidays_fallback.json');

function saveFallbackFile() {
  try {
    const data = memoryHolidays.map(h => ({
      ...h,
      official_date: h.official_date instanceof Date ? h.official_date.toISOString() : h.official_date,
      holiday_date: h.holiday_date instanceof Date ? h.holiday_date.toISOString() : h.holiday_date,
      created_at: h.created_at instanceof Date ? h.created_at.toISOString() : h.created_at,
      updated_at: h.updated_at instanceof Date ? h.updated_at?.toISOString() : h.updated_at,
    }));
    fs.writeFileSync(HOLIDAYS_FALLBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log(`💾 Feriados persistidos en archivo (${memoryHolidays.length} registros)`);
  } catch (e) {
    console.warn('⚠️ No se pudo guardar holidays_fallback.json:', e.message);
  }
}

function loadFallbackFile() {
  try {
    if (fs.existsSync(HOLIDAYS_FALLBACK_FILE)) {
      const raw = fs.readFileSync(HOLIDAYS_FALLBACK_FILE, 'utf8');
      const data = JSON.parse(raw);
      return data.map(h => ({
        ...h,
        official_date: h.official_date ? new Date(h.official_date) : null,
        holiday_date: new Date(h.holiday_date),
        created_at: new Date(h.created_at),
        updated_at: h.updated_at ? new Date(h.updated_at) : null,
      }));
    }
  } catch (e) {
    console.warn('⚠️ No se pudo cargar holidays_fallback.json:', e.message);
  }
  return null;
}

// Defaults de Ecuador 2026 (se usan solo si no hay archivo persistido ni BD)
const DEFAULT_MEMORY_HOLIDAYS = [
  { id: 1, official_date: new Date('2026-01-01'), holiday_date: new Date('2026-01-02'), name: 'Año Nuevo', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null },
  { id: 2, official_date: new Date('2026-02-16'), holiday_date: new Date('2026-02-16'), name: 'Lunes de Carnaval', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null },
  { id: 3, official_date: new Date('2026-02-17'), holiday_date: new Date('2026-02-17'), name: 'Martes de Carnaval', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null },
  { id: 4, official_date: new Date('2026-04-03'), holiday_date: new Date('2026-04-03'), name: 'Viernes Santo', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null },
  { id: 5, official_date: new Date('2026-05-01'), holiday_date: new Date('2026-05-01'), name: 'Día del Trabajo', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null },
  { id: 6, official_date: new Date('2026-05-24'), holiday_date: new Date('2026-05-25'), name: 'Batalla de Pichincha', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null },
  { id: 7, official_date: new Date('2026-08-10'), holiday_date: new Date('2026-08-10'), name: 'Primer Grito de Independencia', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null },
  { id: 8, official_date: new Date('2026-10-09'), holiday_date: new Date('2026-10-09'), name: 'Independencia de Guayaquil', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null },
  { id: 9, official_date: new Date('2026-11-02'), holiday_date: new Date('2026-11-02'), name: 'Día de los Difuntos / Independencia de Cuenca', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null },
  { id: 10, official_date: new Date('2026-12-25'), holiday_date: new Date('2026-12-25'), name: 'Navidad', holiday_type: 'Ordinary', created_by: null, created_at: new Date(), updated_by: null, updated_at: null }
];

// Inicializar desde archivo persistido (si existe) o usar defaults
// 🏢 Mapeo de variantes de empresas a nombres canónicos
const COMPANY_ALIASES = {
  // ECSA - Ecuacorriente SA
  'ecsa': 'ECSA',
  'ecuacorriente': 'ECSA',
  'ecuacorriente sa': 'ECSA',
  'ecuacorriente s.a.': 'ECSA',
  'ecuacorriente s.a': 'ECSA',

  // EXSA - Explorcobres SA
  'exsa': 'EXSA',
  'explorcobres': 'EXSA',
  'explorcobre': 'EXSA',
  'explorcobre sa': 'EXSA',
  'explorcobre s.a.': 'EXSA',
  'explorcobre s.a': 'EXSA',
  'explorcobres sa': 'EXSA',
  'explorcobres s.a.': 'EXSA',
  'explorcobres s.a': 'EXSA',

  // PCSA - Puertcobre SA
  'pcsa': 'PCSA',
  'puertcobre': 'PCSA',
  'puertocobre': 'PCSA',
  'puertocobre sa': 'PCSA',
  'puertocobre s.a.': 'PCSA',
  'puertocobre s.a': 'PCSA',
  'puertcobre sa': 'PCSA',
  'puertcobre s.a.': 'PCSA',
  'puertcobre s.a': 'PCSA',

  // MMSA - Minera Midas Mine SA
  'mmsa': 'MMSA',
  'midasmine': 'MMSA',
  'midas mine': 'MMSA',
  'minera midas mine': 'MMSA',
  'minera midas mine sa': 'MMSA',
  'minera midas mine s.a.': 'MMSA',
  'midasmine sa': 'MMSA',
  'midasmine s.a.': 'MMSA',
  'midasmine s.a': 'MMSA',

  // HCSA - Hidrocruz SA
  'hcsa': 'HCSA',
  'hidrocruz': 'HCSA',
  'hidrocruz sa': 'HCSA',
  'hidrocruz s.a.': 'HCSA',
  'hidrocruz s.a': 'HCSA',
  'proyecto hidroelectrico hidrocruz': 'HCSA',
  'proyecto hidroelectrico hidrocruz sa': 'HCSA',
  'proyecto hidroelectrico hidrocruz s.a.': 'HCSA'
};

const VALID_COMPANY_ACRONYMS = ['ECSA', 'EXSA', 'HCSA', 'PCSA', 'MMSA'];

// Función para normalizar nombre de empresa
// ESTRICTA: solo mapea variaciones CONOCIDAS de los acrónimos válidos
// via COMPANY_ALIASES. No hace fuzzy matching de strings ruidosos.
const normalizeCompanyName = (name) => {
  if (!name) return null;
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');

  // Solo aceptar matches explícitos en aliases
  const result = COMPANY_ALIASES[normalized] || null;

  // Si el resultado es uno de los acrónimos válidos, devolverlo
  if (result && VALID_COMPANY_ACRONYMS.includes(result)) {
    return result;
  }

  // Si el input ya es exactamente uno de los acrónimos, aceptarlo
  if (VALID_COMPANY_ACRONYMS.includes(name.trim().toUpperCase())) {
    return name.trim().toUpperCase();
  }

  // Cualquier otro valor es inválido - no aceptar
  return null;
};

// Crear una nueva company. Tolera tablas sin AUTO_INCREMENT en id
// (ej. esquemas legacy donde id es NOT NULL sin default).
async function createCompany(name) {
  // Defensa: verificar siempre primero si la company ya existe
  const [preCheck] = await pool.query('SELECT id FROM companies WHERE name = ?', [name]);
  if (preCheck.length > 0) return preCheck[0].id;

  // Intento 1: INSERT normal (funciona si hay AUTO_INCREMENT)
  try {
    const [result] = await pool.query('INSERT INTO companies (name) VALUES (?)', [name]);
    if (result.insertId) return result.insertId;
  } catch (err) {
    const msg = err.message || '';
    // Si fue duplicate entry, otra request creó la company - re-buscar
    if (msg.includes('Duplicate entry')) {
      const [existing] = await pool.query('SELECT id FROM companies WHERE name = ?', [name]);
      if (existing.length > 0) return existing[0].id;
      // Fall through: probablemente conflicto con id default, intentar con id explícito
    } else if (!msg.includes("doesn't have a default value")) {
      throw err;
    }
  }

  // Fallback con retry: generar id explícito y manejar race conditions
  let currentMaxId = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    // Re-verificar antes de cada intento (puede haberse creado en otro proceso)
    const [existing] = await pool.query('SELECT id FROM companies WHERE name = ?', [name]);
    if (existing.length > 0) return existing[0].id;

    // En primer intento, obtener MAX real. En siguientes, incrementar manualmente
    if (attempt === 0) {
      const [maxRows] = await pool.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM companies');
      currentMaxId = maxRows[0].max_id;
    }

    const newId = currentMaxId + attempt + 1;
    try {
      await pool.query('INSERT INTO companies (id, name) VALUES (?, ?)', [newId, name]);
      return newId;
    } catch (err) {
      const msg = err.message || '';
      if (!msg.includes('Duplicate entry')) throw err;
      // Race condition: otro proceso usó este id, reintentar con siguiente id
      console.log(`[createCompany] Duplicate id=${newId} para '${name}', intentando id=${newId + 1}`);
    }
  }
  throw new Error(`No se pudo crear la company '${name}' después de 15 intentos con ids duplicados`);
}


// Servir archivos almacenados (visualización inline): primero desde la BD
// (LONGBLOB), luego disco para archivos legacy. Sin auth para permitir <a href>.
app.get('/api/files/:id', async (req, res) => {
  try {
    const stored = await loadStoredFile(req.params.id);
    if (!stored) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Type', stored.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(stored.fileName)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(stored.buffer);
  } catch (error) {
    console.error('[files] error sirviendo archivo:', error);
    res.status(500).json({ error: error.message });
  }
});

// Configurar multer EN MEMORIA: los bytes del archivo se guardan en la base de
// datos (LONGBLOB), NO en disco, para que sobrevivan a cualquier redespliegue del
// contenedor (el disco /app/uploads es efímero sin volumen persistente).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
  // Sin fileFilter — se permite cualquier tipo de archivo (PDF, imágenes, Word, Excel, etc.)
});

// Genera una clave de almacenamiento única conservando el nombre original (saneado)
const makeStorageKey = (originalName) => {
  const safeName = String(originalName || 'archivo')
    .replace(/[\/\\]/g, '_')   // sin separadores de ruta
    .replace(/\s+/g, '_')       // sin espacios
    .slice(-180);               // acotar longitud (conserva la extensión al final)
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
};

// Inferir Content-Type a partir de la extensión (para archivos legacy en disco)
function guessMimeType(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (n.endsWith('.doc')) return 'application/msword';
  if (n.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (n.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (n.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

// 🗄️ Tabla document_files: almacena los bytes de TODO archivo cargado (cualquier
// formato). Fuente de verdad única y persistente, independiente del disco.
let documentFilesTableReady = false;
async function ensureDocumentFilesTable() {
  if (documentFilesTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_files (
      id VARCHAR(200) PRIMARY KEY,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(150) DEFAULT 'application/octet-stream',
      data LONGBLOB NOT NULL,
      size INT,
      uploaded_by VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  documentFilesTableReady = true;
}

// Carga un archivo almacenado por su clave: primero desde la BD, luego (legacy) disco.
async function loadStoredFile(key) {
  if (!key) return null;
  const cleanKey = path.basename(String(key)); // evita path traversal
  // 1️⃣ Base de datos (fuente de verdad)
  try {
    await ensureDocumentFilesTable();
    const [rows] = await pool.query(
      "SELECT file_name, mime_type, data FROM document_files WHERE id = ? LIMIT 1",
      [cleanKey]
    );
    if (rows.length > 0 && rows[0].data) {
      return {
        buffer: rows[0].data,
        mimeType: rows[0].mime_type || guessMimeType(rows[0].file_name),
        fileName: rows[0].file_name || cleanKey
      };
    }
  } catch (e) {
    console.warn('[loadStoredFile] error consultando BD:', e.message);
  }
  // 2️⃣ Fallback a disco (archivos antiguos aún presentes en el contenedor)
  try {
    const filePath = path.join(UPLOAD_DIR, cleanKey);
    if (fs.existsSync(filePath)) {
      const buffer = await fs.promises.readFile(filePath);
      return { buffer, mimeType: guessMimeType(cleanKey), fileName: cleanKey };
    }
  } catch (e) {
    console.warn('[loadStoredFile] error leyendo disco:', e.message);
  }
  return null;
}

// 3️⃣ Crear pool MariaDB (GLOBAL)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 50,
  idleTimeout: 30000,
  enableKeepAlive: true
});

// 🌐 Email Template Helper - Multi-language Support (Spanish + Simplified Chinese)
const getWelcomeEmailContent = (name, email, password, role = "Operator") => {
  const roleDisplay = role || "Operator";

  return {
    subject: "👥 Bienvenido a Tax Control | 欢迎来到 Tax Control - Tus Credenciales de Acceso | 您的访问凭证",
    html: `
      <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">

          <!-- SPANISH VERSION -->
          <div style="margin-bottom: 40px; padding-bottom: 30px; border-bottom: 2px solid #e0e0e0;">
            <h2 style="color: #204070;">👥 Bienvenido a Tax Control</h2>
            <p>¡Hola <strong>${name}</strong>!</p>
            <p>Tu cuenta ha sido creada exitosamente en Tax Control. A continuación encontrarás tus credenciales de acceso:</p>

            <div style="background-color: #f9f9f9; border-left: 4px solid #204070; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 5px 0;"><strong>📧 Email/Usuario:</strong> ${email}</p>
              <p style="margin: 5px 0;"><strong>🔐 Contraseña:</strong> <code style="background-color: #f0f0f0; padding: 2px 6px; border-radius: 3px;">${password}</code></p>
              <p style="margin: 5px 0;"><strong>👤 Rol:</strong> ${roleDisplay}</p>
            </div>

            <p style="margin-top: 20px;">
              <a href="http://192.168.60.109/taxcontrol/#/login"
                 style="background-color: #204070; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Acceder a Tax Control
              </a>
            </p>

            <p style="color: #666; font-size: 12px; margin-top: 20px;">
              <strong>⚠️ IMPORTANTE:</strong> Por seguridad, te recomendamos cambiar tu contraseña en el primer acceso a tu perfil.
            </p>
          </div>

          <!-- CHINESE (SIMPLIFIED) VERSION -->
          <div>
            <h2 style="color: #204070;">👥 欢迎来到 Tax Control</h2>
            <p>你好 <strong>${name}</strong>！</p>
            <p>您的账户已在 Tax Control 中成功创建。以下是您的访问凭证：</p>

            <div style="background-color: #f9f9f9; border-left: 4px solid #204070; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 5px 0;"><strong>📧 电子邮件/用户名：</strong> ${email}</p>
              <p style="margin: 5px 0;"><strong>🔐 密码：</strong> <code style="background-color: #f0f0f0; padding: 2px 6px; border-radius: 3px;">${password}</code></p>
              <p style="margin: 5px 0;"><strong>👤 角色：</strong> ${roleDisplay}</p>
            </div>

            <p style="margin-top: 20px;">
              <a href="http://192.168.60.109/taxcontrol/#/login"
                 style="background-color: #204070; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                登录 Tax Control
              </a>
            </p>

            <p style="color: #666; font-size: 12px; margin-top: 20px;">
              <strong>⚠️ 重要提示：</strong>为了安全起见，我们建议您在首次登录时更改密码。
            </p>
          </div>

          <!-- FOOTER -->
          <p style="color: #999; margin-top: 30px; font-size: 12px; border-top: 1px solid #e0e0e0; padding-top: 20px;">
            Tax Control System | 税务控制系统<br/>
            Sistema de Control Tributario
          </p>
        </div>
      </body>
      </html>
    `
  };
};

// 🌐 Status Change Notification Email Template (Bilingual)
const getStatusChangeEmailContent = (documentTitle, tramiteNumber, oldStatus, newStatus, changedBy, authority) => {
  return {
    subject: "📋 Documento Actualizado | 文档已更新 - Estado Cambió | 状态已更改",
    html: `
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">

          <!-- SPANISH -->
          <div style="margin-bottom: 40px; padding-bottom: 30px; border-bottom: 2px solid #e0e0e0;">
            <h2 style="color: #204070;">📋 Documento Actualizado</h2>
            <p>El documento "<strong>${documentTitle}</strong>" (Trámite: ${tramiteNumber}) ha cambiado de estado.</p>

            <div style="background-color: #f9f9f9; border-left: 4px solid #204070; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 5px 0;"><strong>📄 Documento:</strong> ${documentTitle}</p>
              <p style="margin: 5px 0;"><strong>🔢 Trámite:</strong> ${tramiteNumber}</p>
              <p style="margin: 5px 0;"><strong>❌ Estado Anterior:</strong> <span style="background: #ffe6e6; padding: 2px 6px; border-radius: 3px;">${oldStatus}</span></p>
              <p style="margin: 5px 0;"><strong>✅ Nuevo Estado:</strong> <span style="background: #e6ffe6; padding: 2px 6px; border-radius: 3px;">${newStatus}</span></p>
              <p style="margin: 5px 0;"><strong>👤 Cambio Realizado por:</strong> ${changedBy}</p>
              <p style="margin: 5px 0;"><strong>🏢 Autoridad:</strong> ${authority}</p>
            </div>
          </div>

          <!-- CHINESE -->
          <div>
            <h2 style="color: #204070;">📋 文档已更新</h2>
            <p>文档"<strong>${documentTitle}</strong>"（程序：${tramiteNumber}）的状态已更改。</p>

            <div style="background-color: #f9f9f9; border-left: 4px solid #204070; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 5px 0;"><strong>📄 文档：</strong> ${documentTitle}</p>
              <p style="margin: 5px 0;"><strong>🔢 程序号：</strong> ${tramiteNumber}</p>
              <p style="margin: 5px 0;"><strong>❌ 前一个状态：</strong> <span style="background: #ffe6e6; padding: 2px 6px; border-radius: 3px;">${oldStatus}</span></p>
              <p style="margin: 5px 0;"><strong>✅ 新状态：</strong> <span style="background: #e6ffe6; padding: 2px 6px; border-radius: 3px;">${newStatus}</span></p>
              <p style="margin: 5px 0;"><strong>👤 更改者：</strong> ${changedBy}</p>
              <p style="margin: 5px 0;"><strong>🏢 权限：</strong> ${authority}</p>
            </div>
          </div>

          <p style="color: #999; margin-top: 20px; font-size: 12px; border-top: 1px solid #e0e0e0; padding-top: 15px;">
            Tax Control System | 税务控制系统
          </p>
        </div>
      </body>
      </html>
    `
  };
};

// 🌐 Activity Added Notification Email Template (Bilingual)
const getActivityAddedEmailContent = (documentTitle, tramiteNumber, activityDescription, dueDate, priority, addedBy) => {
  return {
    subject: "✅ Actividad Agregada | 已添加活动 - Nueva Actividad | 新活动",
    html: `
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">

          <!-- SPANISH -->
          <div style="margin-bottom: 40px; padding-bottom: 30px; border-bottom: 2px solid #e0e0e0;">
            <h2 style="color: #204070;">✅ Actividad Agregada</h2>
            <p>Se ha agregado una nueva actividad al documento "<strong>${documentTitle}</strong>" (Trámite: ${tramiteNumber}).</p>

            <div style="background-color: #f9f9f9; border-left: 4px solid #204070; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 5px 0;"><strong>📄 Documento:</strong> ${documentTitle}</p>
              <p style="margin: 5px 0;"><strong>📝 Actividad:</strong> ${activityDescription}</p>
              <p style="margin: 5px 0;"><strong>📅 Fecha Límite:</strong> ${dueDate}</p>
              <p style="margin: 5px 0;"><strong>⚡ Prioridad:</strong> <span style="background: ${priority === 'High' ? '#ffcccc' : priority === 'Medium' ? '#ffffcc' : '#ccffcc'}; padding: 2px 6px; border-radius: 3px;">${priority}</span></p>
              <p style="margin: 5px 0;"><strong>👤 Agregada por:</strong> ${addedBy}</p>
            </div>
          </div>

          <!-- CHINESE -->
          <div>
            <h2 style="color: #204070;">✅ 已添加活动</h2>
            <p>已向文档"<strong>${documentTitle}</strong>"（程序：${tramiteNumber}）添加新活动。</p>

            <div style="background-color: #f9f9f9; border-left: 4px solid #204070; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 5px 0;"><strong>📄 文档：</strong> ${documentTitle}</p>
              <p style="margin: 5px 0;"><strong>📝 活动：</strong> ${activityDescription}</p>
              <p style="margin: 5px 0;"><strong>📅 截止日期：</strong> ${dueDate}</p>
              <p style="margin: 5px 0;"><strong>⚡ 优先级：</strong> <span style="background: ${priority === 'High' ? '#ffcccc' : priority === 'Medium' ? '#ffffcc' : '#ccffcc'}; padding: 2px 6px; border-radius: 3px;">${priority}</span></p>
              <p style="margin: 5px 0;"><strong>👤 由以下人员添加：</strong> ${addedBy}</p>
            </div>
          </div>

          <p style="color: #999; margin-top: 20px; font-size: 12px; border-top: 1px solid #e0e0e0; padding-top: 15px;">
            Tax Control System | 税务控制系统
          </p>
        </div>
      </body>
      </html>
    `
  };
};

// 🌐 Contestation Added Notification Email Template (Bilingual)
const getContestationAddedEmailContent = (documentTitle, tramiteNumber, notes, contactMethod, presentationDate, registeredBy) => {
  return {
    subject: "💬 Contestación Registrada | 已注册异议 - Nueva Contestación | 新异议",
    html: `
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">

          <!-- SPANISH -->
          <div style="margin-bottom: 40px; padding-bottom: 30px; border-bottom: 2px solid #e0e0e0;">
            <h2 style="color: #204070;">💬 Contestación Registrada</h2>
            <p>Se ha registrado una nueva contestación en el documento "<strong>${documentTitle}</strong>" (Trámite: ${tramiteNumber}).</p>

            <div style="background-color: #f9f9f9; border-left: 4px solid #204070; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 5px 0;"><strong>📄 Documento:</strong> ${documentTitle}</p>
              <p style="margin: 5px 0;"><strong>📝 Notas:</strong> ${notes}</p>
              <p style="margin: 5px 0;"><strong>📞 Método de Contacto:</strong> ${contactMethod}</p>
              <p style="margin: 5px 0;"><strong>📅 Fecha de Presentación:</strong> ${presentationDate}</p>
              <p style="margin: 5px 0;"><strong>👤 Registrada por:</strong> ${registeredBy}</p>
            </div>
          </div>

          <!-- CHINESE -->
          <div>
            <h2 style="color: #204070;">💬 已注册异议</h2>
            <p>已在文档"<strong>${documentTitle}</strong>"（程序：${tramiteNumber}）中注册新异议。</p>

            <div style="background-color: #f9f9f9; border-left: 4px solid #204070; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 5px 0;"><strong>📄 文档：</strong> ${documentTitle}</p>
              <p style="margin: 5px 0;"><strong>📝 备注：</strong> ${notes}</p>
              <p style="margin: 5px 0;"><strong>📞 联系方式：</strong> ${contactMethod}</p>
              <p style="margin: 5px 0;"><strong>📅 提交日期：</strong> ${presentationDate}</p>
              <p style="margin: 5px 0;"><strong>👤 由以下人员注册：</strong> ${registeredBy}</p>
            </div>
          </div>

          <p style="color: #999; margin-top: 20px; font-size: 12px; border-top: 1px solid #e0e0e0; padding-top: 15px;">
            Tax Control System | 税务控制系统
          </p>
        </div>
      </body>
      </html>
    `
  };
};

// 4️⃣ Endpoint raíz (para healthcheck de Coolify)
app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "TaxControl-Api is running", version: "2.0" });
});

// 4️⃣ Endpoint de salud (con info de conexión)
app.get("/api/health", async (_req, res) => {
  let dbStatus = "disconnected";
  let dbVersion = null;
  let documentCount = 0;

  try {
    const [rows] = await pool.query("SELECT VERSION() AS version");
    dbStatus = "connected";
    dbVersion = rows[0].version;

    // Try to get document count
    const [countRows] = await pool.query("SELECT COUNT(*) as count FROM documents");
    documentCount = countRows[0]?.count || 0;
  } catch (error) {
    console.error("Health check DB error:", error);
  }

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    database: { status: dbStatus, version: dbVersion, documents: documentCount },
    api: "TaxControl-Api v2.0"
  });
});

// 5️⃣ Endpoint de prueba DB
app.get("/api/db-test", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT VERSION() AS version");
    res.json({ status: "connected", mariadb: rows[0].version });
  } catch (error) {
    console.error("DB ERROR:", error);
    res.status(500).json({ error: error.message, code: error.code });
  }
});

// 6️⃣ Middleware verificar sesión (con cache en memoria, TTL 5 min)
const sessionCache = new Map();
const SESSION_CACHE_TTL = 5 * 60 * 1000;

const requireAuth = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return res.status(401).json({ error: "No autorizado" });
  const token = auth.slice(7);

  const cached = sessionCache.get(token);
  if (cached && cached.cachedAt + SESSION_CACHE_TTL > Date.now()) {
    req.user = cached.user;
    return next();
  }

  try {
    const [rows] = await pool.query(
      `SELECT s.*, u.name, u.email, u.avatar_url
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = ? AND s.expires_at > NOW()`,
      [token]
    );
    if (rows.length === 0)
      return res.status(401).json({ error: "Sesión expirada o inválida" });
    req.user = rows[0];
    sessionCache.set(token, { user: rows[0], cachedAt: Date.now() });
    next();
  } catch (error) {
    // Fallback para desarrollo: si BD no está disponible, aceptar cualquier token
    // y crear un usuario Admin dummy para pruebas
    if (error.code === 'ECONNREFUSED' || error.code === 'PROTOCOL_CONNECTION_LOST') {
      console.log('⚠️ DB unavailable, accepting token for testing with Admin user');
      const dummyUser = { user_id: 'test-user', name: 'Test Admin', email: 'test@test.com', role: 'Admin' };
      req.user = dummyUser;
      sessionCache.set(token, { user: dummyUser, cachedAt: Date.now() });
      return next();
    }
    res.status(500).json({ error: "Error verificando sesión" });
  }
};

// Limpia sesiones expiradas del cache cada 10 minutos
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessionCache.entries()) {
    if (entry.cachedAt + SESSION_CACHE_TTL <= now) sessionCache.delete(token);
  }
}, 10 * 60 * 1000).unref?.();

// 7️⃣ Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email y contraseña requeridos" });
  try {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0)
      return res.status(401).json({ error: "Credenciales incorrectas" });
    const user = rows[0];
    const hash = crypto.createHash("sha256").update(user.id + password).digest("hex");
    if (hash !== user.password_hash)
      return res.status(401).json({ error: "Credenciales incorrectas" });
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días
    await pool.query(
      "INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)",
      [token, user.id, user.role, expiresAt]
    );
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_url: user.avatar_url },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// 8️⃣ Logout
app.post("/api/auth/logout", async (req, res) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    await pool.query("DELETE FROM sessions WHERE token = ?", [token]);
    sessionCache.delete(token);
  }
  res.json({ ok: true });
});

// Descargar archivos con nombre original (desde BD, fallback a disco legacy)
app.get('/api/download/:filename', requireAuth, async (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/')) {
      console.warn(`[download] Filename inválido rechazado: '${filename}'`);
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const stored = await loadStoredFile(filename);

    if (!stored) {
      console.error(`[download] Archivo NO encontrado en BD ni en disco: ${filename}`);
      return res.status(404).json({
        error: 'File not found',
        filename,
        hint: 'El archivo no existe en la base de datos ni en el servidor. Si es un documento antiguo, su archivo pudo perderse en un redespliegue previo (antes de migrar el almacenamiento a la base de datos).'
      });
    }

    console.log(`[download] Sirviendo archivo: ${filename} (${stored.mimeType})`);
    res.setHeader('Content-Type', stored.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(stored.fileName)}`);
    res.send(stored.buffer);
  } catch (error) {
    console.error('[download] Error inesperado:', error);
    res.status(500).json({ error: error.message });
  }
});


// 9️⃣ Usuario actual
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Faltan campos requeridos" });
  if (newPassword.length < 6)
    return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres" });
  if (currentPassword === newPassword)
    return res.status(400).json({ error: "La nueva contraseña debe ser diferente a la actual" });
  try {
    const userId = req.user.user_id;
    const [users] = await pool.query("SELECT * FROM users WHERE id = ?", [userId]);
    if (users.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    const user = users[0];
    const currentHash = crypto.createHash("sha256").update(userId + currentPassword).digest("hex");
    if (currentHash !== user.password_hash)
      return res.status(401).json({ error: "La contraseña actual es incorrecta" });
    const newHash = crypto.createHash("sha256").update(userId + newPassword).digest("hex");
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, userId]);
    res.json({ message: "Contraseña actualizada exitosamente" });
  } catch (error) {
    console.error("[change-password] Error:", error);
    res.status(500).json({ error: "Error al cambiar la contraseña" });
  }
});
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// 🔑 POST solicitar reset de contraseña (sin autenticación)
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email requerido" });
  try {
    const [rows] = await pool.query("SELECT id, name FROM users WHERE email = ?", [email]);
    // Respuesta genérica siempre (no revelar si el email existe)
    if (rows.length === 0) {
      return res.json({ ok: true, message: "Si el email existe, recibirás un enlace de recuperación." });
    }
    const user = rows[0];
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Guardar token en BD (reutiliza tabla password_resets si existe, si no la crea)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        token VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT NOW()
      )
    `);
    // Eliminar tokens previos del usuario y guardar el nuevo
    await pool.query("DELETE FROM password_resets WHERE user_id = ?", [user.id]);
    await pool.query(
      "INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)",
      [token, user.id, expiresAt]
    );

    // Enviar email con el link
    const appUrl = process.env.APP_URL || "http://192.168.60.109/taxcontrol";
    const resetLink = `${appUrl}/#/reset-password?token=${token}`;
    try {
      const transporter = await getEmailTransporter();
      const config = await getSmtpConfig();
      await transporter.sendMail({
        from: `"${config.from_name}" <${config.from_email}>`,
        to: email,
        subject: "🔑 Recuperación de contraseña | Tax Control",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
            <h2 style="color:#204070;">🔑 Recuperación de Contraseña</h2>
            <p>Hola <strong>${user.name}</strong>,</p>
            <p>Recibimos una solicitud para restablecer tu contraseña en Tax Control.</p>
            <p style="margin:28px 0;">
              <a href="${resetLink}"
                 style="background:#204070;color:white;padding:12px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;">
                Restablecer Contraseña
              </a>
            </p>
            <p style="color:#666;font-size:13px;">Este enlace es válido por <strong>1 hora</strong>. Si no solicitaste este cambio, ignora este email.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
            <p style="color:#999;font-size:11px;">Tax Control — ECSA</p>
          </div>
        `
      });
    } catch (mailErr) {
      console.error("Error enviando email de reset:", mailErr.message);
      // El token ya está guardado — devolver el link directamente si el SMTP falla
      // para que el admin pueda enviarlo manualmente o el usuario lo use de inmediato
      return res.status(503).json({
        error: `No se pudo enviar el email: ${mailErr.message}`,
        resetLink // devuelve el link para que el admin pueda compartirlo manualmente
      });
    }

    res.json({ ok: true, message: "Email enviado. Revisa tu bandeja de entrada (y carpeta de spam)." });
  } catch (error) {
    console.error("forgot-password error:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

// 🔑 POST restablecer contraseña con token (sin autenticación)
app.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Token y contraseña requeridos" });
  if (password.length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  try {
    const [rows] = await pool.query(
      "SELECT * FROM password_resets WHERE token = ? AND expires_at > NOW()",
      [token]
    );
    if (rows.length === 0) return res.status(400).json({ error: "Token inválido o expirado" });

    const userId = rows[0].user_id;
    const hash = crypto.createHash("sha256").update(userId + password).digest("hex");
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, userId]);
    await pool.query("DELETE FROM password_resets WHERE user_id = ?", [userId]);
    // Invalidar todas las sesiones activas del usuario
    await pool.query("DELETE FROM sessions WHERE user_id = ?", [userId]);

    res.json({ ok: true, message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error("reset-password error:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

// 👥 GET todos los usuarios
app.get("/api/users", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, role, avatar_url FROM users ORDER BY created_at ASC"
    );
    res.json(rows.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, avatar: u.avatar_url })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 👥 POST crear usuario
app.post("/api/users", requireAuth, async (req, res) => {
  const { name, email, role, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "Nombre, email y contraseña requeridos" });
  try {
    const id = "u" + Date.now();
    const hash = crypto.createHash("sha256").update(id + password).digest("hex");
    await pool.query(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      [id, name, email, hash, role || "Operator"]
    );

    // 📧 Enviar email con credenciales (asincrónico, no bloquea la respuesta)
    (async () => {
      try {
        const transporter = await getEmailTransporter();
        const config = await getSmtpConfig();

        // Get email template with both Spanish and Simplified Chinese
        const emailTemplate = getWelcomeEmailContent(name, email, password, role);

        await transporter.sendMail({
          from: `"${config.from_name}" <${config.from_email}>`,
          to: email,
          subject: emailTemplate.subject,
          html: emailTemplate.html
        });

        console.log(`Welcome email sent to ${email} for new user ${id} (Bilingual: Spanish + Simplified Chinese)`);
      } catch (error) {
        console.error(`Error sending welcome email to ${email}:`, error.message);
      }
    })();

    res.status(201).json({ id, name, email, role: role || "Operator" });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res.status(400).json({ error: "El email ya está registrado" });
    res.status(500).json({ error: error.message });
  }
});

// 👥 PUT actualizar usuario
app.put("/api/users/:id", requireAuth, async (req, res) => {
  const { name, email, role, password } = req.body;
  try {
    if (password) {
      const hash = crypto.createHash("sha256").update(req.params.id + password).digest("hex");
      await pool.query(
        "UPDATE users SET name=?, email=?, role=?, password_hash=? WHERE id=?",
        [name, email, role, hash, req.params.id]
      );
    } else {
      await pool.query(
        "UPDATE users SET name=?, email=?, role=? WHERE id=?",
        [name, email, role, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 👥 DELETE eliminar usuario
app.delete("/api/users/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM sessions WHERE user_id = ?", [req.params.id]);
    await pool.query("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 👥 POST /update — workaround para proxy que bloquea PUT
app.post("/api/users/:id/update", requireAuth, async (req, res) => {
  const { name, email, role, password } = req.body;
  try {
    if (password) {
      const hash = crypto.createHash("sha256").update(req.params.id + password).digest("hex");
      await pool.query(
        "UPDATE users SET name=?, email=?, role=?, password_hash=? WHERE id=?",
        [name, email, role, hash, req.params.id]
      );
    } else {
      await pool.query(
        "UPDATE users SET name=?, email=?, role=? WHERE id=?",
        [name, email, role, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 👥 POST /delete — workaround para proxy que bloquea DELETE
app.post("/api/users/:id/delete", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM sessions WHERE user_id = ?", [req.params.id]);
    await pool.query("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📁 POST cargar archivo — guarda los bytes en la BD (LONGBLOB), cualquier formato
app.post("/api/upload", requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No se ha cargado ningún archivo' });
    }

    await ensureDocumentFilesTable();

    const storageKey = makeStorageKey(req.file.originalname);
    const mimeType = req.file.mimetype || guessMimeType(req.file.originalname);

    await pool.query(
      `INSERT INTO document_files (id, file_name, mime_type, data, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [storageKey, req.file.originalname, mimeType, req.file.buffer, req.file.size, req.user?.user_id || null]
    );

    const fileUrl = `/api/files/${storageKey}`;
    console.log(`[upload] ✅ Archivo guardado en BD: ${req.file.originalname} (${req.file.size} bytes, ${mimeType}) → ${storageKey}`);
    res.json({
      success: true,
      fileUrl,
      fileName: req.file.originalname,
      mimeType,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📄 GET todos los documentos (con filtros opcionales)
app.get("/api/documents", requireAuth, async (req, res) => {
  try {
    const { company_id, authority, page = 1, limit = 20, year, exclude_year } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(500, Math.max(5, parseInt(limit) || 20));
    const offset = (pageNum - 1) * pageSize;

    // 🚀 Check cache first (60s TTL)
    const cacheKey = `docs:${company_id || 'all'}:${authority || 'all'}:${pageNum}:${pageSize}:${year || 'all'}:${exclude_year || 'none'}`;
    const cached = getCachedDocs(cacheKey);
    if (cached) return res.json(cached);

    let query = `
      SELECT d.id, d.title, d.trarnite_number, d.document_number, d.company_id, c.name as company_name, d.authority,
             d.department, d.notification_date, d.days_limit, d.day_type, d.due_date, d.status,
             d.summary_es, d.summary_cn, d.file_name, d.file_url, d.related_doc_id,
             d.created_by, u.name as created_by_name, d.created_at,
             d.last_edited_by, u2.name as last_edited_by_name, d.last_edited_at
      FROM documents d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN users u2 ON d.last_edited_by = u2.id
      WHERE 1=1
    `;
    let countQuery = `SELECT COUNT(*) as total FROM documents d WHERE 1=1`;
    const params = [];
    const countParams = [];

    if (company_id && company_id !== 'Todas') {
      query += ` AND d.company_id = ?`;
      countQuery += ` AND d.company_id = ?`;
      params.push(company_id);
      countParams.push(company_id);
    }

    if (authority && authority !== 'Todas') {
      query += ` AND d.authority LIKE ?`;
      countQuery += ` AND d.authority LIKE ?`;
      params.push(`%${authority}%`);
      countParams.push(`%${authority}%`);
    }

    // 🚀 Filter by specific year (for incremental loading)
    if (year) {
      query += ` AND YEAR(d.notification_date) = ?`;
      countQuery += ` AND YEAR(d.notification_date) = ?`;
      params.push(parseInt(year));
      countParams.push(parseInt(year));
    }

    // 🚀 Exclude a specific year (to load everything except the first-loaded year)
    if (exclude_year) {
      query += ` AND YEAR(d.notification_date) != ?`;
      countQuery += ` AND YEAR(d.notification_date) != ?`;
      params.push(parseInt(exclude_year));
      countParams.push(parseInt(exclude_year));
    }

    query += ` ORDER BY d.notification_date DESC LIMIT ? OFFSET ?`;
    params.push(pageSize, offset);

    // 🚀 Execute count and main query in parallel
    const [[rows], [countRows]] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams)
    ]);
    const total = countRows[0]?.total || 0;

    const docs = rows.map(d => ({
      id: d.id,
      title: d.title,
      trarniteNumber: d.trarnite_number,
      documentNumber: d.document_number,
      companyId: d.company_id,
      company: d.company_name || 'Unknown',
      authority: d.authority,
      department: d.department,
      notificationDate: d.notification_date?.toISOString?.().split('T')[0],
      daysLimit: d.days_limit,
      dayType: d.day_type,
      dueDate: d.due_date?.toISOString?.().split('T')[0],
      status: d.status,
      summaryEs: d.summary_es,
      summaryCn: d.summary_cn,
      fileName: d.file_name,
      fileUrl: d.file_url,
      createdBy: d.created_by_name || d.created_by,
      createdAt: d.created_at?.toISOString?.().split('T')[0],
      lastEditedBy: d.last_edited_by_name || d.last_edited_by,
      lastEditedAt: d.last_edited_at?.toISOString?.().split('T')[0],
      contestations: []
    }));

    const response = {
      documents: docs,
      total: total,
      page: pageNum,
      limit: pageSize,
      hasMore: pageNum < Math.ceil(total / pageSize)
    };
    setCachedDocs(cacheKey, response);
    res.json(response);
  } catch (error) {
    console.error("GET /api/documents error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 🚀 GET /api/documents/dashboard - Combined endpoint: stats + breakdown + by-deadline in ONE round-trip
app.get("/api/documents/dashboard", requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const next7 = new Date(); next7.setDate(next7.getDate() + 7);
    const next7Str = next7.toISOString().split('T')[0];
    const next15 = new Date(); next15.setDate(next15.getDate() + 15);
    const next15Str = next15.toISOString().split('T')[0];

    // Run all 3 queries in parallel at the DB level
    const [statsResult, breakdownResult, deadlineResult] = await Promise.all([
      // 1. Stats: pure SQL aggregation — no JS row iteration
      pool.query(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'En progreso' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN status != 'Completado' AND due_date >= ? AND due_date <= ? THEN 1 ELSE 0 END) as upcoming,
          SUM(CASE WHEN status != 'Completado' AND due_date < ? THEN 1 ELSE 0 END) as overdue
        FROM documents
      `, [today, next15Str, today]),

      // 2. Status breakdown: simple GROUP BY
      pool.query(`SELECT status, COUNT(*) as count FROM documents GROUP BY status ORDER BY count DESC`),

      // 3. Deadline docs: only non-completed within 15 days + overdue
      pool.query(`
        SELECT id, title, trarnite_number, due_date, status, company_id, authority, department
        FROM documents
        WHERE status != 'Completado'
          AND due_date IS NOT NULL
          AND due_date <= ?
        ORDER BY due_date ASC
        LIMIT 100
      `, [next15Str])
    ]);

    const [statsRows] = statsResult;
    const [breakdownRows] = breakdownResult;
    const [deadlineRows] = deadlineResult;

    const stats = {
      total: Number(statsRows[0].total),
      inProgress: Number(statsRows[0].in_progress),
      upcoming: Number(statsRows[0].upcoming),
      overdue: Number(statsRows[0].overdue)
    };

    const statusBreakdown = breakdownRows.map(r => ({ status: r.status || 'Sin estado', count: Number(r.count) }));

    const overdue = [], upcoming7 = [], upcoming15 = [];
    for (const d of deadlineRows) {
      let dueDate = d.due_date instanceof Date ? d.due_date.toISOString().split('T')[0] : d.due_date;
      if (!dueDate) continue;
      const doc = { id: d.id, title: d.title, trarniteNumber: d.trarnite_number, company: d.company_id, authority: d.authority, department: d.department, dueDate, status: d.status };
      if (dueDate < today) overdue.push(doc);
      else if (dueDate <= next7Str) upcoming7.push(doc);
      else upcoming15.push(doc);
    }

    // Debug logging for date inconsistencies
    if (overdue.length > 0) console.log('[Dashboard] Overdue docs:', overdue.map(d => ({ id: d.id, title: d.title, dueDate: d.dueDate })));
    if (upcoming7.length > 0) console.log('[Dashboard] Upcoming7 docs:', upcoming7.map(d => ({ id: d.id, title: d.title, dueDate: d.dueDate })));
    if (upcoming15.length > 0) console.log('[Dashboard] Upcoming15 docs:', upcoming15.map(d => ({ id: d.id, title: d.title, dueDate: d.dueDate })));

    // Check for duplicate IDs across categories
    const allIds = [...overdue.map(d => d.id), ...upcoming7.map(d => d.id), ...upcoming15.map(d => d.id)];
    const uniqueIds = new Set(allIds);
    if (allIds.length !== uniqueIds.size) {
      console.warn('[Dashboard] WARNING: Duplicate document IDs found across categories!');
      const idCounts = {};
      allIds.forEach(id => idCounts[id] = (idCounts[id] || 0) + 1);
      const duplicates = Object.entries(idCounts).filter(([_, count]) => count > 1);
      console.warn('[Dashboard] Duplicates:', duplicates);
    }

    res.json({ stats, statusBreakdown, byDeadline: { overdue, upcoming7, upcoming15 } });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📊 GET Dashboard Statistics (all documents stats)
app.get("/api/documents/stats", requireAuth, async (req, res) => {
  try {
    const [docs] = await pool.query('SELECT status, due_date FROM documents');

    const today = new Date().toISOString().split('T')[0];
    const upcoming15 = new Date();
    upcoming15.setDate(upcoming15.getDate() + 15);
    const upcoming15Str = upcoming15.toISOString().split('T')[0];

    let inProgress = 0;
    let upcoming = 0;
    let overdue = 0;

    for (const doc of docs) {
      if (doc.status === 'En progreso') inProgress++;
      let dueDate = doc.due_date;
      if (dueDate instanceof Date) {
        dueDate = dueDate.toISOString().split('T')[0];
      }
      if (dueDate && dueDate < today && doc.status !== 'Completado') overdue++;
      else if (dueDate && dueDate >= today && dueDate <= upcoming15Str && doc.status !== 'Completado') upcoming++;
    }

    res.json({ total: docs.length, inProgress, upcoming, overdue });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.json({ total: 0, inProgress: 0, upcoming: 0, overdue: 0 });
  }
});

// 📈 GET Status Breakdown (for pie chart)
app.get("/api/documents/status-breakdown", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT status, COUNT(*) as count FROM documents GROUP BY status ORDER BY count DESC'
    );
    res.json(rows.map((row) => ({ status: row.status || 'Sin estado', count: row.count })));
  } catch (error) {
    console.error('Error fetching status breakdown:', error);
    res.json([]);
  }
});

// 📋 GET Documents by Deadline Status
app.get("/api/documents/by-deadline", requireAuth, async (req, res) => {
  try {
    const [allDocs] = await pool.query(`
      SELECT id, title, trarnite_number, due_date, status, company_id, authority, department,
             notification_date, days_limit, day_type, file_name, file_url, created_by, created_at
      FROM documents
      WHERE status != 'Completado'
    `);

    const today = new Date().toISOString().split('T')[0];
    const next7 = new Date();
    next7.setDate(next7.getDate() + 7);
    const next7Str = next7.toISOString().split('T')[0];
    const next15 = new Date();
    next15.setDate(next15.getDate() + 15);
    const next15Str = next15.toISOString().split('T')[0];

    const overdue = [];
    const upcoming7 = [];
    const upcoming15 = [];

    for (const d of allDocs) {
      let dueDate = d.due_date;
      if (dueDate instanceof Date) {
        dueDate = dueDate.toISOString().split('T')[0];
      }
      if (!dueDate) continue;

      const doc = {
        id: d.id,
        title: d.title,
        trarniteNumber: d.trarnite_number,
        company: d.company_id,
        authority: d.authority,
        department: d.department,
        dueDate,
        status: d.status
      };

      if (dueDate < today) {
        overdue.push(doc);
      } else if (dueDate >= today && dueDate <= next7Str) {
        upcoming7.push(doc);
      } else if (dueDate > next7Str && dueDate <= next15Str) {
        upcoming15.push(doc);
      }
    }

    res.json({ overdue, upcoming7, upcoming15 });
  } catch (error) {
    console.error('Error fetching by-deadline:', error);
    res.json({ overdue: [], upcoming7: [], upcoming15: [] });
  }
});

// 🔍 Diagnostic endpoint to find duplicate/similar documents by title pattern
app.get("/api/documents/search/duplicates", requireAuth, async (req, res) => {
  try {
    const { title } = req.query;
    if (!title) return res.status(400).json({ error: "title parameter required" });

    const [docs] = await pool.query(`
      SELECT id, title, due_date, status, created_at
      FROM documents
      WHERE title LIKE ?
      ORDER BY title, due_date ASC
    `, [`%${title}%`]);

    res.json({ found: docs.length, documents: docs });
  } catch (error) {
    console.error('Error searching duplicates:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📄 GET un documento por ID (optimized with parallel queries)
app.get("/api/documents/:id", requireAuth, async (req, res) => {
  try {
    const docId = req.params.id;

    // 🚀 Ejecutar 3 queries en paralelo en lugar de secuencial
    const [docRows, contestationRows, attachmentRows, activityRows] = await Promise.all([
      pool.query(`
        SELECT d.*, c.name as company_name, u.name as created_by_name, u2.name as last_edited_by_name
        FROM documents d
        LEFT JOIN companies c ON d.company_id = c.id
        LEFT JOIN users u ON d.created_by = u.id
        LEFT JOIN users u2 ON d.last_edited_by = u2.id
        WHERE d.id = ?
      `, [docId]),
      pool.query(`
        SELECT c.*, u.name as registered_by_name
        FROM contestations c
        LEFT JOIN users u ON c.registered_by = u.id
        WHERE c.document_id = ?
      `, [docId]),
      pool.query(`
        SELECT * FROM document_attachments
        WHERE document_id = ?
        LIMIT 100
      `, [docId]),
      pool.query(`
        SELECT a.*, u.name as completed_by_name
        FROM activities a
        LEFT JOIN users u ON a.completed_by = u.id
        WHERE a.document_id = ?
        ORDER BY a.due_date DESC
        LIMIT 50
      `, [docId])
    ]);

    if (docRows[0].length === 0)
      return res.status(404).json({ error: "Documento no encontrado" });

    const d = docRows[0][0];
    const contestations = contestationRows[0];
    const attachments = attachmentRows[0];
    const rawActivities = activityRows[0];

    // 📋 Map activities with proper date formatting for audit trail
    const activities = rawActivities.map((a) => ({
      id: a.id,
      docId: a.document_id,
      description: a.description,
      subDescription: a.sub_description,
      status: a.status,
      dueDate: a.due_date?.toISOString?.().split('T')[0] || a.due_date,
      priority: a.priority,
      completedBy: a.completed_by_name || a.completed_by,
      completedAt: a.completed_at?.toISOString?.().split('T')[0] || a.completed_at
    }));

    // 🚀 Cargar TODOS los archivos en UNA sola query (evita N+1)
    let filesByContestation = {};
    if (contestations.length > 0) {
      const cIds = contestations.map(c => c.id);
      const placeholders = cIds.map(() => '?').join(',');
      const [allFiles] = await pool.query(
        `SELECT * FROM contestation_files WHERE contestation_id IN (${placeholders})`,
        cIds
      );
      filesByContestation = allFiles.reduce((acc, f) => {
        (acc[f.contestation_id] = acc[f.contestation_id] || []).push(f);
        return acc;
      }, {});
    }

    const contestationsWithFiles = contestations.map((c) => {
      const files = filesByContestation[c.id] || [];
      return {
          id: c.id,
          date: c.presentation_date?.toISOString?.().split('T')[0],
          authority: c.authority_received,
          notes: c.notes,
          contact_method: c.contact_method,
          registered_by: c.registered_by_name || c.registered_by,
          registration_date: c.registration_date?.toISOString?.().split('T')[0],
          files: files || []
        };
    });

    res.json({
      id: d.id, title: d.title, trarniteNumber: d.trarnite_number, documentNumber: d.document_number,
      company: d.company_name || null, authority: d.authority,
      department: d.department,
      notificationDate: d.notification_date?.toISOString?.().split('T')[0],
      daysLimit: d.days_limit, dayType: d.day_type,
      dueDate: d.due_date?.toISOString?.().split('T')[0],
      status: d.status, summaryEs: d.summary_es, summaryCn: d.summary_cn,
      fileName: d.file_name, fileUrl: d.file_url, relatedDoc: d.related_doc_id,
      createdBy: d.created_by_name || d.created_by,
      createdAt: d.created_at?.toISOString?.().split('T')[0],
      lastEditedBy: d.last_edited_by_name || d.last_edited_by,
      lastEditedAt: d.last_edited_at?.toISOString?.().split('T')[0],
      contestations: contestationsWithFiles,
      attachments,
      activities
    });
  } catch (error) {
    console.error("Error fetching document:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📄 POST crear documento
app.post("/api/documents", requireAuth, async (req, res) => {
  const d = req.body;

  if (!d.title || !d.authority || !d.dueDate) {
    return res.status(400).json({ error: "Campos requeridos: title, authority, dueDate" });
  }
  if (!d.documentNumber && !d.trarniteNumber) {
    return res.status(400).json({ error: "Se requiere al menos uno: Número de Oficio (documentNumber) o Número de Trámite (trarniteNumber)" });
  }

  const notificationDate = d.notificationDate || new Date().toISOString().split('T')[0];
  const dueDate = d.dueDate || new Date().toISOString().split('T')[0];
  const dayType = d.dayType || 'Días hábiles';

  try {
    // Validación de duplicados: prioridad al número de oficio (documentNumber)
    if (d.documentNumber) {
      const [existingByDocNum] = await pool.query('SELECT id FROM documents WHERE document_number = ?', [d.documentNumber]);
      if (existingByDocNum.length > 0) {
        return res.status(409).json({ error: `El número de oficio '${d.documentNumber}' ya existe en la base de datos` });
      }
      // Número de oficio es nuevo → aceptar sin verificar trámite
    } else if (d.trarniteNumber) {
      const [existing] = await pool.query('SELECT id FROM documents WHERE trarnite_number = ?', [d.trarniteNumber]);
      if (existing.length > 0) {
        return res.status(409).json({ error: `El número de trámite '${d.trarniteNumber}' ya existe en la base de datos` });
      }
    }

    let companyId = null;

    // Si se proporciona company, normalizar y validar
    if (d.company) {
      const normalizedCompany = normalizeCompanyName(d.company);
      // Rechazar si el nombre no es una de las 5 compañías válidas
      if (!normalizedCompany) {
        return res.status(400).json({
          error: `Compañía inválida: '${d.company}'. Solo se permiten: ECSA, EXSA, HCSA, PCSA, MMSA`
        });
      }
      let [companies] = await pool.query('SELECT id FROM companies WHERE name = ?', [normalizedCompany]);
      if (companies.length > 0) {
        companyId = companies[0].id;
      } else {
        companyId = await createCompany(normalizedCompany);
      }
    }

    const id = d.id || `d${Date.now()}`;
    await pool.query(`
      INSERT INTO documents
        (id, title, trarnite_number, document_number, company_id, authority, department,
         notification_date, days_limit, day_type, due_date, status,
         summary_es, summary_cn, file_name, file_url, related_doc_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, d.title, d.trarniteNumber || null, d.documentNumber || null, companyId, d.authority, d.department || null,
      notificationDate, d.daysLimit || 0, dayType, dueDate,
      d.status || "Inicializado", d.summaryEs || '', d.summaryCn || '',
      d.fileName || null, d.fileUrl || null, d.relatedDoc || null, req.user.user_id
    ]);
    invalidateDocsCache();
    res.status(201).json({ id, ...d });
  } catch (error) {
    console.error("POST /api/documents error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📄 PUT actualizar documento
const updateDocumentHandler = async (req, res) => {
  const d = req.body;
  const id = req.params.id;
  console.log('📥 PUT/POST /api/documents/:id recibido company:', d.company, 'state:', d);

  if (!d.title || !d.authority || !d.dueDate) {
    return res.status(400).json({ error: "Campos requeridos: title, authority, dueDate" });
  }
  if (!d.documentNumber && !d.trarniteNumber) {
    return res.status(400).json({ error: "Se requiere al menos uno: Número de Oficio (documentNumber) o Número de Trámite (trarniteNumber)" });
  }

  const notificationDate = d.notificationDate || new Date().toISOString().split('T')[0];
  const dueDate = d.dueDate || new Date().toISOString().split('T')[0];
  const dayType = d.dayType || 'Días hábiles';

  try {
    const [oldDocRows] = await pool.query('SELECT * FROM documents WHERE id = ?', [id]);
    if (oldDocRows.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    const oldDoc = oldDocRows[0];

    // Validación de duplicados: prioridad al número de oficio (documentNumber)
    if (d.documentNumber) {
      if (d.documentNumber !== oldDoc.document_number) {
        const [existingByDocNum] = await pool.query('SELECT id FROM documents WHERE document_number = ? AND id != ?', [d.documentNumber, id]);
        if (existingByDocNum.length > 0) {
          return res.status(409).json({ error: `El número de oficio '${d.documentNumber}' ya existe en otro documento` });
        }
      }
      // Número de oficio es nuevo o no cambió → aceptar sin verificar trámite
    } else if (d.trarniteNumber) {
      if (d.trarniteNumber !== oldDoc.trarnite_number) {
        const [existing] = await pool.query('SELECT id FROM documents WHERE trarnite_number = ? AND id != ?', [d.trarniteNumber, id]);
        if (existing.length > 0) {
          return res.status(409).json({ error: `El número de trámite '${d.trarniteNumber}' ya existe en otro documento` });
        }
      }
    }

    let companyId = null;

    // Si se proporciona company, normalizar y validar
    if (d.company) {
      const normalizedCompany = normalizeCompanyName(d.company);
      // Rechazar si el nombre no es una de las 5 compañías válidas
      if (!normalizedCompany) {
        return res.status(400).json({
          error: `Compañía inválida: '${d.company}'. Solo se permiten: ECSA, EXSA, HCSA, PCSA, MMSA`
        });
      }
      let [companies] = await pool.query('SELECT id FROM companies WHERE name = ?', [normalizedCompany]);
      if (companies.length > 0) {
        companyId = companies[0].id;
      } else {
        companyId = await createCompany(normalizedCompany);
      }
    }

    // Update the document
    const [result] = await pool.query(`
      UPDATE documents SET
        title = ?, trarnite_number = ?, document_number = ?, company_id = ?, authority = ?,
        department = ?, notification_date = ?, days_limit = ?, day_type = ?,
        due_date = ?, status = ?, summary_es = ?, summary_cn = ?,
        file_name = ?, file_url = ?, related_doc_id = ?, last_edited_by = ?, last_edited_at = NOW()
      WHERE id = ?
    `, [
      d.title, d.trarniteNumber || null, d.documentNumber || null, companyId, d.authority,
      d.department || null, notificationDate, d.daysLimit || 0, dayType,
      dueDate, d.status || 'Inicializado', d.summaryEs || '', d.summaryCn || '',
      // Conservar archivo existente si el frontend no envía fileName/fileUrl
      // (las ediciones que no cambian el PDF lo omiten para evitar cuerpos enormes).
      d.fileName !== undefined ? d.fileName : oldDoc.file_name,
      d.fileUrl !== undefined ? d.fileUrl : oldDoc.file_url,
      d.relatedDoc || null, req.user.user_id, id
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    // Get recipients for notifications
    const recipients = await getDocumentRecipients(id);

    // Check for status change
    const oldStatus = oldDoc.status;
    const newStatus = d.status || 'Inicializado';
    if (oldStatus !== newStatus) {
      const emailTemplate = getStatusChangeEmailContent(d.title, d.trarniteNumber, oldStatus, newStatus, req.user.name, d.authority);
      await sendNotificationEmail(recipients, emailTemplate.subject, emailTemplate.html, id, 'status_change');
    }
    // Check for other field changes (modification)
    else if (
      oldDoc.title !== d.title ||
      oldDoc.trarnite_number !== d.trarniteNumber ||
      oldDoc.authority !== d.authority ||
      oldDoc.department !== d.department ||
      oldDoc.due_date !== dueDate ||
      oldDoc.summary_es !== (d.summaryEs || '') ||
      oldDoc.summary_cn !== (d.summaryCn || '')
    ) {
      const subject = `Documento Modificado: ${d.title}`;
      const changedFields = [];
      if (oldDoc.title !== d.title) changedFields.push(`Título: ${oldDoc.title} → ${d.title}`);
      if (oldDoc.authority !== d.authority) changedFields.push(`Autoridad: ${oldDoc.authority} → ${d.authority}`);
      if (oldDoc.department !== d.department) changedFields.push(`Departamento: ${oldDoc.department || 'N/A'} → ${d.department || 'N/A'}`);
      const oldDueDate = oldDoc.due_date?.toISOString?.().split('T')[0] || oldDoc.due_date;
      if (oldDueDate !== dueDate) changedFields.push(`Fecha de Vencimiento: ${oldDueDate} → ${dueDate}`);

      const htmlContent = `
        <html>
        <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">
            <h2 style="color: #204070;">Documento Modificado</h2>
            <p>El documento "<strong>${d.title}</strong>" (Trámite: ${d.trarniteNumber})<br/>ha sido modificado.</p>
            <p style="margin-top: 20px;"><strong>Campos actualizados:</strong></p>
            <ul>
              ${changedFields.map(field => `<li>${field}</li>`).join('')}
            </ul>
            <p style="margin-top: 20px;">
              <strong>Modificado por:</strong> ${req.user.name}<br/>
              <strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}
            </p>
            <p style="color: #999; margin-top: 30px; font-size: 12px;">Tax Control System</p>
          </div>
        </body>
        </html>
      `;
      await sendNotificationEmail(recipients, subject, htmlContent, id, 'modification');
    }

    invalidateDocsCache();
    res.json({ ok: true });
  } catch (error) {
    console.error("PUT /api/documents error:", error);
    res.status(500).json({ error: error.message });
  }
};

app.put("/api/documents/:id", requireAuth, updateDocumentHandler);
// POST /update — workaround para proxies que bloquean PUT
app.post("/api/documents/:id/update", requireAuth, updateDocumentHandler);

// 📄 DELETE eliminar documento
app.delete("/api/documents/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM documents WHERE id = ?", [req.params.id]);
    invalidateDocsCache();
    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/documents error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📋 GET actividades (fetch all activities with proper field mapping)
app.get("/api/activities", requireAuth, async (req, res) => {
  try {
    const { docId, limit = 100 } = req.query;
    const maxLimit = Math.min(500, parseInt(limit) || 100);

    let query = `
      SELECT a.*, d.title as doc_title, u.name as created_by_name, u2.name as completed_by_name
      FROM activities a
      LEFT JOIN documents d ON a.document_id = d.id
      LEFT JOIN users u ON a.created_by = u.id
      LEFT JOIN users u2 ON a.completed_by = u2.id
      WHERE 1=1
    `;
    const params = [];

    if (docId) {
      query += ` AND a.document_id = ?`;
      params.push(docId);
    }

    query += ` ORDER BY a.due_date ASC LIMIT ?`;
    params.push(maxLimit);

    const [rows] = await pool.query(query, params);

    // 🚀 Cargar archivos en PARALELO
    const activities = await Promise.all(
      rows.map(async (a) => {
        const [files] = await pool.query(
          'SELECT * FROM activity_files WHERE activity_id = ? LIMIT 50',
          [a.id]
        );
        return {
          id: a.id, docId: a.document_id, docTitle: a.doc_title,
          description: a.description, subDescription: a.sub_description,
          dueDate: a.due_date?.toISOString?.().split('T')[0],
          status: a.status, priority: a.priority,
          createdBy: a.created_by_name || a.created_by,
          createdAt: a.created_at?.toISOString?.().split('T')[0],
          completedBy: a.completed_by_name || a.completed_by,
          completedAt: a.completed_at?.toISOString?.().split('T')[0],
          files: (files || []).map(f => ({ id: f.id, name: f.file_name, url: f.file_url }))
        };
      })
    );

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📋 POST crear actividad
app.post("/api/activities", requireAuth, async (req, res) => {
  const { docId, description, subDescription, dueDate, priority, files } = req.body;
  try {
    const id = `a${Date.now()}`;

    // Insert the activity with audit trail
    await pool.query(
      `INSERT INTO activities
       (id, document_id, description, sub_description, due_date, priority, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, NOW())`,
      [id, docId, description, subDescription, dueDate, priority || 'Medium', req.user.user_id]
    );

    // Guardar archivos asociados si existen
    if (files && Array.isArray(files) && files.length > 0) {
      for (const file of files) {
        if (file.name && file.url) {
          const fileId = `af${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await pool.query(
            `INSERT INTO activity_files (id, activity_id, file_name, file_url)
             VALUES (?, ?, ?, ?)`,
            [fileId, id, file.name, file.url]
          );
        }
      }
    }

    // Get document info for notifications
    const [docRows] = await pool.query('SELECT title, trarnite_number FROM documents WHERE id = ?', [docId]);
    if (docRows.length > 0) {
      const doc = docRows[0];
      const recipients = await getDocumentRecipients(docId);
      const formattedDueDate = dueDate ? new Date(dueDate).toLocaleDateString('es-ES') : 'N/A';

      const emailTemplate = getActivityAddedEmailContent(doc.title, doc.trarnite_number, description, formattedDueDate, priority || 'Medium', req.user.name);
      await sendNotificationEmail(recipients, emailTemplate.subject, emailTemplate.html, docId, 'activity_added');
    }

    // Resincronizar estado del documento (al agregar la primera actividad pasa a 'En progreso')
    await syncDocumentStatusFromActivities(docId, req.user.name);

    const responseFiles = files && Array.isArray(files) ? files.map(f => ({ name: f.name, url: f.url })) : [];
    res.status(201).json({ id, docId, description, subDescription, dueDate, priority: priority || 'Medium', status: 'Pending', createdBy: req.user.name, createdAt: new Date().toISOString().split('T')[0], files: responseFiles });
  } catch (error) {
    console.error("POST /api/activities error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📋 PUT actualizar actividad
app.put("/api/activities/:id", requireAuth, async (req, res) => {
  const { description, subDescription, dueDate, priority, status, completedBy, completedAt, files } = req.body;
  console.log(`📥 PUT /api/activities/${req.params.id} → status=${status}, completedBy=${completedBy}, completedAt=${completedAt}, dueDate=${dueDate}, hasFiles=${Array.isArray(files)}`);
  try {
    // Actualizar actividad con los campos incluyendo completedBy y completedAt
    if (status === 'Completed') {
      // completed_by es FK a users.id: usar el id del usuario autenticado, no el nombre.
      await pool.query(
        `UPDATE activities
         SET description=?, sub_description=?, due_date=?, priority=?, status=?,
             completed_by=?, completed_at=?
         WHERE id=?`,
        [description, subDescription, dueDate, priority, status, req.user.user_id, completedAt || new Date().toISOString().split('T')[0], req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE activities
         SET description=?, sub_description=?, due_date=?, priority=?, status=?,
             completed_by=NULL, completed_at=NULL
         WHERE id=?`,
        [description, subDescription, dueDate, priority, status, req.params.id]
      );
    }

    // Si se incluye el array de archivos, sincronizar activity_files
    if (Array.isArray(files)) {
      // Obtener archivos actuales en BD
      const [currentFiles] = await pool.query(
        'SELECT id FROM activity_files WHERE activity_id = ?',
        [req.params.id]
      );
      const currentIds = new Set(currentFiles.map(f => f.id));
      const incomingIds = new Set(files.filter(f => f.id).map(f => f.id));

      // Eliminar archivos que ya no están en la lista
      for (const cf of currentFiles) {
        if (!incomingIds.has(cf.id)) {
          await pool.query('DELETE FROM activity_files WHERE id = ?', [cf.id]);
        }
      }

      // Insertar archivos nuevos (los que no tienen ID en BD o tienen ID temporal)
      for (const file of files) {
        if (file.name && file.url && !currentIds.has(file.id)) {
          const fileId = `af${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await pool.query(
            'INSERT INTO activity_files (id, activity_id, file_name, file_url) VALUES (?, ?, ?, ?)',
            [fileId, req.params.id, file.name, file.url]
          );
        }
      }
    }

    invalidateDocsCache();
    // Si todas las actividades están completadas, marcar documento como Completado
    await syncDocumentStatusByActivity(req.params.id, req.user.name);
    res.json({ ok: true });
  } catch (error) {
    console.error('PUT /api/activities/:id error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📋 POST actualizar estado de actividad (alias de PUT vía POST)
// Algunos proxies/WAF bloquean o manejan mal el método PUT y cierran la
// conexión sin respuesta (ERR_EMPTY_RESPONSE). POST es aceptado de forma
// universal, así que exponemos la misma lógica de actualización vía POST.
app.post("/api/activities/:id/update", requireAuth, async (req, res) => {
  const { description, subDescription, dueDate, priority, status, completedBy, completedAt } = req.body;
  console.log(`📥 POST /api/activities/${req.params.id}/update → status=${status}, completedBy=${completedBy}, completedAt=${completedAt}, dueDate=${dueDate}`);
  try {
    if (status === 'Completed') {
      // completed_by es FK a users.id: usar el id del usuario autenticado, no el nombre.
      await pool.query(
        `UPDATE activities
         SET description=?, sub_description=?, due_date=?, priority=?, status=?,
             completed_by=?, completed_at=?
         WHERE id=?`,
        [description, subDescription, dueDate, priority, status, req.user.user_id, completedAt || new Date().toISOString().split('T')[0], req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE activities
         SET description=?, sub_description=?, due_date=?, priority=?, status=?,
             completed_by=NULL, completed_at=NULL
         WHERE id=?`,
        [description, subDescription, dueDate, priority, status, req.params.id]
      );
    }
    invalidateDocsCache();
    // Si todas las actividades están completadas, marcar documento como Completado
    await syncDocumentStatusByActivity(req.params.id, req.user.name);
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/activities/:id/update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🩹 Workaround de transporte: el proxy (Traefik/Coolify) descarta las
// peticiones que llevan CUERPO (POST/PUT/DELETE) → ERR_EMPTY_RESPONSE, mientras
// que los GET sin cuerpo sí llegan. Exponemos el cambio de estado de actividad
// vía GET con query params (sin cuerpo) para que completar/reabrir funcione.
app.get("/api/activities/:id/set-status", requireAuth, async (req, res) => {
  const status = req.query.status;
  // completed_by es FK a users.id: usar el id del usuario autenticado, no el nombre.
  const completedBy = req.user.user_id;
  const completedAt = req.query.completedAt || new Date().toISOString().split('T')[0];
  console.log(`📥 GET set-status /api/activities/${req.params.id} → status=${status}, completedBy=${completedBy}, completedAt=${completedAt}`);
  try {
    if (status === 'Completed') {
      await pool.query(
        `UPDATE activities SET status=?, completed_by=?, completed_at=? WHERE id=?`,
        [status, completedBy, completedAt, req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE activities SET status=?, completed_by=NULL, completed_at=NULL WHERE id=?`,
        [status, req.params.id]
      );
    }
    invalidateDocsCache();
    // Si todas las actividades están completadas, marcar documento como Completado
    await syncDocumentStatusByActivity(req.params.id, req.user.name);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true });
  } catch (error) {
    console.error('GET /api/activities/:id/set-status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📋 DELETE eliminar actividad
app.delete("/api/activities/:id", requireAuth, async (req, res) => {
  try {
    // Capturar el documento ANTES de borrar la actividad (para resincronizar su estado)
    const [activity] = await pool.query(
      "SELECT document_id FROM activities WHERE id = ?",
      [req.params.id]
    );
    const docId = activity.length > 0 ? activity[0].document_id : null;

    // Eliminar archivos asociados primero
    await pool.query("DELETE FROM activity_files WHERE activity_id = ?", [req.params.id]);
    // Luego eliminar la actividad
    await pool.query("DELETE FROM activities WHERE id = ?", [req.params.id]);

    // Resincronizar el estado del documento (puede volver a 'Inicializado' si era la última)
    if (docId) await syncDocumentStatusFromActivities(docId, req.user.name);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📋 PUT marcar actividad como completada
app.put("/api/activities/:id/complete", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE activities SET status='Completed', completed_by=?, completed_at=NOW() WHERE id=?`,
      [req.user.user_id, req.params.id]
    );
    invalidateDocsCache();
    // Si todas las actividades están completadas, marcar documento como Completado
    await syncDocumentStatusByActivity(req.params.id, req.user.name);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📎 POST subir archivo a actividad
app.post("/api/activities/:id/files", requireAuth, async (req, res) => {
  const { fileName, fileUrl } = req.body;

  if (!fileName || !fileUrl) {
    return res.status(400).json({ error: "fileName y fileUrl son requeridos" });
  }

  try {
    const fileId = `af${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await pool.query(
      `INSERT INTO activity_files (id, activity_id, file_name, file_url)
       VALUES (?, ?, ?, ?)`,
      [fileId, req.params.id, fileName, fileUrl]
    );
    res.status(201).json({ id: fileId, name: fileName, url: fileUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📎 DELETE eliminar archivo de actividad
app.delete("/api/activities/:id/files/:fileId", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM activity_files WHERE id = ? AND activity_id = ?`,
      [req.params.fileId, req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 💬 GET contestaciones de un documento
// ⚡ BATCH endpoint para evitar N+1 queries - cargar contestations de múltiples docs en UNA llamada
app.get("/api/documents/contestations/batch", requireAuth, async (req, res) => {
  try {
    const docIds = (String(req.query.ids || '')).split(',').filter(id => id.trim());
    if (docIds.length === 0) return res.json({});

    await ensureContestationsTable();

    // 1. Fetch all contestations for these documents in ONE query
    const placeholders = docIds.map(() => '?').join(',');
    const [contestations] = await pool.query(`
      SELECT c.id, c.document_id, c.presentation_date, c.authority_received, c.notes,
             c.contact_method, c.registered_by, u.name as registered_by_name
      FROM contestations c
      LEFT JOIN users u ON c.registered_by = u.id
      WHERE c.document_id IN (${placeholders})
      ORDER BY c.document_id, c.presentation_date ASC, c.id ASC
    `, docIds);

    // 2. Get all contestation files in ONE query
    const contestationIds = contestations.map((c) => c.id);
    let files = [];
    if (contestationIds.length > 0) {
      const filePlaceholders = contestationIds.map(() => '?').join(',');
      const [filesResult] = await pool.query(`
        SELECT contestation_id, file_name, file_url FROM contestation_files WHERE contestation_id IN (${filePlaceholders})
      `, contestationIds);
      files = filesResult;
    }

    // 3. Group by document_id in JavaScript
    const result = {};
    for (const contest of contestations) {
      if (!result[contest.document_id]) result[contest.document_id] = [];
      const contestFiles = files.filter((f) => f.contestation_id === contest.id);
      result[contest.document_id].push({
        id: contest.id,
        date: contest.presentation_date?.toISOString?.()?.split('T')[0],
        authority: contest.authority_received,
        notes: contest.notes,
        contact_method: contest.contact_method,
        registered_by: contest.registered_by_name || contest.registered_by,
        registration_date: contest.registration_date?.toISOString?.()?.split('T')[0],
        files: contestFiles.map((f) => ({ name: f.file_name, url: f.file_url }))
      });
    }

    res.json(result);
  } catch (error) {
    console.error("GET /api/documents/contestations/batch error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/contestations", requireAuth, async (req, res) => {
  try {
    await ensureContestationsTable();

    const [rows] = await pool.query(`
      SELECT c.*, u.name as registered_by_name
      FROM contestations c
      LEFT JOIN users u ON c.registered_by = u.id
      WHERE c.document_id = ?
      ORDER BY c.presentation_date ASC, c.id ASC
      LIMIT 100
    `, [req.params.id]);

    // Cargar archivos en paralelo
    const contestations = await Promise.all(
      rows.map(async (c) => {
        const [fileRows] = await pool.query(
          'SELECT id, file_name, file_url FROM contestation_files WHERE contestation_id = ? LIMIT 50',
          [c.id]
        );
        return {
          id: c.id,
          date: c.presentation_date?.toISOString?.().split('T')[0],
          authority: c.authority_received,
          notes: c.notes,
          contact_method: c.contact_method,
          registered_by: c.registered_by_name || c.registered_by,
          registration_date: c.registration_date?.toISOString?.().split('T')[0],
          files: (fileRows || []).map(f => ({ name: f.file_name, url: f.file_url }))
        };
      })
    );

    res.json(contestations);
  } catch (error) {
    console.error("GET /api/documents/:id/contestations error:",
      { code: error.code, sqlMessage: error.sqlMessage, message: error.message });
    res.status(500).json({ error: error.sqlMessage || error.message });
  }
});

// 💬 POST crear contestación
app.post("/api/documents/:id/contestations", requireAuth, async (req, res) => {
  const { date, authority, notes, contact_method, files } = req.body;
  const documentId = req.params.id;

  if (!date || !authority) {
    return res.status(400).json({ error: "Campos requeridos: date, authority" });
  }

  // Asegurar que la tabla y sus columnas existan (auto-curador)
  await ensureContestationsTable();

  const contestationId = `c${Date.now()}`;

  // PASO CRÍTICO: INSERT a contestations. Si esto falla, devolvemos 500.
  try {
    await pool.query(
      `INSERT INTO contestations
       (id, document_id, presentation_date, authority_received, notes, contact_method, registered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [contestationId, documentId, date, authority, notes || '', contact_method || '', req.user.user_id]
    );
  } catch (error) {
    console.error("POST /api/documents/:id/contestations INSERT error:",
      { code: error.code, errno: error.errno, sqlMessage: error.sqlMessage, message: error.message });
    return res.status(500).json({ error: error.sqlMessage || error.message || 'Error al guardar contestación' });
  }

  // Guardar archivos adjuntos — tabla garantizada por ensureContestationsTable()
  const savedFiles = [];
  if (files && Array.isArray(files) && files.length > 0) {
    console.log(`📎 POST contestación ${contestationId}: recibidos ${files.length} archivos`);
    for (const file of files) {
      if (file.name && file.url) {
        const urlSize = file.url.length;
        console.log(`  → Archivo: ${file.name} (${(urlSize / 1024).toFixed(1)} KB base64)`);
        const fileId = `cf${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        try {
          await pool.query(
            `INSERT INTO contestation_files (id, contestation_id, file_name, file_url)
             VALUES (?, ?, ?, ?)`,
            [fileId, contestationId, file.name, file.url]
          );
          savedFiles.push({ name: file.name, url: file.url });
          console.log(`  ✅ Archivo guardado: ${file.name}`);
        } catch (fileErr) {
          console.error(`  ❌ Error guardando archivo ${file.name}:`,
            { code: fileErr.code, sqlMessage: fileErr.sqlMessage, msg: fileErr.message });
        }
      }
    }
  }

  // Notificaciones de email — best-effort, nunca fallan la request
  try {
    const [docRows] = await pool.query('SELECT title, trarnite_number FROM documents WHERE id = ?', [documentId]);
    if (docRows.length > 0) {
      const doc = docRows[0];
      const recipients = await getDocumentRecipients(documentId);
      const formattedDate = new Date(date).toLocaleDateString('es-ES');
      const emailTemplate = getContestationAddedEmailContent(doc.title, doc.trarnite_number, notes || 'N/A', contact_method || 'N/A', formattedDate, req.user.name);
      await sendNotificationEmail(recipients, emailTemplate.subject, emailTemplate.html, documentId, 'contestation_added');
    }
  } catch (notifyErr) {
    console.error("Error enviando notificación de contestación (no crítico):", notifyErr.message);
  }

  res.status(201).json({
    id: contestationId,
    date,
    authority,
    notes,
    contact_method,
    registered_by: req.user.name,
    registration_date: new Date().toISOString().split('T')[0],
    files: savedFiles
  });
});

// 💬 PUT actualizar contestación
app.put("/api/contestations/:id", requireAuth, async (req, res) => {
  const { date, authority, notes, contact_method, files } = req.body;
  const contestationId = req.params.id;

  try {
    await ensureContestationsTable();

    // Actualizar campos de contestación
    await pool.query(
      `UPDATE contestations
       SET presentation_date=?, authority_received=?, notes=?, contact_method=?
       WHERE id=?`,
      [date, authority, notes, contact_method, contestationId]
    );

    // Guardar archivos si se proporcionan — tabla garantizada por ensureContestationsTable()
    let savedFiles = [];
    if (files && Array.isArray(files) && files.length > 0) {
      console.log(`📎 PUT contestación ${contestationId}: recibidos ${files.length} archivos`);
      // Eliminar archivos viejos
      try {
        await pool.query('DELETE FROM contestation_files WHERE contestation_id = ?', [contestationId]);
      } catch (delErr) {
        console.error("Error eliminando archivos viejos:", delErr.message);
      }

      // Insertar nuevos archivos
      for (const file of files) {
        if (file.name && file.url) {
          const urlSize = file.url.length;
          console.log(`  → Archivo: ${file.name} (${(urlSize / 1024).toFixed(1)} KB base64)`);
          const fileId = `cf${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          try {
            await pool.query(
              `INSERT INTO contestation_files (id, contestation_id, file_name, file_url)
               VALUES (?, ?, ?, ?)`,
              [fileId, contestationId, file.name, file.url]
            );
            savedFiles.push({ name: file.name, url: file.url });
            console.log(`  ✅ Archivo guardado: ${file.name}`);
          } catch (fileErr) {
            console.error(`  ❌ Error guardando archivo ${file.name} en PUT:`,
              { code: fileErr.code, sqlMessage: fileErr.sqlMessage, msg: fileErr.message });
          }
        }
      }
    }

    res.json({ ok: true, files: savedFiles });
  } catch (error) {
    console.error("PUT /api/contestations/:id error:",
      { code: error.code, sqlMessage: error.sqlMessage, message: error.message });
    res.status(500).json({ error: error.sqlMessage || error.message });
  }
});

// 💬 DELETE eliminar contestación
app.delete("/api/contestations/:id", requireAuth, async (req, res) => {
  try {
    await ensureContestationsTable();
    await pool.query("DELETE FROM contestations WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/contestations/:id error:",
      { code: error.code, sqlMessage: error.sqlMessage, message: error.message });
    res.status(500).json({ error: error.sqlMessage || error.message });
  }
});

// 🗓️ HOLIDAYS ENDPOINTS (Feriados para cálculo de fechas de vencimiento)

// 🗓️ GET listar todos los feriados
app.get("/api/holidays", requireAuth, async (req, res) => {
  try {
    const { year } = req.query;
    const targetYear = year ? parseInt(year) : null;

    let rows;
    try {
      // Asegurar que la tabla exista (auto-curador: si fue eliminada, se recrea)
      await ensureHolidaysTable();
      // Try database first
      let query = `
        SELECT h.*,
               u_created.name as created_by_name,
               u_updated.name as updated_by_name
        FROM holidays h
        LEFT JOIN users u_created ON h.created_by = u_created.id
        LEFT JOIN users u_updated ON h.updated_by = u_updated.id
        ORDER BY h.holiday_date ASC
      `;
      const params = [];
      if (targetYear) {
        query = `
          SELECT h.*,
                 u_created.name as created_by_name,
                 u_updated.name as updated_by_name
          FROM holidays h
          LEFT JOIN users u_created ON h.created_by = u_created.id
          LEFT JOIN users u_updated ON h.updated_by = u_updated.id
          WHERE YEAR(h.holiday_date) = ?
          ORDER BY h.holiday_date ASC
        `;
        params.push(targetYear);
      }
      [rows] = await pool.query(query, params);
    } catch (dbError) {
      // Fallback to memory if DB fails
      console.log('ℹ️ Using in-memory holidays (DB unavailable):', dbError.message);
      rows = memoryHolidays;
      if (targetYear) {
        rows = rows.filter(h => h.holiday_date.getFullYear() === targetYear);
      }
    }

    const toDateStr = (val) => {
      if (!val) return null;
      if (val instanceof Date) return val.toISOString().split('T')[0];
      return String(val).split('T')[0];
    };
    res.json(rows.map(h => {
      const calendarDate = toDateStr(h.holiday_date);
      const officialDate = toDateStr(h.official_date) || calendarDate;
      return {
        id: h.id,
        officialDate,
        calendarDate,
        date: calendarDate, // backward compat
        name: h.name,
        type: h.holiday_type,
        createdBy: h.created_by_name || h.created_by,
        createdAt: toDateStr(h.created_at),
        updatedBy: h.updated_by_name || h.updated_by,
        updatedAt: toDateStr(h.updated_at)
      };
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🗓️ POST crear nuevo feriado
app.post("/api/holidays", requireAuth, async (req, res) => {
  // Acepta formato nuevo (officialDate/calendarDate) y legacy (date)
  const { officialDate, calendarDate, name, type = 'Ordinary' } = req.body;
  const official = officialDate || req.body.date;
  const calendar = calendarDate || (official ? calculateCalendarDate(official) : null);

  if (!official || !name) {
    return res.status(400).json({ error: "officialDate y name son requeridos" });
  }

  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: "Solo Admins pueden crear feriados" });
  }

  try {
    // Asegurar que la tabla exista antes de insertar
    await ensureHolidaysTable();
    const [result] = await pool.query(
      `INSERT INTO holidays (official_date, holiday_date, name, holiday_type, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [official, calendar, name, type, req.user.user_id]
    );

    res.status(201).json({
      id: result.insertId,
      officialDate: official,
      calendarDate: calendar,
      date: calendar,
      name,
      type,
      createdBy: req.user.user_id,
      createdAt: new Date().toISOString().split('T')[0]
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: "Ya existe un feriado en esa fecha calendario" });
    }
    // Fallback a memoria si BD no disponible
    if (error.code === 'ECONNREFUSED' || error.code === 'PROTOCOL_CONNECTION_LOST') {
      console.log('⚠️ DB unavailable, storing holiday in memory for testing');
      const newId = Math.max(...memoryHolidays.map(h => h.id), 0) + 1;
      const newHoliday = {
        id: newId,
        official_date: new Date(official),
        holiday_date: new Date(calendar),
        name,
        holiday_type: type,
        created_by: req.user.user_id,
        created_at: new Date(),
        updated_by: null,
        updated_at: null
      };
      memoryHolidays.push(newHoliday);
      saveFallbackFile();
      return res.status(201).json({
        id: newId,
        officialDate: official,
        calendarDate: calendar,
        date: calendar,
        name,
        type,
        createdBy: req.user.user_id,
        createdAt: new Date().toISOString().split('T')[0]
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// 🗓️ PUT actualizar feriado
app.put("/api/holidays/:id", requireAuth, async (req, res) => {
  const { officialDate, calendarDate, name, type } = req.body;
  const official = officialDate || req.body.date;
  const calendar = calendarDate || (official ? calculateCalendarDate(official) : req.body.date);

  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: "Solo Admins pueden editar feriados" });
  }

  try {
    // Asegurar que la tabla exista antes de actualizar
    await ensureHolidaysTable();
    await pool.query(
      `UPDATE holidays SET official_date=?, holiday_date=?, name=?, holiday_type=?, updated_by=? WHERE id=?`,
      [official, calendar, name, type, req.user.user_id, req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: "Ya existe un feriado en esa fecha calendario" });
    }
    // Fallback a memoria si BD no disponible
    if (error.code === 'ECONNREFUSED' || error.code === 'PROTOCOL_CONNECTION_LOST') {
      console.log('⚠️ DB unavailable, updating holiday in memory for testing');
      const idx = memoryHolidays.findIndex(h => h.id === parseInt(req.params.id));
      if (idx >= 0) {
        memoryHolidays[idx] = {
          ...memoryHolidays[idx],
          official_date: new Date(official),
          holiday_date: new Date(calendar),
          name,
          holiday_type: type,
          updated_by: req.user.user_id,
          updated_at: new Date()
        };
        saveFallbackFile();
        return res.json({ ok: true });
      }
      return res.status(404).json({ error: "Feriado no encontrado" });
    }
    res.status(500).json({ error: error.message });
  }
});

// 🗓️ DELETE eliminar feriado
app.delete("/api/holidays/:id", requireAuth, async (req, res) => {
  // Solo Admin puede eliminar feriados
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: "Solo Admins pueden eliminar feriados" });
  }

  try {
    // Asegurar que la tabla exista antes de eliminar
    await ensureHolidaysTable();
    await pool.query("DELETE FROM holidays WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    // Fallback a memoria si BD no disponible
    if (error.code === 'ECONNREFUSED' || error.code === 'PROTOCOL_CONNECTION_LOST') {
      console.log('⚠️ DB unavailable, deleting holiday in memory for testing');
      const idx = memoryHolidays.findIndex(h => h.id === parseInt(req.params.id));
      if (idx >= 0) {
        memoryHolidays.splice(idx, 1);
        saveFallbackFile();
        return res.json({ ok: true });
      }
      return res.status(404).json({ error: "Feriado no encontrado" });
    }
    res.status(500).json({ error: error.message });
  }
});

// 🗓️ POST /update — workaround para proxy que bloquea PUT
app.post("/api/holidays/:id/update", requireAuth, async (req, res) => {
  const { officialDate, calendarDate, name, type } = req.body;
  const official = officialDate || req.body.date;
  const calendar = calendarDate || (official ? calculateCalendarDate(official) : req.body.date);

  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: "Solo Admins pueden editar feriados" });
  }

  try {
    await ensureHolidaysTable();
    await pool.query(
      `UPDATE holidays SET official_date=?, holiday_date=?, name=?, holiday_type=?, updated_by=? WHERE id=?`,
      [official, calendar, name, type, req.user.user_id, req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: "Ya existe un feriado en esa fecha calendario" });
    }
    res.status(500).json({ error: error.message });
  }
});

// 🗓️ POST /delete — workaround para proxy que bloquea DELETE
app.post("/api/holidays/:id/delete", requireAuth, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: "Solo Admins pueden eliminar feriados" });
  }

  try {
    await ensureHolidaysTable();
    await pool.query("DELETE FROM holidays WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🤖 Endpoint de análisis con IA (Gemini)
app.post("/api/analyze", requireAuth, async (req, res) => {
  const { fileData, filePath, mimeType } = req.body;

  let base64Data;
  let effectiveMime = mimeType;
  if (filePath) {
    // Cargar el archivo desde el almacén (BD, fallback disco) — evita enviar
    // cuerpos base64 enormes a través del proxy.
    const stored = await loadStoredFile(filePath);
    if (!stored) {
      return res.status(404).json({ error: 'Archivo no encontrado para análisis' });
    }
    base64Data = stored.buffer.toString('base64');
    if (!effectiveMime) effectiveMime = stored.mimeType;
  } else if (fileData) {
    base64Data = fileData;
  } else {
    return res.status(400).json({ error: "fileData o filePath requerido" });
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: effectiveMime || "application/pdf",
                  data: base64Data
                }
              },
              {
                text: `Analiza este documento y responde SOLO con JSON válido sin markdown. EXTRAE: trarniteNumber=número interno de trámite/expediente (ej: "Trámite No."); documentNumber=número oficial del documento emitido (ej: "Resolución No.", "Oficio No.", "Notificación No.", "Auto No.", "Providencia No.") — búscalo en encabezado, pie y cuerpo. Si solo hay un número ponlo en trarniteNumber y deja documentNumber vacío. company=empresa del documento (busca siglas o nombre completo, ej: "ECSA", "EXSA", "HCSA", "PCSA", "MMSA" u otros):\n{"authority":"","department":"","company":"","notificationDate":"YYYY-MM-DD","emissionDate":"YYYY-MM-DD","daysLimit":10,"dayType":"Días hábiles","trarniteNumber":"","documentNumber":"","title":"","summaryEs":"resumen breve en español","summaryCn":"简短摘要","activities":[""]}`
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errData = await geminiRes.json();
      throw new Error(errData.error?.message || "Error en Gemini API");
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    const clean = text
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .trim();

    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No se encontró JSON válido en la respuesta");

    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);

  } catch (error) {
    console.error("Analyze error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📧 Notificación nuevo documento
app.post("/api/notify/new-document", requireAuth, async (req, res) => {
  try {
    const [users] = await pool.query(
      "SELECT email FROM users WHERE role IN ('Admin', 'Operator') AND email != 'impuestos@corriente.com.ec'"
    );
    console.log(`Notificación enviada a ${users.length} usuarios`);
    res.json({ ok: true, recipients: users.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📬 Obtener configuración SMTP de la base de datos
const getSmtpConfig = async () => {
  try {
    const [rows] = await pool.query("SELECT * FROM smtp_config WHERE id = 1");
    if (rows.length > 0) {
      return rows[0];
    }
    // Si no existe, crear un registro vacío (será completado por el admin)
    try {
      await pool.query(
        `INSERT INTO smtp_config (id, host, port, user, password, from_email, from_name, use_ssl)
         VALUES (1, '', 465, '', '', '', 'Tax Control ECSA', 0)`
      );
      console.log("Created empty SMTP config record. Admin must configure it.");
    } catch (insertError) {
      console.error("Could not create SMTP config record:", insertError);
    }
    return {
      host: "",
      port: 465,
      user: "",
      password: "",
      from_email: "",
      from_name: "Tax Control ECSA",
      use_ssl: false
    };
  } catch (error) {
    console.error("Error getting SMTP config:", error);
    return {
      host: "",
      port: 465,
      user: "",
      password: "",
      from_email: "",
      from_name: "Tax Control ECSA",
      use_ssl: false
    };
  }
};

// 📬 Crear transporter de email desde configuración SMTP
const getEmailTransporter = async () => {
  try {
    const config = await getSmtpConfig();

    if (!config.password || !config.host || !config.user || !config.from_email) {
      const missing = [];
      if (!config.host) missing.push("SMTP Host");
      if (!config.user) missing.push("SMTP User");
      if (!config.password) missing.push("SMTP Password");
      if (!config.from_email) missing.push("From Email");
      throw new Error(`SMTP not fully configured. Missing: ${missing.join(", ")}. Please configure it in the Admin panel (Settings > SMTP Configuration).`);
    }

    const port = config.port || 465;
    const isSecure = config.use_ssl === true || config.use_ssl === 1;

    return nodemailer.createTransport({
      host: config.host,
      port: port,
      secure: false,       // NO SSL implícito — el servidor OWA usa STARTTLS
      requireTLS: true,    // Exigir STARTTLS después de conectar
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: {
        user: config.user,
        pass: config.password
      },
      tls: {
        rejectUnauthorized: false,
        minVersion: "TLSv1"
      }
    });
  } catch (error) {
    console.error("Error creating email transporter:", error);
    throw error;
  }
};

// 📧 Obtener destinatarios de notificación para un documento
const getDocumentRecipients = async (documentId) => {
  try {
    const [recipients] = await pool.query(`
      SELECT DISTINCT u.id, u.name, u.email
      FROM users u
      WHERE u.id IN (
        SELECT created_by FROM documents WHERE id = ?
        UNION
        SELECT last_edited_by FROM documents WHERE id = ? AND last_edited_by IS NOT NULL
      )
      AND u.email IS NOT NULL AND u.email != ''
      AND u.email != 'impuestos@corriente.com.ec'
    `, [documentId, documentId]);

    return recipients;
  } catch (error) {
    console.error("Error getting document recipients:", error);
    return [];
  }
};

// 📧 Función centralizada para enviar notificaciones por email
const sendNotificationEmail = async (users, subject, htmlContent, documentId, notificationType) => {
  if (!users || users.length === 0) return;

  try {
    const transporter = await getEmailTransporter();
    const config = await getSmtpConfig();

    for (const user of users) {
      try {
        await transporter.sendMail({
          from: `"${config.from_name}" <${config.from_email}>`,
          to: user.email,
          subject: subject,
          html: htmlContent
        });

        // Log to notifications table
        await pool.query(
          'INSERT INTO notifications (user_id, document_id, notification_type, subject, content, email_sent, sent_at) VALUES (?, ?, ?, ?, ?, true, NOW())',
          [user.id, documentId, notificationType, subject, htmlContent]
        );

        console.log(`Notification email sent to ${user.email} for document ${documentId}`);
      } catch (error) {
        console.error(`Error sending email to ${user.email}:`, error.message);
        // Log failed notification attempt
        await pool.query(
          'INSERT INTO notifications (user_id, document_id, notification_type, subject, content, email_sent) VALUES (?, ?, ?, ?, ?, false)',
          [user.id, documentId, notificationType, subject, htmlContent]
        );
      }
    }
  } catch (error) {
    console.error("Error in sendNotificationEmail:", error);
  }
};

// 📧 Generar HTML para notificación de resumen diario (Bilingüe)
const generateDailyReminderHTML = (overdueDocs, upcomingDocs) => {
  let html = `
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">

        <!-- SPANISH SECTION -->
        <div style="margin-bottom: 40px; padding-bottom: 30px; border-bottom: 2px solid #e0e0e0;">
          <h2 style="color: #204070;">📋 Resumen Diario de Documentos</h2>
          <p>A continuación se muestra un resumen de los documentos que requieren atención:</p>
  `;

  if (overdueDocs && overdueDocs.length > 0) {
    html += `<h3 style="color: #d9534f;">Documentos Vencidos (${overdueDocs.length})</h3>`;
    html += '<table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">';
    html += '<tr style="background-color: #ffcccc; border: 1px solid #ddd;"><th style="padding: 10px; text-align: left;">Título</th><th style="padding: 10px; text-align: left;">Trámite</th><th style="padding: 10px; text-align: left;">Vencimiento</th><th style="padding: 10px; text-align: left;">Días</th></tr>';

    for (const doc of overdueDocs) {
      const daysOverdue = Math.floor((Date.now() - new Date(doc.due_date)) / (1000 * 60 * 60 * 24));
      html += `<tr style="border: 1px solid #ddd;"><td style="padding: 10px;">${doc.title}</td><td style="padding: 10px;">${doc.trarnite_number}</td><td style="padding: 10px;">${new Date(doc.due_date).toLocaleDateString('es-ES')}</td><td style="padding: 10px; color: #d9534f;"><strong>${daysOverdue}</strong></td></tr>`;
    }
    html += '</table>';
  }

  if (upcomingDocs && upcomingDocs.length > 0) {
    html += `<h3 style="color: #f0ad4e;">Próximos a Vencer (próximos 7 días) (${upcomingDocs.length})</h3>`;
    html += '<table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">';
    html += '<tr style="background-color: #ffffcc; border: 1px solid #ddd;"><th style="padding: 10px; text-align: left;">Título</th><th style="padding: 10px; text-align: left;">Trámite</th><th style="padding: 10px; text-align: left;">Vencimiento</th><th style="padding: 10px; text-align: left;">Días</th></tr>';

    for (const doc of upcomingDocs) {
      const daysUntilDue = Math.floor((new Date(doc.due_date) - Date.now()) / (1000 * 60 * 60 * 24));
      html += `<tr style="border: 1px solid #ddd;"><td style="padding: 10px;">${doc.title}</td><td style="padding: 10px;">${doc.trarnite_number}</td><td style="padding: 10px;">${new Date(doc.due_date).toLocaleDateString('es-ES')}</td><td style="padding: 10px; color: #f0ad4e;"><strong>${daysUntilDue}</strong></td></tr>`;
    }
    html += '</table>';
  }

  html += `
          <p style="color: #666; margin-top: 20px; font-size: 14px;">Por favor, revise estos documentos y tome las acciones necesarias.</p>
        </div>

        <!-- CHINESE SECTION -->
        <div>
          <h2 style="color: #204070;">📋 每日文档摘要</h2>
          <p>以下是需要您注意的文档摘要：</p>
  `;

  if (overdueDocs && overdueDocs.length > 0) {
    html += `<h3 style="color: #d9534f;">逾期文档 (${overdueDocs.length})</h3>`;
    html += '<table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">';
    html += '<tr style="background-color: #ffcccc; border: 1px solid #ddd;"><th style="padding: 10px; text-align: left;">标题</th><th style="padding: 10px; text-align: left;">程序</th><th style="padding: 10px; text-align: left;">到期日期</th><th style="padding: 10px; text-align: left;">天数</th></tr>';

    for (const doc of overdueDocs) {
      const daysOverdue = Math.floor((Date.now() - new Date(doc.due_date)) / (1000 * 60 * 60 * 24));
      html += `<tr style="border: 1px solid #ddd;"><td style="padding: 10px;">${doc.title}</td><td style="padding: 10px;">${doc.trarnite_number}</td><td style="padding: 10px;">${new Date(doc.due_date).toLocaleDateString('zh-CN')}</td><td style="padding: 10px; color: #d9534f;"><strong>${daysOverdue}</strong></td></tr>`;
    }
    html += '</table>';
  }

  if (upcomingDocs && upcomingDocs.length > 0) {
    html += `<h3 style="color: #f0ad4e;">即将到期 (接下来 7 天) (${upcomingDocs.length})</h3>`;
    html += '<table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">';
    html += '<tr style="background-color: #ffffcc; border: 1px solid #ddd;"><th style="padding: 10px; text-align: left;">标题</th><th style="padding: 10px; text-align: left;">程序</th><th style="padding: 10px; text-align: left;">到期日期</th><th style="padding: 10px; text-align: left;">天数</th></tr>';

    for (const doc of upcomingDocs) {
      const daysUntilDue = Math.floor((new Date(doc.due_date) - Date.now()) / (1000 * 60 * 60 * 24));
      html += `<tr style="border: 1px solid #ddd;"><td style="padding: 10px;">${doc.title}</td><td style="padding: 10px;">${doc.trarnite_number}</td><td style="padding: 10px;">${new Date(doc.due_date).toLocaleDateString('zh-CN')}</td><td style="padding: 10px; color: #f0ad4e;"><strong>${daysUntilDue}</strong></td></tr>`;
    }
    html += '</table>';
  }

  html += `
          <p style="color: #666; margin-top: 20px; font-size: 14px;">请审查这些文件并采取必要的行动。</p>
        </div>

        <p style="color: #999; margin-top: 20px; font-size: 12px; border-top: 1px solid #e0e0e0; padding-top: 15px;">
          Tax Control System | 税务控制系统
        </p>
      </div>
    </body>
    </html>
  `;

  return html;
};

// ✉️ Prueba Básica SMTP
app.post("/api/test-email/basic", requireAuth, async (req, res) => {
  try {
    const transporter = await getEmailTransporter();
    const config = await getSmtpConfig();
    const testEmail = req.body.testEmail || "test@example.com";

    const info = await transporter.sendMail({
      from: `"${config.from_name}" <${config.from_email}>`,
      to: testEmail,
      subject: "✅ Prueba Básica SMTP - Tax Control",
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">
            <h2 style="color: #204070;">✅ Prueba Básica SMTP</h2>
            <p>Este es un email de prueba para verificar que la configuración SMTP está funcionando correctamente.</p>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
            <p style="color: #666; margin-top: 20px;">Sistema Tax Control</p>
          </div>
        </div>
      `
    });

    console.log("Basic email test sent:", info.messageId);
    res.json({ ok: true, messageId: info.messageId, message: "Prueba básica enviada correctamente" });
  } catch (error) {
    console.error("Basic email test error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 🔑 Prueba Reset Password
app.post("/api/test-email/reset", requireAuth, async (req, res) => {
  try {
    const transporter = await getEmailTransporter();
    const config = await getSmtpConfig();
    const testEmail = req.body.testEmail || "test@example.com";

    const info = await transporter.sendMail({
      from: `"${config.from_name}" <${config.from_email}>`,
      to: testEmail,
      subject: "🔑 Restablecer Contraseña - Tax Control",
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">
            <h2 style="color: #204070;">🔑 Restablecer Contraseña</h2>
            <p>Ha solicitado restablecer su contraseña en Tax Control.</p>
            <p style="margin: 30px 0;">
              <a href="http://192.168.60.109/taxcontrol/#/reset-password?token=DEMO_TOKEN_12345"
                 style="background-color: #204070; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Restablecer Contraseña
              </a>
            </p>
            <p style="color: #666; font-size: 12px;">Este enlace es válido por 24 horas.</p>
            <p style="color: #666; margin-top: 20px;">Sistema Tax Control</p>
          </div>
        </div>
      `
    });

    console.log("Reset password email test sent:", info.messageId);
    res.json({ ok: true, messageId: info.messageId, message: "Email de reset enviado correctamente" });
  } catch (error) {
    console.error("Reset password email test error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 👥 Prueba Invitación
app.post("/api/test-email/invitation", requireAuth, async (req, res) => {
  try {
    const transporter = await getEmailTransporter();
    const config = await getSmtpConfig();
    const testEmail = req.body.testEmail || "test@example.com";

    const info = await transporter.sendMail({
      from: `"${config.from_name}" <${config.from_email}>`,
      to: testEmail,
      subject: "👥 Invitación a Tax Control",
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">
            <h2 style="color: #204070;">👥 Ha sido invitado a Tax Control</h2>
            <p>Ha sido invitado a unirse a Tax Control, una plataforma de gestión tributaria.</p>
            <p><strong>Credenciales temporales:</strong></p>
            <ul>
              <li>Usuario: ${testEmail}</li>
              <li>Contraseña Temporal: TempPassword123!</li>
            </ul>
            <p style="margin: 30px 0;">
              <a href="http://192.168.60.109/taxcontrol/#/login"
                 style="background-color: #204070; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Ingresar a Tax Control
              </a>
            </p>
            <p style="color: #666; font-size: 12px;">Se recomienda cambiar su contraseña al primer inicio de sesión.</p>
            <p style="color: #666; margin-top: 20px;">Sistema Tax Control</p>
          </div>
        </div>
      `
    });

    console.log("Invitation email test sent:", info.messageId);
    res.json({ ok: true, messageId: info.messageId, message: "Email de invitación enviado correctamente" });
  } catch (error) {
    console.error("Invitation email test error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 🔔 Prueba Alerta
app.post("/api/test-email/alert", requireAuth, async (req, res) => {
  try {
    const transporter = await getEmailTransporter();
    const config = await getSmtpConfig();
    const testEmail = req.body.testEmail || "test@example.com";

    const info = await transporter.sendMail({
      from: `"${config.from_name}" <${config.from_email}>`,
      to: testEmail,
      subject: "🔔 Alerta - Plazo Próximo a Vencer",
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">
            <h2 style="color: #d97706;">🔔 Alerta - Plazo Próximo a Vencer</h2>
            <p style="color: #666;">Se le notifica que el siguiente documento tiene un plazo que vence próximamente:</p>
            <div style="background-color: #fef3c7; border-left: 4px solid #d97706; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p><strong>Documento:</strong> ADMISIÓN A TRÁMITE Y TÉRMINO DE PRUEBA</p>
              <p><strong>Empresa:</strong> Ecuacorriente S.A.</p>
              <p><strong>Plazo Vence:</strong> 2026-05-26</p>
              <p><strong>Días Restantes:</strong> 5 días hábiles</p>
            </div>
            <p style="color: #666; margin-top: 20px;">Ingrese a Tax Control para más detalles.</p>
            <p style="color: #666;">Sistema Tax Control</p>
          </div>
        </div>
      `
    });

    console.log("Alert email test sent:", info.messageId);
    res.json({ ok: true, messageId: info.messageId, message: "Email de alerta enviado correctamente" });
  } catch (error) {
    console.error("Alert email test error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ⚙️ Obtener configuración SMTP
app.get("/api/smtp-config", requireAuth, async (req, res) => {
  try {
    const config = await getSmtpConfig();
    // No enviar la contraseña al frontend
    res.json({
      host: config.host,
      port: config.port,
      user: config.user,
      from_email: config.from_email,
      from_name: config.from_name,
      use_ssl: config.use_ssl,
      password_set: !!config.password
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ⚙️ Guardar configuración SMTP
app.post("/api/smtp-config", requireAuth, async (req, res) => {
  try {
    const { host, port, user, password, from_email, from_name, use_ssl } = req.body;

    if (!host || !port || !user || !from_email) {
      return res.status(400).json({ error: "Faltan campos requeridos: host, port, user, from_email" });
    }

    // Si se omite la contraseña, conservar la que ya existe en BD
    const [existing] = await pool.query('SELECT password FROM smtp_config WHERE id = 1');
    const existingPassword = existing.length > 0 ? existing[0].password : null;
    const finalPassword = password || existingPassword;

    if (!finalPassword) {
      return res.status(400).json({ error: "La contraseña SMTP es requerida (primera configuración)" });
    }

    const query = `
      INSERT INTO smtp_config (id, host, port, user, password, from_email, from_name, use_ssl)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        host=VALUES(host), port=VALUES(port), user=VALUES(user),
        password=VALUES(password), from_email=VALUES(from_email),
        from_name=VALUES(from_name), use_ssl=VALUES(use_ssl), updated_at=NOW()
    `;
    await pool.query(query, [host, port, user, finalPassword, from_email, from_name, use_ssl ? 1 : 0]);
    res.json({ ok: true, message: "SMTP configuration saved successfully" });
  } catch (error) {
    console.error("SMTP config save error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 🔍 Listar modelos Gemini disponibles
// 📧 Notificación de nuevo documento
const getNewDocumentEmailContent = (doc) => ({
  subject: `Nuevo Trámite | 新案件 - ${doc.trarnite_number}`,
  html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:20px;">
      <div style="margin-bottom:30px;padding-bottom:20px;border-bottom:2px solid #e0e0e0;">
        <h2 style="color:#204070;">📄 Nuevo Trámite Registrado</h2>
        <div style="background:#f9f9f9;border-left:4px solid #204070;padding:15px;margin:15px 0;border-radius:4px;">
          <p style="margin:5px 0;"><strong>📋 Título:</strong> ${doc.title}</p>
          <p style="margin:5px 0;"><strong>🔢 Trámite #:</strong> ${doc.trarnite_number}</p>
          <p style="margin:5px 0;"><strong>🏢 Autoridad:</strong> ${doc.authority}</p>
          <p style="margin:5px 0;"><strong>📅 Fecha Notificación:</strong> ${doc.notification_date}</p>
          <p style="margin:5px 0;"><strong>⏰ Vencimiento:</strong> ${doc.due_date}</p>
          <p style="margin:5px 0;"><strong>📊 Estado:</strong> ${doc.status}</p>
        </div>
        <a href="http://192.168.60.109/taxcontrol/#/documents/${doc.id}"
           style="background:#204070;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;margin-top:10px;">
          Ver Documento
        </a>
      </div>
      <div>
        <h2 style="color:#204070;">📄 新案件已登记</h2>
        <div style="background:#f9f9f9;border-left:4px solid #204070;padding:15px;margin:15px 0;border-radius:4px;">
          <p style="margin:5px 0;"><strong>📋 标题：</strong> ${doc.title}</p>
          <p style="margin:5px 0;"><strong>🔢 案件编号：</strong> ${doc.trarnite_number}</p>
          <p style="margin:5px 0;"><strong>🏢 机构：</strong> ${doc.authority}</p>
          <p style="margin:5px 0;"><strong>📅 通知日期：</strong> ${doc.notification_date}</p>
          <p style="margin:5px 0;"><strong>⏰ 到期日期：</strong> ${doc.due_date}</p>
        </div>
        <a href="http://192.168.60.109/taxcontrol/#/documents/${doc.id}"
           style="background:#204070;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;margin-top:10px;">
          查看文件
        </a>
      </div>
    </div>`
});

// 🧪 Prueba de configuración SMTP
app.post("/api/smtp-config/test", requireAuth, async (req, res) => {
  try {
    const config = await getSmtpConfig();

    // Validar que la configuración esté completa
    if (!config.host || !config.user || !config.password || !config.from_email) {
      const missing = [];
      if (!config.host) missing.push("SMTP Host");
      if (!config.user) missing.push("SMTP User");
      if (!config.password) missing.push("SMTP Password");
      if (!config.from_email) missing.push("From Email");
      return res.status(400).json({
        success: false,
        error: `Configuración SMTP incompleta. Falta: ${missing.join(", ")}`
      });
    }

    // Intentar crear transporter y enviar correo de prueba
    const transporter = await getEmailTransporter();
    const testEmail = req.user.email || req.body.test_email;

    if (!testEmail) {
      return res.status(400).json({
        success: false,
        error: "No email provided for test"
      });
    }

    const testResult = await transporter.sendMail({
      from: `"${config.from_name}" <${config.from_email}>`,
      to: testEmail,
      subject: "🧪 Tax Control SMTP Test Email",
      html: `
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 20px;">
            <h2 style="color: #204070;">✅ Tax Control SMTP Configuration Test</h2>
            <p>This is a test email to verify your SMTP configuration is working correctly.</p>
            <div style="background-color: #f9f9f9; border-left: 4px solid #204070; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p><strong>✓ SMTP Host:</strong> ${config.host}</p>
              <p><strong>✓ Port:</strong> ${config.port}</p>
              <p><strong>✓ User:</strong> ${config.user}</p>
              <p><strong>✓ From Email:</strong> ${config.from_email}</p>
              <p><strong>✓ SSL/TLS:</strong> ${config.use_ssl ? 'Enabled' : 'Disabled'}</p>
            </div>
            <p style="color: #666;">If you received this email, your SMTP configuration is working correctly!</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">Tax Control System</p>
          </div>
        </body>
        </html>
      `
    });

    res.json({
      success: true,
      message: "Test email sent successfully",
      messageId: testResult.messageId
    });
  } catch (error) {
    console.error("SMTP test error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/notifications/new-document", requireAuth, async (req, res) => {
  const { docId } = req.body;
  if (!docId) return res.status(400).json({ error: "docId requerido" });
  try {
    const [docs] = await pool.query("SELECT * FROM documents WHERE id = ?", [docId]);
    if (docs.length === 0) return res.status(404).json({ error: "Documento no encontrado" });
    const doc = docs[0];
    const [users] = await pool.query(
      'SELECT id, name, email FROM users WHERE email IS NOT NULL AND email != "" AND email != "impuestos@corriente.com.ec" AND (role = "Admin" OR role = "Operator")'
    );
    const transporter = await getEmailTransporter();
    const config = await getSmtpConfig();
    const emailContent = getNewDocumentEmailContent(doc);
    let sent = 0;
    for (const user of users) {
      try {
        await transporter.sendMail({
          from: `"${config.from_name}" <${config.from_email}>`,
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html
        });
        sent++;
      } catch (err) {
        console.error(`[new-doc notification] Error enviando a ${user.email}:`, err.message);
      }
    }
    console.log(`[new-doc notification] Enviado a ${sent}/${users.length} usuarios para doc ${docId}`);
    res.json({ message: `Notificaciones enviadas`, sent });
  } catch (error) {
    console.error("[new-doc notification] Error:", error);
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/list-models", async (req, res) => {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
  );
  const data = await r.json();
  res.json(data.models?.map(m => m.name) || data);
});

// 📅 Programar notificaciones diarias de resumen
// Se ejecuta diariamente a las 6:00 AM
cron.schedule('0 6 * * *', async () => {
  console.log('Running daily reminder notifications...');

  try {
    const [users] = await pool.query(
      'SELECT id, name, email FROM users WHERE email IS NOT NULL AND email != "" AND email != "impuestos@corriente.com.ec" AND (role = "Admin" OR role = "Operator")'
    );

    for (const user of users) {
      try {
        // Get overdue documents
        const [overdueDocs] = await pool.query(`
          SELECT id, title, trarnite_number, due_date, authority
          FROM documents
          WHERE (created_by = ? OR last_edited_by = ?)
          AND due_date < CURDATE()
          AND status != 'Completado'
          ORDER BY due_date ASC
        `, [user.id, user.id]);

        // Get upcoming documents (next 7 days)
        const [upcomingDocs] = await pool.query(`
          SELECT id, title, trarnite_number, due_date, authority
          FROM documents
          WHERE (created_by = ? OR last_edited_by = ?)
          AND due_date >= CURDATE()
          AND due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
          AND status != 'Completado'
          ORDER BY due_date ASC
        `, [user.id, user.id]);

        if (overdueDocs.length > 0 || upcomingDocs.length > 0) {
          // Generate HTML email content
          const htmlContent = generateDailyReminderHTML(overdueDocs, upcomingDocs);
          const subject = `Resumen Diario: Documentos que Requieren Atención - ${new Date().toLocaleDateString('es-ES')}`;

          try {
            const transporter = await getEmailTransporter();
            const config = await getSmtpConfig();

            await transporter.sendMail({
              from: `"${config.from_name}" <${config.from_email}>`,
              to: user.email,
              subject: subject,
              html: htmlContent
            });

            // Log notification for first document
            if (overdueDocs.length > 0) {
              await pool.query(
                'INSERT INTO notifications (user_id, document_id, notification_type, subject, content, email_sent, sent_at) VALUES (?, ?, ?, ?, ?, true, NOW())',
                [user.id, overdueDocs[0].id, 'daily_reminder', subject, htmlContent]
              );
            } else if (upcomingDocs.length > 0) {
              await pool.query(
                'INSERT INTO notifications (user_id, document_id, notification_type, subject, content, email_sent, sent_at) VALUES (?, ?, ?, ?, ?, true, NOW())',
                [user.id, upcomingDocs[0].id, 'daily_reminder', subject, htmlContent]
              );
            }

            console.log(`Daily reminder sent to ${user.email}`);
          } catch (error) {
            console.error(`Error sending daily reminder to ${user.email}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`Error processing daily reminder for user ${user.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error in daily reminder cron job:', error);
  }
});

// 🔟 Arrancar servidor
const PORT = 3001;

async function ensureIndexes() {
  try {
    // Indexes for dashboard queries (status, due_date filtering)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_status ON documents (status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_due_date ON documents (due_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_status_due ON documents (status, due_date)`);

    // Indexes for JOIN conditions and filters
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents (created_by)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_last_edited_by ON documents (last_edited_by)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents (company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_authority ON documents (authority(50))`);

    // Indexes for contestations queries (avoid N+1)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_contestations_document_id ON contestations (document_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_contestation_files_contestation_id ON contestation_files (contestation_id)`);

    // Indexes for activities queries
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activities_document_id ON activities (document_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activities_completed_by ON activities (completed_by)`);

    // Index for ORDER BY created_at DESC on documents list
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at)`);

    console.log('✅ Índices de base de datos verificados');
  } catch (err) {
    // Non-fatal: some MariaDB versions don't support IF NOT EXISTS for indexes
    console.warn('⚠️ No se pudieron crear índices (no crítico):', err.message);
  }
}

// 🔄 Auto-curador de tabla contestations y contestation_files
let contestationsTableReady = false;
let contestationFilesTableReady = false;
let ensuringContestationsTable = null;

async function ensureContestationsTable() {
  if (contestationsTableReady && contestationFilesTableReady) return;
  if (ensuringContestationsTable) return ensuringContestationsTable;

  ensuringContestationsTable = (async () => {
    // Tabla principal
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contestations (
          id VARCHAR(100) PRIMARY KEY,
          document_id VARCHAR(100) NOT NULL,
          presentation_date DATE,
          authority_received VARCHAR(255),
          notes TEXT,
          contact_method VARCHAR(100),
          registered_by VARCHAR(50),
          registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_edited_by VARCHAR(50),
          last_edited_at TIMESTAMP NULL,
          INDEX idx_contestations_document_id (document_id)
        )
      `);
      const colAlters = [
        `ALTER TABLE contestations ADD COLUMN presentation_date DATE`,
        `ALTER TABLE contestations ADD COLUMN authority_received VARCHAR(255)`,
        `ALTER TABLE contestations ADD COLUMN notes TEXT`,
        `ALTER TABLE contestations ADD COLUMN contact_method VARCHAR(100)`,
        `ALTER TABLE contestations ADD COLUMN registered_by VARCHAR(50)`,
        `ALTER TABLE contestations ADD COLUMN registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
        `ALTER TABLE contestations ADD COLUMN last_edited_by VARCHAR(50)`,
        `ALTER TABLE contestations ADD COLUMN last_edited_at TIMESTAMP NULL`,
      ];
      for (const sql of colAlters) {
        try { await pool.query(sql); } catch (e) { /* ya existe */ }
      }
      contestationsTableReady = true;
      console.log('✅ Tabla contestations lista');
    } catch (err) {
      console.error('⚠️ Error creando tabla contestations:', err.message);
    }

    // Tabla de archivos — separada para que un fallo no bloquee la tabla principal
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contestation_files (
          id VARCHAR(100) PRIMARY KEY,
          contestation_id VARCHAR(100) NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_url LONGTEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // CRÍTICO: convertir file_url a LONGTEXT si está en TEXT (archivos base64 grandes)
      try {
        await pool.query(`ALTER TABLE contestation_files MODIFY COLUMN file_url LONGTEXT NOT NULL`);
      } catch (e) { /* ya es LONGTEXT */ }
      // Índice en sentencia separada — más compatible con MariaDB
      try {
        await pool.query(`ALTER TABLE contestation_files ADD INDEX idx_cf_contestation_id (contestation_id)`);
      } catch (e) { /* índice ya existe */ }
      contestationFilesTableReady = true;
      console.log('✅ Tabla contestation_files lista (file_url=LONGTEXT)');
    } catch (err) {
      console.error('⚠️ Error creando tabla contestation_files:', err.message);
    }

    // If tables couldn't be created, allow the server to continue with in-memory fallback
    if (!contestationsTableReady || !contestationFilesTableReady) {
      console.warn(`⚠️ Not all contestation tables ready: contestations=${contestationsTableReady}, files=${contestationFilesTableReady}. Server will use in-memory fallback.`);
    } else {
      console.log('✅ All contestation tables verified and ready');
    }

    ensuringContestationsTable = null;
  })();

  return ensuringContestationsTable;
}

async function createActivityFilesTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_files (
        id VARCHAR(100) PRIMARY KEY,
        activity_id VARCHAR(50) NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_url LONGTEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // CRÍTICO: convertir file_url a LONGTEXT si está en TEXT (archivos base64 grandes)
    try {
      await pool.query(`ALTER TABLE activity_files MODIFY COLUMN file_url LONGTEXT NOT NULL`);
    } catch (e) { /* ya es LONGTEXT */ }

    // Crear índice si no existe
    try {
      await pool.query("CREATE INDEX IF NOT EXISTS idx_activity_files ON activity_files(activity_id)");
    } catch (err) {
      // Índice ya existe, ignorar
    }

    console.log('✅ Tabla activity_files verificada/creada (file_url=LONGTEXT)');
  } catch (err) {
    console.warn('⚠️ Error al crear tabla activity_files:', err.message);
  }
}

// 📦 Migración: respalda en la BD cualquier archivo que aún esté en disco.
// Idempotente: solo inserta los que faltan. Rescata los archivos presentes en el
// contenedor en el momento del arranque, para que sobrevivan futuros redespliegues.
async function migrateDiskFilesToDb() {
  await ensureDocumentFilesTable();
  let diskFiles = [];
  try {
    diskFiles = fs.readdirSync(UPLOAD_DIR);
  } catch (e) {
    console.log(`📦 [migrate-files] UPLOAD_DIR no legible (${e.message}); nada que migrar`);
    return;
  }
  if (diskFiles.length === 0) {
    console.log('📦 [migrate-files] No hay archivos en disco para migrar');
    return;
  }
  let migrated = 0, skipped = 0, failed = 0;
  for (const fname of diskFiles) {
    try {
      const fp = path.join(UPLOAD_DIR, fname);
      const stat = fs.statSync(fp);
      if (!stat.isFile()) continue;
      const [exists] = await pool.query("SELECT id FROM document_files WHERE id = ? LIMIT 1", [fname]);
      if (exists.length > 0) { skipped++; continue; }
      const buffer = await fs.promises.readFile(fp);
      await pool.query(
        `INSERT INTO document_files (id, file_name, mime_type, data, size) VALUES (?, ?, ?, ?, ?)`,
        [fname, fname, guessMimeType(fname), buffer, stat.size]
      );
      migrated++;
    } catch (e) {
      failed++;
      console.warn(`📦 [migrate-files] Error con ${fname}:`, e.message);
    }
  }
  console.log(`📦 [migrate-files] ✅ Migrados ${migrated} archivos disco→BD (omitidos ${skipped} ya existentes, ${failed} fallidos)`);
}

// 🗓️ Flag para no re-verificar la tabla en cada request (se resetea solo al reinicio)
let holidaysTableReady = false;
let ensuringHolidaysTable = null; // Promise compartida para evitar múltiples ejecuciones concurrentes

// 🗓️ Función auto-curadora: garantiza que la tabla existe, tiene todas las columnas y datos iniciales
// Se llama al INICIO de cada endpoint de holidays. Si la BD se cae y vuelve, todo se re-crea solo.
async function ensureHolidaysTable() {
  if (holidaysTableReady) return;
  if (ensuringHolidaysTable) return ensuringHolidaysTable;

  ensuringHolidaysTable = (async () => {
    // 1. Crear tabla si no existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id INT PRIMARY KEY AUTO_INCREMENT,
        official_date DATE,
        holiday_date DATE NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        holiday_type ENUM('Ordinary', 'Extraordinary') DEFAULT 'Ordinary',
        created_by VARCHAR(50),
        updated_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_holiday_date (holiday_date)
      )
    `);

    // 2. Agregar columnas faltantes (tablas pre-existentes de versiones anteriores)
    const alters = [
      { sql: `ALTER TABLE holidays ADD COLUMN updated_by VARCHAR(50) AFTER created_by`, name: 'updated_by' },
      { sql: `ALTER TABLE holidays ADD COLUMN official_date DATE AFTER id`, name: 'official_date' }
    ];
    for (const { sql, name } of alters) {
      try {
        await pool.query(sql);
        console.log(`✅ Columna ${name} agregada a holidays`);
      } catch (err) {
        if (!err.message.includes('Duplicate column')) throw err;
      }
    }

    // 3. Rellenar official_date para filas que no lo tengan (migración de datos legacy)
    await pool.query(`UPDATE holidays SET official_date = holiday_date WHERE official_date IS NULL`);

    // 4. Sembrar feriados 2026 si la tabla está vacía o falta alguno
    for (const [officialDate, calendarDate, name, type] of ECUADOR_HOLIDAYS_2026) {
      const [result] = await pool.query(
        'INSERT IGNORE INTO holidays (official_date, holiday_date, name, holiday_type) VALUES (?, ?, ?, ?)',
        [officialDate, calendarDate, name, type]
      );
      // Para filas existentes sin official_date, actualizarlo
      if (result.affectedRows === 0) {
        await pool.query(
          'UPDATE holidays SET official_date = ? WHERE holiday_date = ? AND official_date IS NULL',
          [officialDate, calendarDate]
        );
      }
    }

    holidaysTableReady = true;
    console.log('✅ Tabla holidays verificada, columnas y datos iniciales listos');
  })();

  try {
    await ensuringHolidaysTable;
  } finally {
    ensuringHolidaysTable = null;
  }
}

// Alias legacy para mantener compatibilidad con startup sequence
async function createHolidaysTable() {
  try {
    await ensureHolidaysTable();
  } catch (err) {
    console.warn('⚠️ No se pudo verificar tabla holidays en startup (se reintentará en primera request):', err.message);
  }
}

// 🗓️ Feriados oficiales Ecuador 2026
// Formato: [official_date, calendar_date, name, type]
// official_date = fecha del decreto, calendar_date = fecha de descanso observada (traslado aplicado)
const ECUADOR_HOLIDAYS_2026 = [
  ['2026-01-01', '2026-01-02', 'Año Nuevo', 'Ordinary'],                              // Jueves → Viernes
  ['2026-02-16', '2026-02-16', 'Lunes de Carnaval', 'Ordinary'],                     // Lunes → se mantiene
  ['2026-02-17', '2026-02-17', 'Martes de Carnaval', 'Ordinary'],                    // Carnaval: se mantiene
  ['2026-04-03', '2026-04-03', 'Viernes Santo', 'Ordinary'],                         // Viernes → se mantiene
  ['2026-05-01', '2026-05-01', 'Día del Trabajo', 'Ordinary'],                       // Viernes → se mantiene
  ['2026-05-24', '2026-05-25', 'Batalla de Pichincha', 'Ordinary'],                  // Domingo → Lunes
  ['2026-08-10', '2026-08-10', 'Primer Grito de Independencia', 'Ordinary'],         // Lunes → se mantiene
  ['2026-10-09', '2026-10-09', 'Independencia de Guayaquil', 'Ordinary'],            // Viernes → se mantiene
  ['2026-11-02', '2026-11-02', 'Día de los Difuntos / Independencia de Cuenca', 'Ordinary'], // Lunes → se mantiene
  ['2026-12-25', '2026-12-25', 'Navidad', 'Ordinary']                                // Viernes → se mantiene
];

// Carga los feriados 2026 usando INSERT IGNORE (preserva ediciones del admin, no sobreescribe)
// Para filas ya existentes, actualiza official_date si aún no está configurado
async function migrateHolidays2026() {
  try {
    let inserted = 0, updated = 0;
    for (const [officialDate, calendarDate, name, type] of ECUADOR_HOLIDAYS_2026) {
      const [result] = await pool.query(
        'INSERT IGNORE INTO holidays (official_date, holiday_date, name, holiday_type) VALUES (?, ?, ?, ?)',
        [officialDate, calendarDate, name, type]
      );
      if (result.affectedRows > 0) {
        inserted++;
      } else {
        // Fila ya existe: actualizar official_date si no está definido
        const [upResult] = await pool.query(
          'UPDATE holidays SET official_date = ? WHERE holiday_date = ? AND official_date IS NULL',
          [officialDate, calendarDate]
        );
        if (upResult.affectedRows > 0) updated++;
      }
    }
    if (inserted > 0) console.log(`✅ Feriados 2026 insertados: ${inserted}`);
    if (updated > 0) console.log(`✅ Fechas oficiales 2026 actualizadas: ${updated}`);
    if (inserted === 0 && updated === 0) console.log('✅ Feriados 2026 ya están al día en BD');
  } catch (err) {
    console.error('❌ Error al migrar feriados 2026:', err.message);
  }
}

// 🔄 Migración: Poblar actividades antiguas con created_by/created_at
async function migrateDocumentNumberColumn() {
  try {
    await pool.query("ALTER TABLE documents ADD COLUMN document_number VARCHAR(255) DEFAULT NULL");
    console.log('✅ Campo document_number agregado a documents');
  } catch (err) {
    // Campo ya existe, ignorar
  }
}

// 🔄 Migración: Remover UNIQUE en trarnite_number, agregar UNIQUE en document_number
async function migrateDocumentUniqueConstraints() {
  try {
    // Remover UNIQUE constraint en trarnite_number (si existe)
    try {
      await pool.query("ALTER TABLE documents DROP INDEX trarnite_number");
      console.log('✅ Constraint UNIQUE en trarnite_number removido');
    } catch (err) {
      // Index no existe o no se pudo remover, continuar
    }

    // Agregar UNIQUE constraint en document_number (si no existe)
    // Primero, eliminar cualquier índice duplicado que exista
    try {
      await pool.query("ALTER TABLE documents DROP INDEX IF EXISTS document_number");
    } catch (e) {
      // Ignorar si no existe
    }

    try {
      await pool.query("ALTER TABLE documents DROP INDEX IF EXISTS idx_document_number");
    } catch (e) {
      // Ignorar si no existe
    }

    // Ahora agregar el índice correcto
    const [indexes] = await pool.query(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME = 'documents' AND INDEX_NAME = 'idx_document_number'"
    );
    if (indexes.length === 0) {
      // Solo agregar si no existe, pero permitir NULLs (documentNumber es opcional)
      await pool.query("ALTER TABLE documents ADD UNIQUE KEY idx_document_number (document_number)");
      console.log('✅ UNIQUE constraint en document_number agregado (limpiado de duplicados)');
    } else {
      console.log('✅ UNIQUE constraint en document_number ya existe');
    }
  } catch (err) {
    console.warn('⚠️ migrateDocumentUniqueConstraints: ', err.message);
  }
}

async function migrateActivitiesAuditTrail() {
  try {
    // Obtener primer admin para asignar a actividades antiguas
    const [adminUsers] = await pool.query("SELECT id FROM users WHERE role = 'Admin' LIMIT 1");
    if (adminUsers.length === 0) {
      console.log('⚠️ No hay usuarios Admin para migración de actividades');
      return;
    }

    const adminId = adminUsers[0].id;

    // Agregar columnas created_by y created_at si no existen
    try {
      await pool.query("ALTER TABLE activities ADD COLUMN created_by VARCHAR(50)");
      console.log('✅ Campo created_by agregado a activities');
    } catch (err) {
      // Campo ya existe, ignorar
    }

    try {
      await pool.query("ALTER TABLE activities ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
      console.log('✅ Campo created_at agregado a activities');
    } catch (err) {
      // Campo ya existe, ignorar
    }

    // Poblar actividades antiguas sin created_by
    await pool.query("UPDATE activities SET created_by = ? WHERE created_by IS NULL", [adminId]);

    console.log('✅ Migración de auditoría de actividades completada');
  } catch (err) {
    console.warn('⚠️ Error en migración de actividades (no crítico):', err.message);
  }
}

// 📁 Sincroniza cambios del archivo de persistencia a la BD cuando esté disponible
// Esto asegura que ediciones hechas sin BD se persistan correctamente al reconectar
async function syncFallbackFileToDb() {
  if (!fs.existsSync(HOLIDAYS_FALLBACK_FILE)) return;

  const fileData = loadFallbackFile();
  if (!fileData || fileData.length === 0) return;

  try {
    let synced = 0;
    for (const h of fileData) {
      const officialDate = h.official_date instanceof Date ? h.official_date.toISOString().split('T')[0] : String(h.official_date).split('T')[0];
      const calendarDate = h.holiday_date instanceof Date ? h.holiday_date.toISOString().split('T')[0] : String(h.holiday_date).split('T')[0];
      await pool.query(
        `INSERT INTO holidays (official_date, holiday_date, name, holiday_type, created_by, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           official_date = VALUES(official_date),
           name = VALUES(name),
           holiday_type = VALUES(holiday_type),
           updated_by = VALUES(updated_by),
           updated_at = VALUES(updated_at)`,
        [officialDate, calendarDate, h.name, h.holiday_type, h.created_by, h.updated_by, h.updated_at || null]
      );
      synced++;
    }
    fs.unlinkSync(HOLIDAYS_FALLBACK_FILE);
    console.log(`✅ ${synced} feriados sincronizados desde archivo de persistencia a BD`);
  } catch (err) {
    console.warn('⚠️ Error al sincronizar holidays_fallback.json a BD:', err.message);
  }
}

// 🛡️ Manejador de errores global: garantiza que NINGUNA petición quede sin
// respuesta (evita ERR_EMPTY_RESPONSE cuando un error escapa de un handler).
// Debe registrarse después de todas las rutas.
app.use((err, req, res, next) => {
  console.error('💥 Express error handler:', req.method, req.originalUrl, '→', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ TaxControl-Api escuchando en puerto ${PORT}`);
  console.log('🏷️ build marker: activities-getstatus-v6');

  // Initialize tables with graceful error handling — don't crash the server
  try {
    await ensureIndexes();
  } catch (err) {
    console.warn('⚠️ ensureIndexes failed (non-critical):', err.message);
  }

  try {
    await ensureContestationsTable();
  } catch (err) {
    console.warn('⚠️ ensureContestationsTable failed (non-critical):', err.message);
  }

  try {
    await createActivityFilesTable();
  } catch (err) {
    console.warn('⚠️ createActivityFilesTable failed (non-critical):', err.message);
  }

  try {
    await ensureDocumentFilesTable();
    console.log('✅ Tabla document_files verificada/creada (data=LONGBLOB)');
  } catch (err) {
    console.warn('⚠️ ensureDocumentFilesTable failed (non-critical):', err.message);
  }

  try {
    await migrateDiskFilesToDb();
  } catch (err) {
    console.warn('⚠️ migrateDiskFilesToDb failed (non-critical):', err.message);
  }

  try {
    await createHolidaysTable();
  } catch (err) {
    console.warn('⚠️ createHolidaysTable failed (non-critical):', err.message);
  }

  try {
    await syncFallbackFileToDb();
  } catch (err) {
    console.warn('⚠️ syncFallbackFileToDb failed (non-critical):', err.message);
  }

  try {
    await migrateHolidays2026();
  } catch (err) {
    console.warn('⚠️ migrateHolidays2026 failed (non-critical):', err.message);
  }

  try {
    await migrateActivitiesAuditTrail();
  } catch (err) {
    console.warn('⚠️ migrateActivitiesAuditTrail failed (non-critical):', err.message);
  }

  try {
    await migrateDocumentNumberColumn();
  } catch (err) {
    console.warn('⚠️ migrateDocumentNumberColumn failed (non-critical):', err.message);
  }

  try {
    await migrateDocumentUniqueConstraints();
  } catch (err) {
    console.warn('⚠️ migrateDocumentUniqueConstraints failed (non-critical):', err.message);
  }

  // 📦 Verificación de almacenamiento persistente al arrancar
  try {
    await checkUploadStorageHealth();
  } catch (err) {
    console.warn('⚠️ checkUploadStorageHealth failed (non-critical):', err.message);
  }
});

// 📦 Verifica salud del almacenamiento de archivos al inicio.
// Un archivo se considera presente si está en la BD (document_files) o en disco.
// Reporta documentos cuyo archivo ya no existe en NINGUNO de los dos (pérdida real).
async function checkUploadStorageHealth() {
  console.log(`📦 [storage-check] UPLOAD_DIR=${UPLOAD_DIR}`);
  let diskFiles = [];
  try {
    diskFiles = fs.readdirSync(UPLOAD_DIR);
    console.log(`📦 [storage-check] Archivos en disco: ${diskFiles.length}`);
  } catch (e) {
    console.warn(`📦 [storage-check] UPLOAD_DIR no legible (esperado si todo está en BD):`, e.message);
  }

  try {
    await ensureDocumentFilesTable();
    const [dbFiles] = await pool.query("SELECT id FROM document_files");
    const dbIds = new Set(dbFiles.map(r => r.id));
    console.log(`📦 [storage-check] Archivos en BD (document_files): ${dbIds.size}`);

    const [docsWithFiles] = await pool.query(
      "SELECT id, file_url FROM documents WHERE file_url IS NOT NULL AND file_url != ''"
    );
    if (docsWithFiles.length === 0) {
      console.log(`📦 [storage-check] No hay documentos con archivos en BD`);
      return;
    }

    let missing = 0, inDb = 0, inDisk = 0, inlineBase64 = 0;
    const missingExamples = [];
    for (const doc of docsWithFiles) {
      // Documentos antiguos con base64 incrustado en file_url: ya son durables
      if (doc.file_url.startsWith('data:')) { inlineBase64++; continue; }
      const filename = doc.file_url.split('/').pop();
      if (!filename) continue;
      if (dbIds.has(filename)) { inDb++; }
      else if (diskFiles.includes(filename)) { inDisk++; }
      else {
        missing++;
        if (missingExamples.length < 5) missingExamples.push({ docId: doc.id, filename });
      }
    }

    console.log(`📦 [storage-check] Resumen: ${inDb} en BD, ${inDisk} solo en disco, ${inlineBase64} base64 incrustado`);
    if (missing === 0) {
      console.log(`📦 [storage-check] ✅ Todos los documentos tienen su archivo disponible`);
    } else {
      console.warn(`📦 [storage-check] ⚠️ ${missing}/${docsWithFiles.length} documentos con archivo PERDIDO (ni en BD ni en disco)`);
      console.warn(`📦 [storage-check] Ejemplos:`, missingExamples);
      console.warn(`📦 [storage-check] 💡 Estos archivos se perdieron en un redespliegue previo, antes de migrar a almacenamiento en BD. Los nuevos cargados ya quedan a salvo en la BD.`);
    }
  } catch (err) {
    console.error(`📦 [storage-check] Error consultando BD:`, err.message);
  }
}
