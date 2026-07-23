// Simple generic REST backend replacing Firestore, backed by MySQL.
// Run with: node server.js   (after `npm install` and creating a .env file, see .env.example)

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "byqpro",
  waitForConnections: true,
  connectionLimit: 10,
});

// Tables whose rows map directly to normal SQL columns (fields === column names)
const PLAIN_TABLES = new Set([
  "poNos", "equipments", "partNames", "drawingNumbers",
  "sections", "thicknesses", "lengths", "widths",
  "sectionSizeRelations", "sectionSizeLengthRelations",
  "sectionSizeWidthRelations", "sectionSectionalWeights",
]);


// mysql2 auto-parses JSON columns into objects already; this only
// re-parses if it ever comes back as a raw string (some driver configs do).
function parseJsonField(value) {
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function isValidTable(name) {
  return PLAIN_TABLES.has(name) || name === "entries";
}

// ─── GET all rows in a collection ───────────────────────────────────────────
app.get("/api/:collection", async (req, res) => {
  const { collection } = req.params;
  if (!isValidTable(collection)) return res.status(404).json({ error: "Unknown collection" });
  try {
    if (collection === "entries") {
      const [rows] = await pool.query("SELECT id, data, createdAt FROM entries");
      const docs = rows.map((r) => ({
        id: String(r.id),
        ...parseJsonField(r.data),
        createdAt: r.createdAt,
      }));
      return res.json(docs);
    }
    const [rows] = await pool.query(`SELECT * FROM \`${collection}\``);
    const docs = rows.map((r) => ({ ...r, id: String(r.id) }));
    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── GET a single doc ────────────────────────────────────────────────────────
app.get("/api/:collection/:id", async (req, res) => {
  const { collection, id } = req.params;
  if (!isValidTable(collection)) return res.status(404).json({ error: "Unknown collection" });
  try {
    if (collection === "entries") {
      const [rows] = await pool.query("SELECT id, data, createdAt FROM entries WHERE id = ?", [id]);
      if (!rows.length) return res.json(null);
      return res.json({ id: String(rows[0].id), ...parseJsonField(rows[0].data), createdAt: rows[0].createdAt });
    }
    const [rows] = await pool.query(`SELECT * FROM \`${collection}\` WHERE id = ?`, [id]);
    if (!rows.length) return res.json(null);
    res.json({ ...rows[0], id: String(rows[0].id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── POST (add a new doc) ────────────────────────────────────────────────────
app.post("/api/:collection", async (req, res) => {
  const { collection } = req.params;
  if (!isValidTable(collection)) return res.status(404).json({ error: "Unknown collection" });
  try {
    const body = req.body || {};
    if (collection === "entries") {
      const { createdAt, ...rest } = body;
      const [result] = await pool.query(
        "INSERT INTO entries (data, createdAt) VALUES (?, ?)",
        [JSON.stringify(rest), createdAt ? new Date(createdAt) : new Date()]
      );
      return res.json({ id: String(result.insertId) });
    }
    const keys = Object.keys(body);
    if (!keys.length) return res.status(400).json({ error: "Empty body" });
    const cols = keys.map((k) => `\`${k}\``).join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((k) => body[k]);
    const [result] = await pool.query(
      `INSERT INTO \`${collection}\` (${cols}) VALUES (${placeholders})`,
      values
    );
    res.json({ id: String(result.insertId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── PUT (update / merge a doc) ──────────────────────────────────────────────
app.put("/api/:collection/:id", async (req, res) => {
  const { collection, id } = req.params;
  if (!isValidTable(collection)) return res.status(404).json({ error: "Unknown collection" });
  try {
    const body = req.body || {};
    if (collection === "entries") {
      const [rows] = await pool.query("SELECT data FROM entries WHERE id = ?", [id]);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const merged = { ...parseJsonField(rows[0].data), ...body };
      await pool.query("UPDATE entries SET data = ? WHERE id = ?", [JSON.stringify(merged), id]);
      return res.json({ ok: true });
    }
    const keys = Object.keys(body);
    if (!keys.length) return res.json({ ok: true });
    const setClause = keys.map((k) => `\`${k}\` = ?`).join(", ");
    const values = keys.map((k) => body[k]);
    await pool.query(`UPDATE \`${collection}\` SET ${setClause} WHERE id = ?`, [...values, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


app.delete("/api/:collection/:id", async (req, res) => {
  const { collection, id } = req.params;
  if (!isValidTable(collection)) return res.status(404).json({ error: "Unknown collection" });
  try {
    await pool.query(`DELETE FROM \`${collection}\` WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/", (req, res) => res.send("byqpro backend is running"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));