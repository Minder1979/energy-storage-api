const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const scrapeBiddingData = require('./scrapers/run');

const app = express();
const PORT = process.env.PORT || 3000;
const SCRAPE_SECRET = process.env.SCRAPE_SECRET || 'my-secret-key';
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());

// ─── 数据读写 ───────────────────────────────────────────────
function getLocalData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

// ─── 路由 ───────────────────────────────────────────────────

// GET /api/full  — 获取所有周期数据
app.get('/api/full', (req, res) => {
  const data = getLocalData();
  res.json({
    week: data.week || {},
    month: data.month || {},
    year: data.year || {},
    _meta: data._meta || {}
  });
});

// GET /api/summary  — 统计摘要
app.get('/api/summary', (req, res) => {
  const data = getLocalData();
  const week = data.week || {};
  const month = data.month || week;
  const year = data.year || week;
  res.json({
    total: parseInt(year.hsCount) || 0,
    avgPrice: parseFloat(week.heroVal) || 0.85,
    avgPriceYear: parseFloat(year.heroVal) || 0.87,
    scale: parseFloat(year.hsScale) || 0,
    lastSync: data._meta?.lastSync || null,
  });
});

// GET /api/prices/average?period=week|month|year
app.get('/api/prices/average', (req, res) => {
  const data = getLocalData();
  const period = req.query.period || 'week';
  const periodData = data[period] || data.week || {};
  res.json({
    period,
    value: parseFloat(periodData.heroVal) || 0.85,
    change: periodData.heroChange || '—',
    trend: periodData.heroChangeTrend || 'trending_down',
    data: {
      sys: periodData.sys || [0.85],
      cell: periodData.cell || [0.85],
    },
  });
});

// GET /api/bids?period=week|month|year&sort=price|total&order=asc|desc
app.get('/api/bids', (req, res) => {
  const data = getLocalData();
  const period = req.query.period || 'week';
  const sort = req.query.sort || 'price';
  const order = req.query.order || 'desc';
  const periodData = data[period] || data.week || {};
  let bids = periodData.bids || [];
  // 排序
  bids.sort((a, b) => {
    const va = sort === 'total' ? (a.totalPrice || 0) : (a.avgPrice || 0);
    const vb = sort === 'total' ? (b.totalPrice || 0) : (b.avgPrice || 0);
    return order === 'asc' ? va - vb : vb - va;
  });
  res.json({ period, sort, order, total: bids.length, bids });
});

// GET /api/prices/trend?period=week|month|year
app.get('/api/prices/trend', (req, res) => {
  const data = getLocalData();
  const period = req.query.period || 'month';
  const periodData = data[period] || data.week || {};
  res.json({
    period,
    labels: periodData.chartLabels || [],
    sys: periodData.sys || [],
    cell: periodData.cell || [],
    title: periodData.chartTitle || '',
    sub: periodData.chartSub || '',
  });
});

// POST /api/sync  — 触发抓取（需密钥）
app.post(['/api/sync', '/api/scrape'], async (req, res) => {
  const secret = req.headers['x-scrape-secret'] || req.query.secret;
  if (secret !== SCRAPE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const ok = await scrapeBiddingData();
    const isSync = req.path === '/api/sync';
    res.json({
      success: ok,
      message: ok 
        ? (isSync ? '数据抓取同步完成' : '抓取完成') 
        : (isSync ? '同步失败' : '抓取失败')
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /  — 健康检查
app.get('/', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`储能数据 API 已启动: http://0.0.0.0:${PORT}`);
  console.log(`  GET  /api/summary         — 统计摘要`);
  console.log(`  GET  /api/prices/average  — 均价数据`);
  console.log(`  GET  /api/bids            — 项目列表`);
  console.log(`  GET  /api/prices/trend    — 趋势数据`);
  console.log(`  POST /api/scrape          — 触发抓取 (需 x-scrape-secret)`);
  console.log(`  POST /api/sync            — 触发抓取 (兼容)`);
});
