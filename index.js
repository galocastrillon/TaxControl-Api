import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";

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

// 6️⃣ Arrancar servidor
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ TaxControl-Api escuchando en puerto ${PORT}`);
});
