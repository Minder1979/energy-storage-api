# 储能中标价格 API 服务

> Node.js + Express 后端，自动从碳索储能网和北极星储能网抓取储能中标数据，提供均价/项目列表/趋势 API。

## 本地运行

```bash
cd energy-storage-api
npm install

# 手动抓取一次数据
node scrapers/run.js

# 启动 API 服务
node server.js
```

## 部署到 Railway（免费）

### 1. 创建 Git 仓库
```bash
cd energy-storage-api
git init
git add .
git commit -m "init"
```

### 2. 推送到 GitHub
在 GitHub 上创建一个新仓库（如 `energy-storage-api`），然后：
```bash
git remote add origin https://github.com/<your-username>/energy-storage-api.git
git push -u origin main
```

### 3. 部署到 Railway
1. 访问 [railway.app](https://railway.app)，用 GitHub 登录
2. 点击 **New Project → Deploy from GitHub Repo**
3. 选择 `energy-storage-api` 仓库
4. Railway 会自动检测 Node.js 并部署

### 4. 配置环境变量
在 Railway 项目设置中添加：
- `SCRAPE_SECRET` = 你的密钥（如 `abc123`）
- `DATABASE_PATH` = `/data/energy.db`

### 5. 首次抓取数据
Railway 部署完成后，手动触发一次抓取：
```bash
curl -X POST https://<your-app>.railway.app/api/scrape \
  -H "x-scrape-secret: abc123"
```

## API 接口

| 接口 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET /api/prices/average?period=week` | 获取均价（week/month/year） |
| `GET /api/bids?period=week&sort=price&order=desc` | 项目列表（支持排序） |
| `GET /api/prices/trend?period=month` | 趋势数据 |
| `GET /api/summary` | 统计摘要 |
| `POST /api/scrape` | 手动触发抓取（需密钥） |

## 定时任务

Docker 镜像内置 crond，每天 UTC 06:00（北京时间 14:00）自动抓取一次。

如需手动设置 Railway 定时任务：
1. Railway 项目 → **Triggers** → **New Trigger**
2. 设置 Cron 表达式：`0 6 * * *`（每天 UTC 06:00）
3. 请求 URL：`https://<your-app>.railway.app/api/scrape`
4. 添加 Header：`x-scrape-secret: abc123`

## App 对接

部署完成后，将 App 的数据源改为你的 Railway URL：

```
https://<your-app>.railway.app/api/prices/average?period=week
```
