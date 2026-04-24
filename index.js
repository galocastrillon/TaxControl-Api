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

// 🔟 Arrancar servidor
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ TaxControl-Api escuchando en puerto ${PORT}`);
});
