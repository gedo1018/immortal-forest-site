// =========================================================
//  仙人森林 · IMMORTAL FOREST — Cloudflare Pages Function
//  GET /api/products  ->  { products: [...] }
//
//  Reads the Feishu (Lark) spreadsheet in real time, transforms
//  it into the site's product shape, and returns JSON.
//  - CDN cached 60s to spare Feishu API calls
//  - Falls back to the committed /products.json when Feishu
//    creds are missing or the API fails (site never breaks)
// =========================================================

const API_BASE = "https://open.feishu.cn";

// Canonical field -> header synonyms (Chinese or English). First match wins.
const FIELDS = ["cat", "cat_zh", "cat_en", "img", "zh_name", "zh_desc", "zh_price",
                "en_name", "en_desc", "en_price", "moq", "lead", "term"];

const SYNONYMS = {
  cat:      ["cat", "分类", "类别", "category", "类型"],
  cat_zh:   ["cat_zh", "cat zh", "中文分类", "分类(中)", "分类（中）"],
  cat_en:   ["cat_en", "cat en", "英文分类", "分类(英)", "分类（英）"],
  img:      ["img", "image", "图片", "图", "产品图"],
  zh_name:  ["zh_name", "zh name", "中文名", "中文名称", "名称(中)", "名称（中）"],
  zh_desc:  ["zh_desc", "中文描述", "描述(中)", "描述（中）"],
  zh_price: ["zh_price", "中文价", "价格(中)", "单价(中)", "中文价格"],
  en_name:  ["en_name", "en name", "英文名", "英文名称", "名称(英)", "名称（英）"],
  en_desc:  ["en_desc", "英文描述", "描述(英)", "描述（英）"],
  en_price: ["en_price", "英文价", "价格(英)", "单价(英)", "英文价格"],
  moq:      ["moq", "MOQ", "起订量", "最小起订", "最小起订量"],
  lead:     ["lead", "交期", "lead time", "工期", "交货期"],
  term:     ["term", "贸易术语", "贸易条款", "贸易条件", "trade term"],
};

function norm(s) { return (s == null ? "" : String(s)).trim(); }

// ---- Feishu token (cached in module scope; token valid ~2h) ----
let _tokenCache = { token: null, exp: 0 };
async function getToken(appId, appSecret) {
  const now = Date.now();
  if (_tokenCache.token && _tokenCache.exp > now + 60_000) return _tokenCache.token;
  const r = await fetch(API_BASE + "/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error("Feishu token error: " + JSON.stringify(j));
  _tokenCache = { token: j.tenant_access_token, exp: now + 90 * 60 * 1000 };
  return j.tenant_access_token;
}

// Discover the first sheet's id so we don't require the user to paste a
// brittle "sheetId!A1:Z1000" range by hand.
async function getFirstSheetId(token, spreadsheetToken) {
  const url = API_BASE + "/open-apis/sheets/v3/spreadsheets/" +
              spreadsheetToken + "/sheets/query";
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json();
  if (j.code !== 0) throw new Error("Feishu sheets query error: " + JSON.stringify(j));
  const sheets = (j.data && j.data.sheets) || [];
  if (!sheets.length) throw new Error("No sheets found in spreadsheet");
  return sheets[0].sheet_id;
}

async function readRange(token, spreadsheetToken, range) {
  const url = API_BASE + "/open-apis/sheets/v2/spreadsheets/" +
              spreadsheetToken + "/values/" + encodeURIComponent(range);
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json();
  if (j.code !== 0) throw new Error("Feishu read error: " + JSON.stringify(j));
  return j.data.valueRange.values;
}

function mapHeaders(headerRow) {
  const idx = {};
  for (let i = 0; i < headerRow.length; i++) {
    const hn = norm(headerRow[i]).toLowerCase();
    if (!hn) continue;
    for (const key of FIELDS) {
      if (SYNONYMS[key].some(s => s.toLowerCase() === hn)) { idx[key] = i; break; }
    }
  }
  return idx;
}

function buildProducts(values, siteUrl) {
  if (!values || values.length < 2) return [];
  const idx = mapHeaders(values[0]);
  const out = [];
  for (const row of values.slice(1)) {
    if (!row || row.every(c => norm(c) === "")) continue;
    const get = k => {
      const i = idx[k];
      if (i == null || i >= row.length) return "";
      return norm(row[i]);
    };
    let img = get("img");
    if (img && img.startsWith("images/") && siteUrl) img = siteUrl + "/" + img;
    // Category code: explicit 分类 column, else derive a stable slug from bilingual label
    let cat = get("cat");
    if (!cat) {
      cat = (get("cat_en") || get("cat_zh") || "stationery").toString().trim().toLowerCase().replace(/\s+/g, "-");
    }
    out.push({
      cat,
      catLabel: { zh: get("cat_zh"), en: get("cat_en") },
      img,
      zh: { name: get("zh_name"), desc: get("zh_desc"), price: get("zh_price") },
      en: { name: get("en_name"), desc: get("en_desc"), price: get("en_price") },
      spec: { moq: get("moq"), lead: get("lead"), term: get("term") },
    });
  }
  return out;
}

// Serve the committed /products.json when Feishu is unavailable.
async function fallback(context, debug) {
  if (debug) {
    return new Response(JSON.stringify({
      source: "fallback",
      reason: "Feishu env vars missing or read failed — serving bundled /products.json",
    }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
  try {
    const url = new URL("/products.json", context.request.url);
    const r = await context.env.ASSETS.fetch(new Request(url));
    if (r.ok) {
      return new Response(r.body, {
        headers: { "Content-Type": "application/json",
                   "Cache-Control": "public, max-age=3600",
                   "Access-Control-Allow-Origin": "*",
                   "X-Data-Source": "fallback" },
      });
    }
  } catch (e) { /* ASSETS binding unavailable -> empty */ }
  return new Response(JSON.stringify({ products: [] }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
               "X-Data-Source": "fallback" },
  });
}

export async function onRequestGet(context) {
  const { FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_SPREADSHEET_TOKEN,
          FEISHU_SHEET_TOKEN, FEISHU_SHEET_RANGE, SITE_URL } = context.env;

  // Accept either spelling the user may have used.
  const sheetToken = FEISHU_SPREADSHEET_TOKEN || FEISHU_SHEET_TOKEN;
  const isDebug = new URL(context.request.url).searchParams.has("debug");

  // Not configured yet -> use the static bundled data.
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET || !sheetToken) {
    return fallback(context, isDebug);
  }

  try {
    const token = await getToken(FEISHU_APP_ID, FEISHU_APP_SECRET);
    let range = FEISHU_SHEET_RANGE;
    if (!range) {
      const sheetId = await getFirstSheetId(token, sheetToken);
      range = sheetId + "!A1:Z1000";
    }
    const values = await readRange(token, sheetToken, range);
    const products = buildProducts(values, SITE_URL || "");
    if (!products.length) return fallback(context, isDebug);
    if (isDebug) {
      return new Response(JSON.stringify({
        source: "feishu",
        range,
        count: products.length,
        sample: products[0],
      }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    return new Response(JSON.stringify({ products }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, s-maxage=60",
        "Access-Control-Allow-Origin": "*",
        "X-Data-Source": "feishu",
      },
    });
  } catch (e) {
    // Feishu API hiccup -> degrade gracefully, never break the storefront.
    if (isDebug) {
      return new Response(JSON.stringify({
        source: "fallback",
        reason: "Feishu read failed",
        error: String(e && e.message ? e.message : e),
      }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    return fallback(context, false);
  }
}

// Export for local unit testing (Cloudflare only calls onRequestGet).
export { buildProducts, mapHeaders, norm };
