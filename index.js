/*
import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

// 1️⃣ Cargar variables de entorno
dotenv.config();

// 2️⃣ Crear app
const app = express();
app.use(cors());
//app.use(express.json());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 3️⃣ Crear pool MariaDB (GLOBAL)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
});

// 4️⃣ Endpoint de salud
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 5️⃣ Endpoint de prueba DB
app.get("/api/db-test", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT VERSION() AS version");
    res.json({
      status: "connected",
      mariadb: rows[0].version,
    });
  } catch (error) {
    console.error("DB ERROR:", error);
    res.status(500).json({
      error: error.message,
      code: error.code,
    });
  }
});

// 6️⃣ Middleware verificar sesión
const requireAuth = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return res.status(401).json({ error: "No autorizado" });

  const token = auth.slice(7);
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
    next();
  } catch (error) {
    res.status(500).json({ error: "Error verificando sesión" });
  }
};

// 7️⃣ Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email y contraseña requeridos" });

  try {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );
    if (rows.length === 0)
      return res.status(401).json({ error: "Credenciales incorrectas" });

    const user = rows[0];

    // SHA256(id + password)
    const hash = crypto
      .createHash("sha256")
      .update(user.id + password)
      .digest("hex");

    if (hash !== user.password_hash)
      return res.status(401).json({ error: "Credenciales incorrectas" });

    // Crear sesión
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 horas

    await pool.query(
      "INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)",
      [token, user.id, user.role, expiresAt]
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
      },
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
    await pool.query("DELETE FROM sessions WHERE token = ?", [auth.slice(7)]);
  }
  res.json({ ok: true });
});

// 9️⃣ Usuario actual
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// 🔟 Arrancar servidor
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ TaxControl-Api escuchando en puerto ${PORT}`);
});
*/
import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

// 1️⃣ Cargar variables de entorno
dotenv.config();

// 2️⃣ Crear app
const app = express();
app.use(cors());
app.use(express.json());

// 3️⃣ Crear pool MariaDB (GLOBAL)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
});

// 4️⃣ Endpoint de salud
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 5️⃣ Endpoint de prueba DB
app.get("/api/db-test", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT VERSION() AS version");
    res.json({
      status: "connected",
      mariadb: rows[0].version,
    });
  } catch (error) {
    console.error("DB ERROR:", error);
    res.status(500).json({
      error: error.message,
      code: error.code,
    });
  }
});

// 6️⃣ Middleware verificar sesión
const requireAuth = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return res.status(401).json({ error: "No autorizado" });
  const token = auth.slice(7);
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
    next();
  } catch (error) {
    res.status(500).json({ error: "Error verificando sesión" });
  }
};

// 7️⃣ Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email y contraseña requeridos" });
  try {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );
    if (rows.length === 0)
      return res.status(401).json({ error: "Credenciales incorrectas" });
    const user = rows[0];

    // SHA256(id + password)
    const hash = crypto
      .createHash("sha256")
      .update(user.id + password)
      .digest("hex");
    if (hash !== user.password_hash)
      return res.status(401).json({ error: "Credenciales incorrectas" });

    // Crear sesión
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 horas
    await pool.query(
      "INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)",
      [token, user.id, user.role, expiresAt]
    );
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
      },
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
    await pool.query("DELETE FROM sessions WHERE token = ?", [auth.slice(7)]);
  }
  res.json({ ok: true });
});

// 9️⃣ Usuario actual
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/users", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, role, avatar_url FROM users ORDER BY created_at ASC"
    );
    res.json(rows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatar: u.avatar_url
    })));
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

// 📄 GET todos los documentos
app.get("/api/documents", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.*, 
        c.name as company_name,
        u.name as created_by_name
      FROM documents d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN users u ON d.created_by = u.id
      ORDER BY d.created_at DESC
    `);

    const docs = rows.map(d => ({
      id: d.id,
      title: d.title,
      trarniteNumber: d.trarnite_number,
      company: d.company_name || d.company_id,
      authority: d.authority,
      department: d.department,
      notificationDate: d.notification_date?.toISOString().split('T')[0],
      daysLimit: d.days_limit,
      dayType: d.day_type,
      dueDate: d.due_date?.toISOString().split('T')[0],
      status: d.status,
      summaryEs: d.summary_es,
      summaryCn: d.summary_cn,
      fileName: d.file_name,
      createdBy: d.created_by_name || d.created_by,
      createdAt: d.created_at?.toISOString().split('T')[0],
      contestations: []
    }));

    res.json(docs);
  } catch (error) {
    console.error("GET /api/documents error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 📄 GET un documento por ID
app.get("/api/documents/:id", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.*, c.name as company_name, u.name as created_by_name
      FROM documents d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN users u ON d.created_by = u.id
      WHERE d.id = ?
    `, [req.params.id]);

    if (rows.length === 0)
      return res.status(404).json({ error: "Documento no encontrado" });

    const d = rows[0];
    const [contestations] = await pool.query(
      "SELECT * FROM contestations WHERE document_id = ?",
      [req.params.id]
    );

    res.json({
      id: d.id,
      title: d.title,
      trarniteNumber: d.trarnite_number,
      company: d.company_name || d.company_id,
      authority: d.authority,
      department: d.department,
      notificationDate: d.notification_date?.toISOString().split('T')[0],
      daysLimit: d.days_limit,
      dayType: d.day_type,
      dueDate: d.due_date?.toISOString().split('T')[0],
      status: d.status,
      summaryEs: d.summary_es,
      summaryCn: d.summary_cn,
      fileName: d.file_name,
      createdBy: d.created_by_name || d.created_by,
      createdAt: d.created_at?.toISOString().split('T')[0],
      contestations
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📄 POST crear documento
app.post("/api/documents", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const id = d.id || `d${Date.now()}`;
    await pool.query(`
      INSERT INTO documents 
        (id, title, trarnite_number, company_id, authority, department, 
         notification_date, days_limit, day_type, due_date, status, 
         summary_es, summary_cn, file_name, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, d.title, d.trarniteNumber, d.company, d.authority, d.department,
      d.notificationDate, d.daysLimit, d.dayType, d.dueDate,
      d.status || "Inicializado", d.summaryEs, d.summaryCn,
      d.fileName, req.user.user_id
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
  try {
    await pool.query(`
      UPDATE documents SET
        title = ?, trarnite_number = ?, company_id = ?, authority = ?,
        department = ?, notification_date = ?, days_limit = ?, day_type = ?,
        due_date = ?, status = ?, summary_es = ?, summary_cn = ?,
        file_name = ?, last_edited_by = ?, last_edited_at = NOW()
      WHERE id = ?
    `, [
      d.title, d.trarniteNumber, d.company, d.authority,
      d.department, d.notificationDate, d.daysLimit, d.dayType,
      d.dueDate, d.status, d.summaryEs, d.summaryCn,
      d.fileName, req.user.user_id, req.params.id
    ]);
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

// 📋 GET actividades por documento
app.get("/api/activities", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, d.title as doc_title 
      FROM activities a
      LEFT JOIN documents d ON a.document_id = d.id
      ORDER BY a.due_date ASC
    `);
    res.json(rows.map(a => ({
      id: a.id,
      docId: a.document_id,
      docTitle: a.doc_title,
      description: a.description,
      subDescription: a.sub_description,
      dueDate: a.due_date?.toISOString().split('T')[0],
      status: a.status,
      priority: a.priority,
      completedBy: a.completed_by,
      completedAt: a.completed_at
    })));
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


// 🤖 Endpoint de análisis con IA (Gemini)
app.post("/api/analyze", requireAuth, async (req, res) => {
  const { fileData, mimeType } = req.body;
  if (!fileData) return res.status(400).json({ error: "fileData requerido" });

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
                text: `Analiza este documento tributario/legal ecuatoriano y extrae la información en formato JSON exacto sin markdown:
{
  "authority": "entidad que emite el documento (ej: SRI, SENAE)",
  "department": "departamento o dirección específica",
  "company": "empresa destinataria (ej: ECSA, EXSA)",
  "notificationDate": "fecha de notificación en formato YYYY-MM-DD",
  "emissionDate": "fecha de emisión en formato YYYY-MM-DD",
  "daysLimit": número de días para responder (integer),
  "dayType": "Días hábiles o Días calendario",
  "trarniteNumber": "número de trámite o expediente",
  "title": "título descriptivo del documento en español",
  "summaryEs": "resumen detallado en español de 3-5 párrafos explicando el contenido, requerimientos y plazos",
  "summaryCn": "resumen detallado en chino mandarín de 3-5 párrafos",
  "activities": ["lista de actividades o acciones requeridas"]
}`
              }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
        })
      }
    );

    if (!geminiRes.ok) {
      const errData = await geminiRes.json();
      throw new Error(errData.error?.message || "Error en Gemini API");
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);

  } catch (error) {
    console.error("Analyze error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 🔟 Arrancar servidor
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ TaxControl-Api escuchando en puerto ${PORT}`);
});
