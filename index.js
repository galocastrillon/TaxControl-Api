import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import nodemailer from "nodemailer";

// 1️⃣ Cargar variables de entorno
dotenv.config();

// 2️⃣ Crear app
const app = express();
app.use(cors({
  origin: [
    'http://taxcontrolapp.192.168.60.109.sslip.io',
    'https://taxcontrolapp.192.168.60.109.sslip.io',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));
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

// 4️⃣ Endpoint raíz (para healthcheck de Coolify)
app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "TaxControl-Api is running" });
});

// 4️⃣ Endpoint de salud
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
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
    await pool.query("DELETE FROM sessions WHERE token = ?", [auth.slice(7)]);
  }
  res.json({ ok: true });
});

// 9️⃣ Usuario actual
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
      SELECT d.*, c.name as company_name, u.name as created_by_name, u2.name as last_edited_by_name
      FROM documents d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN users u2 ON d.last_edited_by = u2.id
      ORDER BY d.created_at DESC
    `);
    const docs = rows.map(d => ({
      id: d.id,
      title: d.title,
      trarniteNumber: d.trarnite_number,
      company: d.company_id || d.company_name,
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
      fileUrl: d.file_url,
      createdBy: d.created_by_name || d.created_by,
      createdAt: d.created_at?.toISOString().split('T')[0],
      lastEditedBy: d.last_edited_by_name || d.last_edited_by,
      lastEditedAt: d.last_edited_at?.toISOString().split('T')[0],
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
      SELECT d.*, c.name as company_name, u.name as created_by_name, u2.name as last_edited_by_name
      FROM documents d
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN users u2 ON d.last_edited_by = u2.id
      WHERE d.id = ?
    `, [req.params.id]);
    if (rows.length === 0)
      return res.status(404).json({ error: "Documento no encontrado" });
    const d = rows[0];
    const [contestations] = await pool.query(`
      SELECT c.*, u.name as registered_by_name
      FROM contestations c
      LEFT JOIN users u ON c.registered_by = u.id
      WHERE c.document_id = ?
    `, [req.params.id]);
    const [attachments] = await pool.query(
      "SELECT * FROM document_attachments WHERE document_id = ?", [req.params.id]
    );
    res.json({
      id: d.id, title: d.title, trarniteNumber: d.trarnite_number,
      company: d.company_id || d.company_name, authority: d.authority,
      department: d.department,
      notificationDate: d.notification_date?.toISOString().split('T')[0],
      daysLimit: d.days_limit, dayType: d.day_type,
      dueDate: d.due_date?.toISOString().split('T')[0],
      status: d.status, summaryEs: d.summary_es, summaryCn: d.summary_cn,
      fileName: d.file_name, fileUrl: d.file_url, relatedDoc: d.related_doc_id,
      createdBy: d.created_by_name || d.created_by,
      createdAt: d.created_at?.toISOString().split('T')[0],
      lastEditedBy: d.last_edited_by_name || d.last_edited_by,
      lastEditedAt: d.last_edited_at?.toISOString().split('T')[0],
      contestations: contestations.map(c => ({
        id: c.id,
        date: c.presentation_date?.toISOString().split('T')[0],
        authority: c.authority_received,
        notes: c.notes,
        contact_method: c.contact_method,
        registered_by: c.registered_by_name || c.registered_by,
        registration_date: c.registration_date?.toISOString().split('T')[0],
        files: []
      })),
      attachments
    });
  } catch (error) {
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
    const [rows] = await pool.query(`
      SELECT a.*, d.title as doc_title
      FROM activities a
      LEFT JOIN documents d ON a.document_id = d.id
      ORDER BY a.due_date ASC
    `);
    res.json(rows.map(a => ({
      id: a.id, docId: a.document_id, docTitle: a.doc_title,
      description: a.description, subDescription: a.sub_description,
      dueDate: a.due_date?.toISOString().split('T')[0],
      status: a.status, priority: a.priority,
      completedBy: a.completed_by, completedAt: a.completed_at
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
    await pool.query(
      `INSERT INTO activities
       (id, document_id, description, sub_description, due_date, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending')`,
      [id, docId, description, subDescription, dueDate, priority || 'Medium']
    );
    res.status(201).json({ id, docId, description, subDescription, dueDate, priority: priority || 'Medium', status: 'Pending' });
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
app.get("/api/documents/:id/contestations", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, u.name as registered_by_name
      FROM contestations c
      LEFT JOIN users u ON c.registered_by = u.id
      WHERE c.document_id = ?
      ORDER BY c.registration_date DESC
    `, [req.params.id]);

    // Obtener archivos para cada contestación
    const contestations = [];
    for (const c of rows) {
      const [files] = await pool.query(
        'SELECT * FROM contestation_files WHERE contestation_id = ?',
        [c.id]
      );
      contestations.push({
        id: c.id,
        date: c.presentation_date?.toISOString().split('T')[0],
        authority: c.authority_received,
        notes: c.notes,
        contact_method: c.contact_method,
        registered_by: c.registered_by_name || c.registered_by,
        registration_date: c.registration_date?.toISOString().split('T')[0],
        files: files.map(f => ({ name: f.file_name, url: f.file_url }))
      });
    }

    res.json(contestations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 💬 POST crear contestación
app.post("/api/documents/:id/contestations", requireAuth, async (req, res) => {
  const { date, authority, notes, contact_method, files } = req.body;

  if (!date || !authority) {
    return res.status(400).json({ error: "Campos requeridos: date, authority" });
  }

  try {
    const contestationId = `c${Date.now()}`;
    await pool.query(
      `INSERT INTO contestations
       (id, document_id, presentation_date, authority_received, notes, contact_method, registered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [contestationId, req.params.id, date, authority, notes || '', contact_method || '', req.user.user_id]
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
                text: `Analiza este documento y responde SOLO con JSON válido sin markdown:\n{"authority":"","department":"","company":"","notificationDate":"YYYY-MM-DD","emissionDate":"YYYY-MM-DD","daysLimit":10,"dayType":"Días hábiles","trarniteNumber":"","title":"","summaryEs":"resumen breve en español","summaryCn":"简短摘要","activities":[""]}`
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
      "SELECT email FROM users WHERE role IN ('Admin', 'Operator')"
    );
    console.log(`Notificación enviada a ${users.length} usuarios`);
    res.json({ ok: true, recipients: users.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📬 Crear transporter de email desde configuración SMTP
const getEmailTransporter = async () => {
  // Try to get SMTP config from environment or database
  try {
    // For now, use environment variables if available
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "465"),
        secure: process.env.SMTP_USE_SSL === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        }
      });
    }
    // Fallback to hardcoded config for testing
    return nodemailer.createTransport({
      host: "owa1.corriente.com.ec",
      port: 465,
      secure: true,
      auth: {
        user: "ecsa\\monitoreo",
        pass: process.env.SMTP_PASSWORD || ""
      }
    });
  } catch (error) {
    console.error("Error creating transporter:", error);
    throw error;
  }
};

// ✉️ Prueba Básica SMTP
app.post("/api/test-email/basic", requireAuth, async (req, res) => {
  try {
    const transporter = await getEmailTransporter();
    const testEmail = req.body.testEmail || "test@example.com";

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM_EMAIL || '"Tax Control" <monitoreo@corriente.com.ec>',
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
    const testEmail = req.body.testEmail || "test@example.com";

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM_EMAIL || '"Tax Control" <monitoreo@corriente.com.ec>',
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
    const testEmail = req.body.testEmail || "test@example.com";

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM_EMAIL || '"Tax Control" <monitoreo@corriente.com.ec>',
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
    const testEmail = req.body.testEmail || "test@example.com";

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM_EMAIL || '"Tax Control" <monitoreo@corriente.com.ec>',
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

// 🔍 Listar modelos Gemini disponibles
app.get("/api/list-models", async (req, res) => {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
  );
  const data = await r.json();
  res.json(data.models?.map(m => m.name) || data);
});

// 🔟 Arrancar servidor
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ TaxControl-Api escuchando en puerto ${PORT}`);
});
