'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database Setup ───────────────────────────────────────────────────────────
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'energy.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Initialize tables
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helper ───────────────────────────────────────────────────────────────────
function calcAveragePrice(bids) {
  const prices = bids
    .map(b => b.price)
    .filter(p => p != null && p > 0 && p < 10); // 过滤异常值
  if (!prices.length) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

function filterPeriod(bids, period) {
  const now = new Date();
  return bids.filter(b => {
    if (!b.pub_date) return false;
    const d = new Date(b.pub_date);
    if (period === 'week') {
      const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
      return d >= weekAgo;
    }
    if (period === 'month') {
      const monthAgo = new Date(now); monthAgo.setMonth(now.getMonth() - 1);
      return d >= monthAgo;
    }
    if (period === 'year') {
      const yearAgo = new Date(now); yearAgo.setFullYear(now.getFullYear() - 1);
      return d >= yearAgo;
    }
    return true;
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 获取均价（周/月/年）
app.get('/api/prices/average', (req, res) => {
  const { period = 'week' } = req.query;
  const bids = db.prepare('SELECT * FROM bids ORDER BY pub_date DESC').all();
  const filtered = filterPeriod(bids, period);
  const avg = calcAveragePrice(filtered);
  const count = filtered.length;
  res.json({ period, average: avg, count, unit: '元/Wh' });
});

// 获取项目列表（周/月/年）
app.get('/api/bids', (req, res) => {
  const { period = 'week', sort = 'date', order = 'desc', limit = 50 } = req.query;
  const bids = db.prepare('SELECT * FROM bids ORDER BY pub_date DESC').all();
  let filtered = filterPeriod(bids, period);

  if (sort === 'price') {
    filtered.sort((a, b) => order === 'asc' ? (a.price - b.price) : (b.price - a.price));
  } else {
    filtered.sort((a, b) => order === 'asc'
      ? new Date(a.pub_date) - new Date(b.pub_date)
      : new Date(b.pub_date) - new Date(a.pub_date));
  }

  res.json({ period, total: filtered.length, items: filtered.slice(0, Number(limit)) });
});

// 获取趋势数据
app.get('/api/prices/trend', (req, res) => {
  const { period = 'month' } = req.query;
  const bids = db.prepare('SELECT * FROM bids ORDER BY pub_date ASC').all();

  // 按周或月聚合
  const groups = {};
  bids.forEach(b => {
    if (!b.pub_date) return;
    const d = new Date(b.pub_date);
    let key;
    if (period === 'week') {
      const monday = new Date(d); monday.setDate(d.getDate() - d.getDay() + 1);
      key = monday.toISOString().slice(0, 10);
    } else if (period === 'month') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else {
      key = String(d.getFullYear());
    }
    if (!groups[key]) groups[key] = [];
    if (b.price != null) groups[key].push(b.price);
  });

  const trend = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, prices]) => ({
      label,
      average: calcAveragePrice(prices.map(p => ({ price: p })))
    }))
    .filter(t => t.average != null);

  res.json({ period, trend });
});

// 手动触发抓取（仅在允许时开放）
app.post('/api/scrape', async (req, res) => {
  if (process.env.SCRAPE_SECRET && req.headers['x-scrape-secret'] !== process.env.SCRAPE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { runAll } = require('./scrapers/run');
    const results = await runAll();
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 统计摘要
app.get('/api/summary', (req, res) => {
  const stats = {
    total: db.prepare('SELECT COUNT(*) as c FROM bids').get().c,
    solarbe: db.prepare("SELECT COUNT(*) as c FROM bids WHERE source='solarbe'").get().c,
    bjx: db.prepare("SELECT COUNT(*) as c FROM bids WHERE source='bjx'").get().c,
    lastUpdated: db.prepare("SELECT MAX(finished_at) as t FROM crawl_log WHERE status='success'").get().t
  };
  const periods = ['week', 'month', 'year'];
  stats.averages = {};
  periods.forEach(p => {
    const bids = db.prepare('SELECT * FROM bids ORDER BY pub_date DESC').all();
    const filtered = filterPeriod(bids, p);
    stats.averages[p] = { avg: calcAveragePrice(filtered), count: filtered.length };
  });
  res.json(stats);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`⚡ Energy Storage API running on http://localhost:${PORT}`);
  console.log(`   Database: ${DB_PATH}`);
});
