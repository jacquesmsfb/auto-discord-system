const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// create database file
const db = new sqlite3.Database(path.resolve(__dirname, "bot.db"));

// create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      last_order_time TEXT,
      warranty_active INTEGER DEFAULT 0,
      replacements_used INTEGER DEFAULT 0
    )
  `);
});

module.exports = db;