'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'energy.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS bids (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    price       REAL,
    price_unit  TEXT,
    capacity    TEXT,
    company     TEXT,
    region      TEXT,
    pub_date    TEXT,
    source      TEXT    NOT NULL,
    source_url  TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS crawl_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT    NOT NULL,
    status      TEXT    NOT NULL,
    items_count INTEGER DEFAULT 0,
    error_msg   TEXT,
    started_at  TEXT    DEFAULT (datetime('now')),
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

async function runAll() {
  const { scrapeSolarbe } = require('./solarbe');
  const { scrapeBjx } = require('./bjx');

  const results = {};

  // ── Solarbe ───────────────────────────────────────────────────────────────
  {
    const logId = db.prepare(
      "INSERT INTO crawl_log (source, status, started_at) VALUES ('solarbe','running',datetime('now'))"
    ).run();
    const logStmt = db.prepare("UPDATE crawl_log SET status=?,items_count=?,finished_at=datetime('now'),error_msg=? WHERE id=?");
    try {
      const items = await scrapeSolarbe(5);
      const inserted = insertItems(items);
      logStmt.run('success', inserted, null, logId.lastInsertRowid);
      results.solarbe = { scraped: items.length, inserted };
    } catch (e) {
      logStmt.run('error', 0, e.message, logId.lastInsertRowid);
      results.solarbe = { error: e.message };
    }
  }

  // ── BJX ───────────────────────────────────────────────────────────────────
  {
    const logId = db.prepare(
      "INSERT INTO crawl_log (source, status, started_at) VALUES ('bjx','running',datetime('now'))"
    ).run();
    const logStmt = db.prepare("UPDATE crawl_log SET status=?,items_count=?,finished_at=datetime('now'),error_msg=? WHERE id=?");
    try {
      const items = await scrapeBjx(5);
      const inserted = insertItems(items);
      logStmt.run('success', inserted, null, logId.lastInsertRowid);
      results.bjx = { scraped: items.length, inserted };
    } catch (e) {
      logStmt.run('error', 0, e.message, logId.lastInsertRowid);
      results.bjx = { error: e.message };
    }
  }

  // 更新 meta
  db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('last_scrape',datetime('now'))").run();

  console.log('✅ Scrape complete:', results);
  return results;
}

function insertItems(items) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO bids (title, price, price_unit, capacity, company, region, pub_date, source, source_url)
    VALUES (@title, @price, @price_unit, @capacity, @company, @region, @pub_date, @source, @source_url)
  `);
  let count = 0;
  for (const item of items) {
    const r = insert.run(item);
    if (r.changes > 0) count++;
  }
  return count;
}

// Run if called directly
if (require.main === module) {
  runAll().then(r => { console.log(r); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runAll };
