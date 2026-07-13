# 产品图片目录

本站产品图采用 **方案 A（仓库托管）**：图片作为静态资源随站点一起部署在 Cloudflare Pages，
和 HTML/CSS 同享一张全球 CDN 网，免费、最快、无外部依赖。

## 约定

- 产品图统一放 `images/products/`（通用兜底图 `images/placeholder.svg`）。
- 飞书表格「图片」列填写**相对路径**，例如：
  - `images/products/p02.svg`
  - `images/products/pen.webp`
- `functions/api/products.js` 会自动把以 `images/` 开头的值拼成
  `https://你的站点/images/products/xxx`，无需手写完整网址。
- 想直接贴完整 `https://` 网址也可以（外部图床 / R2），函数会原样透传。

## 真实照片建议

- 格式优先 **WebP / AVIF**，单文件 < 1MB（Cloudflare Pages 单文件上限 25MB，足够）。
- 比例无所谓，前端用 `aspect-ratio:4/3 + object-fit:cover` 统一裁切，不会出现裂图或布局抖动。
- 加载失败时自动回退到品牌渐变占位，卡片永远整洁。

## 占位图（开发期测试用）

`images/products/p01.svg ~ p10.svg` 是品牌风格占位图，由 `scripts/gen_placeholders.py`
生成，用于在没有真实照片时验证图片渲染管线（4:3 比例、悬停微放大、加载兜底）。

线上产品 → 占位图 对照（2026-07-14 清单）：

| 飞书「图片」列填 | 对应产品 | 分类 |
|---|---|---|
| `images/products/p01.svg` | 飞书修改测试2 | 文具纸张 |
| `images/products/p02.svg` | 苔纹再生笔记本 | 文具纸张 |
| `images/products/p03.svg` | 云栖激光打印机 | 办公设备 |
| `images/products/p04.svg` | 雾林投影仪 | 办公设备 |
| `images/products/p05.svg` | 苔原升降桌 | 家具收纳 |
| `images/products/p06.svg` | 叠翠模块化柜 | 家具收纳 |
| `images/products/p07.svg` | 采购 SaaS 后台 | 数字办公 |
| `images/products/p08.svg` | 智能补给机器人 | 数字办公 |
| `images/products/p09.svg` | 森系环保湿巾 | 清洁耗材 |
| `images/products/p10.svg` | test | 测试 |

> 真实照片到位后，把照片放进 `images/products/`（建议用产品拼音/英文 slug 命名，如
> `pen.webp`、`notebook.webp`），再把飞书「图片」列的值改成对应文件名即可，代码无需改动。

## 重新生成占位图

```bash
python scripts/gen_placeholders.py
```
（脚本会尝试从线上 API 读取最新产品清单；不可达时回退到内置清单。）
