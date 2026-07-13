# Cloudflare Pages 接入指南 · 仙人森林

本站已从 Netlify 迁移到 **Cloudflare Pages**。产品数据由飞书表格实时供给，
询盘表单直接写回飞书表格——**改产品、收询盘都不再触发网站重建，永久 0 额度**。

---

## 一、在 Cloudflare 建站点

1. 登录 https://dash.cloudflare.com → 左侧 **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**。
2. 选你的 GitHub 仓库 `gedo1018/immortal-forest-site`。
3. 构建设置保持默认：
   - **Framework preset**：`None`
   - **Build command**：留空
   - **Build output directory**：`/`（根目录）
4. 点 **Save and Deploy**。

> Cloudflare 会自动识别仓库根目录的 `functions/` 文件夹，把 `products.js` /
> `contact.js` 部署成无服务器函数 `/api/products` 和 `/api/contact`。

---

## 二、配置环境变量（关键）

站点建好后 → **Settings → Environment variables**，添加以下变量
（**Production** 和 **Preview** 都建议加）：

| 变量名 | 说明 | 来自 |
|--------|------|------|
| `FEISHU_APP_ID` | 飞书自建应用 App ID | 开放平台「凭证与基础信息」 |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret | 同上 |
| `FEISHU_SPREADSHEET_TOKEN` | 产品表 Token（URL 里 `sheets/` 后那串） | 你的飞书表格地址栏 |
| `FEISHU_SHEET_RANGE` | 读取区间，如 `Sheet1!A1:K200` | 你的产品表（sheet 名!起止列） |
| `SITE_URL` | 站点网址，如 `https://immortal-forest.pages.dev` | 建站后 Cloudflare 给的域名 |
| `FEISHU_INQUIRY_TOKEN` | 询盘表 Token（可选，见下） | 新建的询盘表地址栏 |
| `FEISHU_INQUIRY_RANGE` | 询盘表追加区间，如 `询盘!A1:G1` | 见下 |

加完后 **重新部署一次**（Deployments → 最新一条 → Retry / 或推一次代码）。

---

## 三、产品表（已在飞书，需确认）

你之前已建好 `仙人森林产品库.csv` 并导入了模板。核对两件事：

1. **应用已加为协作者（可阅读）**：表格右上角「分享 → 添加协作者」搜你建的应用名，
   权限「可阅读」。
2. **区间对得上**：`FEISHU_SHEET_RANGE` 要覆盖所有产品行。模板 9 行 + 预留，
   填 `Sheet1!A1:K200` 足够（sheet 名以你实际为准，看地址栏 `sheet=` 后面那段）。

表头（中文）：分类 / 图片 / 中文名 / 中文描述 / 中文价 / 英文名 / 英文描述 / 英文价 /
MOQ / 交期 / 贸易术语。脚本会自动识别这些列（中英文列名都认）。

---

## 四、询盘表（收客户留言，可选但建议做）

1. 在飞书**新建一个电子表格**「仙人森林询盘」，第一行写表头：
   `时间 | 姓名 | 公司/国家 | 邮箱 | 类型 | 需求 | IP`
2. 把这个新表也**共享给应用**，权限 **「可编辑」**（因为要追加行）。
3. 去飞书开放平台给应用**加权限** `sheets:spreadsheet:write`（之前只开了 readonly），
   重新**发布**应用版本。
4. 把新表 Token 和区间填进 `FEISHU_INQUIRY_TOKEN` / `FEISHU_INQUIRY_RANGE`。

> 没配询盘表也没关系：表单照样提示"已收到"，只是留言不会进飞书（不会丢客户，
> 只是你暂时看不到）。配好后会自动入库。

---

## 五、验证

部署成功后，浏览器打开：

- `https://你的域名/api/products` → 应返回一串 JSON（含你的产品）
- 联系页填表提交 → 提示"已收到"；若配了询盘表，飞书表格会自动新增一行

如果 `/api/products` 返回空或报错，多半是环境变量填错或飞书协作者没加好——
检查 **Step 二、三、四** 三项，再重试部署。

---

## 六、日常使用

- **改产品**：直接改飞书产品表 → 最多 60 秒后网站自动更新（函数有 60s 边缘缓存）。
- **看询盘**：飞书询盘表实时新增。
- **改网站代码**（HTML/CSS/JS）：推 GitHub → Cloudflare 自动重新部署（这才会消耗少量构建，
  但 Cloudflare 免费档额度充足，不像 Netlify 按部署计费）。
- 域名、HTTPS、DDoS 防护 Cloudflare 自动白送。

---

## 七、回滚

代码全在 GitHub。若 Cloudflare 出问题，回退到上一个 commit 即可；
旧 Netlify 站（额度耗尽）可保留作备份，不影响 Cloudflare。
