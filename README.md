# Daily Tech Archive

一个可部署到 Vercel 的科技日报归档站。

n8n 每天生成科技新闻和 GitHub 热点后，把 Markdown 与 JSON 保存到 `daily-tech/`。Vercel 连接这个仓库后，每次推送到 `main` 都会自动重新部署，线上页面会展示最新归档。

## 本地运行

```bash
npm install
npm run dev
```

## Vercel 部署

1. 在 Vercel 中点击 `New Project`。
2. 选择这个 GitHub 仓库。
3. Framework Preset 选择 `Next.js`。
4. Root Directory 保持仓库根目录。
5. 点击 `Deploy`。

首次连接完成后，后续 n8n 每天提交新的 `daily-tech/YYYY-MM-DD.json` 和 `daily-tech/YYYY-MM-DD.md`，Vercel 会自动触发生产部署。

## n8n 归档约定

日报 JSON 文件路径：

```txt
daily-tech/YYYY-MM-DD.json
```

日报 Markdown 文件路径：

```txt
daily-tech/YYYY-MM-DD.md
```

JSON 字段见 `lib/reports.ts` 中的 `DailyReport` 类型。
