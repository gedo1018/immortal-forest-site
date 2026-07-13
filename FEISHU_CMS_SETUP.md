# 仙人森林 · 飞书表格后台 配置指南

把产品数据从「Decap 后台」迁到「飞书表格」。你日常只在飞书里改表格；网站在每次部署时自动从飞书拉取最新数据生成 `products.json`。

---

## 一、整体流程

```
你在飞书表格里改产品
        │
        ▼  你点一下「部署钩子」链接（或免费定时任务每 30 分钟自动触发）
Netlify 重新部署
        │
        ▼  构建阶段自动运行：拉飞书表格 → 生成 products.json
网站更新
```

你（非技术）每天只做一件事：**打开飞书表格，改内容，关掉；需要上线时点一下同步链接。** 其余全自动。

---

## 二、一次性设置（只需做一次）

### 第 1 步：在飞书开放平台创建自建应用

1. 打开 https://open.feishu.cn （飞书开放平台），登录你的企业账号。
2. 进入 **开发者后台 → 创建应用 → 企业自建应用**，起个名（如 `仙人森林产品同步`）。
3. 创建后进入应用详情，记下 **App ID** 和 **App Secret**（在「凭证与基础信息」里）。
4. 左侧「权限管理」→ 搜索并开通 **`sheets:spreadsheet:readonly`**（读电子表格，只读即可）。
5. 左侧「版本管理与发布」→ **创建版本 → 填写信息 → 发布**。
   - 发布后，这个应用才有权限访问你企业内的文档。

### 第 2 步：建表格并共享给应用

1. 在飞书里新建一个**电子表格**（不是多维表格），命名为「仙人森林产品库」。
2. 把表头按下方「列说明」填好（或直接导入本项目里的 `docs/feishu_template.csv`）。
3. 点表格右上角 **「...」→ 更多 → 添加文档应用**（或在共享里搜索你刚建的应用名），把应用加进来并给**可读**权限。
4. 打开这个表格，从地址栏复制两样东西：
   - **表格 Token**：URL 里 `sheets/` 后面那一长串，如
     `https://...feishu.cn/sheets/【这就是 token】/???sheet=...`
   - **工作表 ID（sheetId）**：URL 里 `sheet=` 后面的部分，如 `...&sheet=【这就是 sheetId】`

### 第 3 步：把密钥填进 Netlify（不是 GitHub）

1. 打开 Netlify 后台 → 你的站点 `immortal-forest` → **Site settings → Environment variables → Add a variable**。
2. 依次添加（全部填到 Netlify，不要填 GitHub）：

| 变量名 | 值 |
|------|------|
| `FEISHU_APP_ID` | 第 1 步的 App ID |
| `FEISHU_APP_SECRET` | 第 1 步的 App Secret |
| `FEISHU_SPREADSHEET_TOKEN` | 第 2 步的表格 Token |
| `FEISHU_SHEET_RANGE` | 例如 `Sheet1!A1:K1000`（把 `Sheet1` 换成你的工作表名，`K` 是第 11 列） |
| `SITE_URL` | `https://immortal-forest.netlify.app` |

> 工作表名看表格底部标签页的名字；列数 11 列对应 A–K。

### 第 4 步：创建「部署钩子」（用于手动/自动同步）

1. Netlify → **Site settings → Build & deploy → Build hooks → Add build hook**。
2. 起个名（如 `sync-from-feishu`），分支选 `main`，创建。
3. 复制生成的 **URL**（形如 `https://api.netlify.com/build_hooks/xxxx`）。这就是你的「一键同步链接」。

---

## 三、表格列说明（必须一一对应）

第一行是表头，顺序随意，脚本按**列名**匹配（中英文都认）。推荐用中文列名：

| 列名 | 含义 | 示例 | 对应网站字段 |
|------|------|------|------|
| 分类 | 产品类别 key | `stationery` / `device` / `furniture` / `digital` / `consumable` | `cat` |
| 图片 | 图片网址（见第四节） | `https://immortal-forest.netlify.app/images/p1.jpg` | `img` |
| 中文名 | 中文名称 | `森呼吸中性笔` | `zh.name` |
| 中文描述 | 中文简介 | `竹纤笔身、速干墨芯……` | `zh.desc` |
| 中文价 | 中文价格 | `¥ 3.9 / 支` | `zh.price` |
| 英文名 | 英文名称 | `Forest-Breath Gel Pen` | `en.name` |
| 英文描述 | 英文简介 | `Bamboo barrel, quick-dry ink...` | `en.desc` |
| 英文价 | 英文价格 | `from $0.12 / pc` | `en.price` |
| MOQ | 最小起订量 | `5,000 pcs` | `spec.moq` |
| 交期 | 交货周期 | `7–15 days` | `spec.lead` |
| 贸易术语 | 贸易条款 | `FOB Shanghai` | `spec.term` |

- 留空的单元格 = 空字符串（网站会自动用图标占位代替缺图）。
- 新增产品：在表格末尾加一行。删除：删掉那一行。调整顺序：直接拖行。

---

## 四、图片怎么放（免费方案：存 GitHub 仓库）

图片**不进飞书**，只把「网址」填进「图片」列。免费且最快的做法：

1. 在你的 GitHub 仓库里，进 `images/` 文件夹（没有就新建），点 **Add file → Upload files** 把产品图传上去。
2. 传完后，图片的访问网址是：
   `https://immortal-forest.netlify.app/images/你的文件名.jpg`
3. 把这个网址整段复制，粘到飞书表格的「图片」列。

> 图片建议压到每张 100KB 以内（宽 800–1200px 足够），仓库和加载都轻快。

---

## 五、怎么同步 / 验证

- **手动同步（推荐先试）**：浏览器打开第 4 步拿到的「部署钩子」URL，回车 → Netlify 开始部署（几十秒）→ 网站更新。
- **自动同步（每 30 分钟）**：注册免费 https://cron-job.org ，建一个任务，URL 填部署钩子，频率选每 30 分钟，保存。之后改完飞书表格，最多 30 分钟网站自动更新。
- **验证**：打开 `https://immortal-forest.netlify.app/`，看产品是否更新；或看 Netlify 的部署记录是否成功、构建日志里是否有 `OK: wrote N products`。

---

## 六、回滚 / 应急

- 如果飞书表格填错导致网站异常：直接去 GitHub 仓库编辑 `products.json`（或还原历史版本），Netlify 会重新部署。
- 原来的 `/admin/` 后台已不再使用，可忽略；不要两边同时改，以飞书表格为准。
- 若 Netlify 构建日志出现 `WARN: Feishu fetch failed`：通常是飞书密钥填错或表格没共享给应用，按第二、三步复查即可，网站会用旧数据照常运行，不会崩。

---

## 七、常见问题

**Q：同步要花钱吗？**
A：Netlify 部署和飞书自建应用都免费；cron-job.org 基础版也免费。零成本。

**Q：只想自己改，不想让应用有我的文档权限？**
A：应用仅被授权读那一个共享出去的表格，看不到你其他文档，安全可控。

**Q：能多人同时编辑吗？**
A：可以，飞书表格本身支持协作，谁改都行，同步照常。
