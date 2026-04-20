import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Pool de conexión MariaDB
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
});

/**
 * Health check (para frontend y Coolify)
 */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Prueba real contra MariaDB
 */
app.get("/api/db-test", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT VERSION() AS version");
    res.json({
      status: "connected",
      mariadb: rows[0].version,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database connection failed" });
  }
});

/**
 * EJEMPLO de endpoint (se adapta a db.sql)
 * ESTE ES EL QUE CAMBIAREMOS CON TU db.sql
 */
app.get("/api/example", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS example");
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Query error" });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ TaxControl API running on port ${PORT}`);
});
