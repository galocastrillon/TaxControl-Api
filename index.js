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

// 2️⃣ Crear app
const app = express();
app.use(compression());
app.use(cors({
  origin: [
    'http://taxcontrolapp.192.168.60.109.sslip.io',
    'https://taxcontrolapp.192.168.60.109.sslip.io',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Servir archivos estáticos de uploads
app.use('/api/files', express.static(UPLOAD_DIR));

// Configurar multer para carga de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF e imágenes (JPG, PNG)'));
    }
  }
});

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
              <a href="http://taxcontrolapp.192.168.60.109.sslip.io/#/login"
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
              <a href="http://taxcontrolapp.192.168.60.109.sslip.io/#/login"
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

// 📁 POST cargar archivo
app.post("/api/upload", requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha cargado ningún archivo' });
    }

    const fileUrl = `/api/files/${req.file.filename}`;
    res.json({
      success: true,
      fileUrl,
      fileName: req.file.originalname,
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
    const { company_id, authority, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(500, Math.max(5, parseInt(limit) || 20));
    const offset = (pageNum - 1) * pageSize;

    let query = `
      SELECT d.id, d.title, d.trarnite_number, d.document_number, d.company_id, d.authority,
             d.department, d.notification_date, d.days_limit, d.day_type, d.due_date, d.status,
             d.summary_es, d.summary_cn, d.file_name, d.file_url, d.related_doc_id,
             d.created_by, u.name as created_by_name, d.created_at,
             d.last_edited_by, u2.name as last_edited_by_name, d.last_edited_at
      FROM documents d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN users u2 ON d.last_edited_by = u2.id
      WHERE 1=1
    `;
    let countQuery = `SELECT COUNT(*) as total FROM documents d WHERE 1=1`;
    const params = [];
    const countParams = [];

    // Filtro por company_id si se proporciona
    if (company_id && company_id !== 'Todas') {
      query += ` AND d.company_id = ?`;
      countQuery += ` AND d.company_id = ?`;
      params.push(company_id);
      countParams.push(company_id);
    }

    // Filtro por authority si se proporciona (case-insensitive comparison)
    if (authority && authority !== 'Todas') {
      query += ` AND d.authority LIKE ?`;
      countQuery += ` AND d.authority LIKE ?`;
      params.push(`%${authority}%`);
      countParams.push(`%${authority}%`);
    }

    query += ` ORDER BY d.created_at DESC LIMIT ? OFFSET ?`;
    params.push(pageSize, offset);

    const [[rows], [countRows]] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams)
    ]);
    const total = countRows[0]?.total || 0;

    const docs = rows.map(d => ({
      id: d.id,
      title: d.title,
      trarniteNumber: d.trarnite_number,
      companyId: d.company_id,
      company: d.company_id || d.company_name,
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

    res.json({
      documents: docs,
      total: total,
      page: pageNum,
      limit: pageSize,
      hasMore: pageNum < Math.ceil(total / pageSize)
    });
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
      createdBy: a.created_by_name || a.created_by,
      createdAt: a.created_at?.toISOString?.().split('T')[0] || a.created_at,
      completedBy: a.completed_by,
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
      id: d.id, title: d.title, trarniteNumber: d.trarnite_number,
      company: d.company_id || d.company_name, authority: d.authority,
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

  if (!d.title || !d.trarniteNumber || !d.authority || !d.dueDate) {
    return res.status(400).json({ error: "Campos requeridos: title, trarniteNumber, authority, dueDate" });
  }

  // Asegurar que los campos NOT NULL tengan valores
  const notificationDate = d.notificationDate || new Date().toISOString().split('T')[0];
  const dueDate = d.dueDate || new Date().toISOString().split('T')[0];
  const dayType = d.dayType || 'Días hábiles';

  try {
    const id = d.id || `d${Date.now()}`;
    await pool.query(`
      INSERT INTO documents
        (id, title, trarnite_number, company_id, authority, department,
         notification_date, days_limit, day_type, due_date, status,
         summary_es, summary_cn, file_name, file_url, related_doc_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, d.title, d.trarniteNumber, d.company || null, d.authority, d.department || null,
      notificationDate, d.daysLimit || 0, dayType, dueDate,
      d.status || "Inicializado", d.summaryEs || '', d.summaryCn || '',
      d.fileName || null, d.fileUrl || null, d.relatedDoc || null, req.user.user_id
    ]);
    res.status(201).json({ id, ...d });
  } catch (error) {
    console.error("POST /api/documents error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📄 PUT actualizar documento
app.put("/api/documents/:id", requireAuth, async (req, res) => {
  const d = req.body;
  const id = req.params.id;

  // Validar campos requeridos
  if (!d.title || !d.trarniteNumber || !d.authority || !d.dueDate) {
    return res.status(400).json({ error: "Campos requeridos: title, trarniteNumber, authority, dueDate" });
  }

  // Asegurar que los campos NOT NULL tengan valores
  const notificationDate = d.notificationDate || new Date().toISOString().split('T')[0];
  const dueDate = d.dueDate || new Date().toISOString().split('T')[0];
  const dayType = d.dayType || 'Días hábiles';

  try {
    // Get the old document data
    const [oldDocRows] = await pool.query('SELECT * FROM documents WHERE id = ?', [id]);
    if (oldDocRows.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    const oldDoc = oldDocRows[0];

    // Update the document
    const [result] = await pool.query(`
      UPDATE documents SET
        title = ?, trarnite_number = ?, company_id = ?, authority = ?,
        department = ?, notification_date = ?, days_limit = ?, day_type = ?,
        due_date = ?, status = ?, summary_es = ?, summary_cn = ?,
        file_name = ?, file_url = ?, related_doc_id = ?, last_edited_by = ?, last_edited_at = NOW()
      WHERE id = ?
    `, [
      d.title, d.trarniteNumber, d.company || null, d.authority,
      d.department || null, notificationDate, d.daysLimit || 0, dayType,
      dueDate, d.status || 'Inicializado', d.summaryEs || '', d.summaryCn || '',
      d.fileName || null, d.fileUrl || null, d.relatedDoc || null, req.user.user_id, id
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

    res.json({ ok: true });
  } catch (error) {
    console.error("PUT /api/documents error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📄 DELETE eliminar documento
app.delete("/api/documents/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM documents WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/documents error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📋 GET actividades
app.get("/api/activities", requireAuth, async (req, res) => {
  try {
    const { docId, limit = 100 } = req.query;
    const maxLimit = Math.min(500, parseInt(limit) || 100);

    let query = `
      SELECT a.*, d.title as doc_title, u.name as completed_by_name
      FROM activities a
      LEFT JOIN documents d ON a.document_id = d.id
      LEFT JOIN users u ON a.completed_by = u.id
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
    res.json(rows.map(a => ({
      id: a.id, docId: a.document_id, docTitle: a.doc_title,
      description: a.description, subDescription: a.sub_description,
      dueDate: a.due_date?.toISOString?.().split('T')[0],
      status: a.status, priority: a.priority,
      createdBy: a.created_by_name || a.created_by,
      createdAt: a.created_at?.toISOString?.().split('T')[0],
      completedBy: a.completed_by, completedAt: a.completed_at?.toISOString?.().split('T')[0]
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📋 POST crear actividad
app.post("/api/activities", requireAuth, async (req, res) => {
  const { docId, description, subDescription, dueDate, priority } = req.body;
  try {
    const id = `a${Date.now()}`;

    // Insert the activity with audit trail
    await pool.query(
      `INSERT INTO activities
       (id, document_id, description, sub_description, due_date, priority, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, NOW())`,
      [id, docId, description, subDescription, dueDate, priority || 'Medium', req.user.user_id]
    );

    // Get document info for notifications
    const [docRows] = await pool.query('SELECT title, trarnite_number FROM documents WHERE id = ?', [docId]);
    if (docRows.length > 0) {
      const doc = docRows[0];
      const recipients = await getDocumentRecipients(docId);
      const formattedDueDate = dueDate ? new Date(dueDate).toLocaleDateString('es-ES') : 'N/A';

      const emailTemplate = getActivityAddedEmailContent(doc.title, doc.trarnite_number, description, formattedDueDate, priority || 'Medium', req.user.name);
      await sendNotificationEmail(recipients, emailTemplate.subject, emailTemplate.html, docId, 'activity_added');
    }

    res.status(201).json({ id, docId, description, subDescription, dueDate, priority: priority || 'Medium', status: 'Pending', createdBy: req.user.name, createdAt: new Date().toISOString().split('T')[0] });
  } catch (error) {
    console.error("POST /api/activities error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📋 PUT actualizar actividad
app.put("/api/activities/:id", requireAuth, async (req, res) => {
  const { description, subDescription, dueDate, priority, status } = req.body;
  try {
    await pool.query(
      `UPDATE activities
       SET description=?, sub_description=?, due_date=?, priority=?, status=?
       WHERE id=?`,
      [description, subDescription, dueDate, priority, status, req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📋 DELETE eliminar actividad
app.delete("/api/activities/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM activities WHERE id = ?", [req.params.id]);
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
      [req.user.name, req.params.id]
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

    // 1. Fetch all contestations for these documents in ONE query
    const placeholders = docIds.map(() => '?').join(',');
    const [contestations] = await pool.query(`
      SELECT c.id, c.document_id, c.presentation_date, c.authority_received, c.notes,
             c.contact_method, c.registered_by, u.name as registered_by_name, c.registration_date
      FROM contestations c
      LEFT JOIN users u ON c.registered_by = u.id
      WHERE c.document_id IN (${placeholders})
      ORDER BY c.document_id, c.registration_date DESC
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
    const [rows] = await pool.query(`
      SELECT c.*, u.name as registered_by_name
      FROM contestations c
      LEFT JOIN users u ON c.registered_by = u.id
      WHERE c.document_id = ?
      ORDER BY c.registration_date DESC
      LIMIT 100
    `, [req.params.id]);

    // 🚀 Cargar archivos en PARALELO en lugar de secuencial
    const contestations = await Promise.all(
      rows.map(async (c) => {
        const [files] = await pool.query(
          'SELECT * FROM contestation_files WHERE contestation_id = ? LIMIT 50',
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
          files: (files || []).map(f => ({ name: f.file_name, url: f.file_url }))
        };
      })
    );

    res.json(contestations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 💬 POST crear contestación
app.post("/api/documents/:id/contestations", requireAuth, async (req, res) => {
  const { date, authority, notes, contact_method, files } = req.body;
  const documentId = req.params.id;

  if (!date || !authority) {
    return res.status(400).json({ error: "Campos requeridos: date, authority" });
  }

  try {
    const contestationId = `c${Date.now()}`;
    await pool.query(
      `INSERT INTO contestations
       (id, document_id, presentation_date, authority_received, notes, contact_method, registered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [contestationId, documentId, date, authority, notes || '', contact_method || '', req.user.user_id]
    );

    // Guardar archivos asociados si existen
    if (files && Array.isArray(files) && files.length > 0) {
      for (const file of files) {
        if (file.name && file.url) {
          const fileId = `cf${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await pool.query(
            `INSERT INTO contestation_files (id, contestation_id, file_name, file_url)
             VALUES (?, ?, ?, ?)`,
            [fileId, contestationId, file.name, file.url]
          );
        }
      }
    }

    // Get document info for notifications
    const [docRows] = await pool.query('SELECT title, trarnite_number FROM documents WHERE id = ?', [documentId]);
    if (docRows.length > 0) {
      const doc = docRows[0];
      const recipients = await getDocumentRecipients(documentId);
      const formattedDate = new Date(date).toLocaleDateString('es-ES');

      const emailTemplate = getContestationAddedEmailContent(doc.title, doc.trarnite_number, notes || 'N/A', contact_method || 'N/A', formattedDate, req.user.name);
      await sendNotificationEmail(recipients, emailTemplate.subject, emailTemplate.html, documentId, 'contestation_added');
    }

    res.status(201).json({
      id: contestationId,
      date,
      authority,
      notes,
      contact_method,
      registered_by: req.user.name,
      registration_date: new Date().toISOString().split('T')[0],
      files: files || []
    });
  } catch (error) {
    console.error("POST /api/documents/:id/contestations error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 💬 PUT actualizar contestación
app.put("/api/contestations/:id", requireAuth, async (req, res) => {
  const { date, authority, notes, contact_method } = req.body;
  try {
    await pool.query(
      `UPDATE contestations
       SET presentation_date=?, authority_received=?, notes=?, contact_method=?
       WHERE id=?`,
      [date, authority, notes, contact_method, req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 💬 DELETE eliminar contestación
app.delete("/api/contestations/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM contestations WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🤖 Endpoint de análisis con IA (Gemini)
app.post("/api/analyze", requireAuth, async (req, res) => {
  const { fileData, mimeType } = req.body;
  if (!fileData) return res.status(400).json({ error: "fileData requerido" });

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
                  mime_type: mimeType || "application/pdf",
                  data: fileData
                }
              },
              {
                text: `Analiza este documento y responde SOLO con JSON válido sin markdown. EXTRAE: trarniteNumber=número interno de trámite/expediente (ej: "Trámite No."); documentNumber=número oficial del documento emitido (ej: "Resolución No.", "Oficio No.", "Notificación No.", "Auto No.", "Providencia No.") — búscalo en encabezado, pie y cuerpo. Si solo hay un número ponlo en trarniteNumber y deja documentNumber vacío:\n{"authority":"","department":"","company":"","notificationDate":"YYYY-MM-DD","emissionDate":"YYYY-MM-DD","daysLimit":10,"dayType":"Días hábiles","trarniteNumber":"","documentNumber":"","title":"","summaryEs":"resumen breve en español","summaryCn":"简短摘要","activities":[""]}`
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
      secure: isSecure && port === 465,
      requireTLS: !isSecure || port === 587,
      auth: {
        user: config.user,
        pass: config.password
      },
      tls: {
        rejectUnauthorized: false,
        minVersion: "TLSv1.2"
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
              <a href="http://taxcontrolapp.192.168.60.109.sslip.io/#/reset-password?token=DEMO_TOKEN_12345"
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
              <a href="http://taxcontrolapp.192.168.60.109.sslip.io/#/login"
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
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!password) {
      return res.status(400).json({ error: "Password is required for SMTP configuration" });
    }

    // Use INSERT ... ON DUPLICATE KEY UPDATE to create or update the config
    const query = `
      INSERT INTO smtp_config (id, host, port, user, password, from_email, from_name, use_ssl)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        host=VALUES(host),
        port=VALUES(port),
        user=VALUES(user),
        password=VALUES(password),
        from_email=VALUES(from_email),
        from_name=VALUES(from_name),
        use_ssl=VALUES(use_ssl),
        updated_at=NOW()
    `;
    const params = [host, port, user, password, from_email, from_name, use_ssl ? 1 : 0];

    await pool.query(query, params);
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
        <a href="http://taxcontrolapp.192.168.60.109.sslip.io/#/documents/${doc.id}"
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
        <a href="http://taxcontrolapp.192.168.60.109.sslip.io/#/documents/${doc.id}"
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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activities_created_by ON activities (created_by)`);

    // Index for ORDER BY created_at DESC on documents list
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at)`);

    console.log('✅ Índices de base de datos verificados');
  } catch (err) {
    // Non-fatal: some MariaDB versions don't support IF NOT EXISTS for indexes
    console.warn('⚠️ No se pudieron crear índices (no crítico):', err.message);
  }
}

// 🔄 Migración: Poblar actividades antiguas con created_by/created_at
async function migrateActivitiesAuditTrail() {
  try {
    // Obtener primer admin para asignar a actividades antiguas
    const [adminUsers] = await pool.query("SELECT id FROM users WHERE role = 'Admin' LIMIT 1");
    if (adminUsers.length === 0) {
      console.log('⚠️ No hay usuarios Admin para migración de actividades');
      return;
    }

    const adminId = adminUsers[0].id;

    // Limpiar created_by que no son user IDs válidos (ej: session IDs guardados por bug previo)
    await pool.query(
      `UPDATE activities SET created_by = NULL
       WHERE created_by IS NOT NULL
         AND created_by NOT IN (SELECT id FROM users)`
    );

    // Asignar actividades sin created_by al admin (solo created_at si está vacío)
    await pool.query(
      "UPDATE activities SET created_by = ? WHERE created_by IS NULL",
      [adminId]
    );
    await pool.query(
      "UPDATE activities SET created_at = NOW() WHERE created_at IS NULL"
    );

    console.log('✅ Migración de auditoría de actividades completada');
  } catch (err) {
    console.warn('⚠️ Error en migración de actividades (no crítico):', err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`✅ TaxControl-Api escuchando en puerto ${PORT}`);
  await ensureIndexes();
  await migrateActivitiesAuditTrail();
});
