// =========================================================
//  仙人森林 · IMMORTAL FOREST — shared Feishu helpers
//  Imported by contact.js and feishu-callback.js.
//  Files prefixed with "_" are NOT deployed as routes in
//  Cloudflare Pages Functions — they are modules only.
// =========================================================

const API_BASE = "https://open.feishu.cn";

let _tokenCache = { token: null, exp: 0 };
export async function getToken(appId, appSecret) {
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

async function feishuSheetsQuery(token, spreadsheetToken) {
  const r = await fetch(API_BASE + "/open-apis/sheets/v3/spreadsheets/" + spreadsheetToken + "/sheets/query", {
    headers: { Authorization: "Bearer " + token },
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error("sheets query: " + JSON.stringify(j));
  return (j.data && j.data.sheets) || [];
}

export async function getSheetIdByName(token, spreadsheetToken, name) {
  const sheets = await feishuSheetsQuery(token, spreadsheetToken);
  for (const s of sheets) if (s.title === name) return s.sheetId;
  return null;
}

// Resolve the 询盘 sheet WITHOUT creating it (the callback must not create).
export async function resolveInquirySheet(env) {
  const appId = env.FEISHU_APP_ID, appSecret = env.FEISHU_APP_SECRET;
  const spreadsheetToken = env.FEISHU_INQUIRY_TOKEN || env.FEISHU_SPREADSHEET_TOKEN || env.FEISHU_SHEET_TOKEN;
  const sheetName = env.FEISHU_INQUIRY_SHEET_NAME || "询盘";
  if (!appId || !appSecret || !spreadsheetToken) return null;
  const token = await getToken(appId, appSecret);
  const sheetId = await getSheetIdByName(token, spreadsheetToken, sheetName);
  if (!sheetId) return null;
  return { spreadsheetToken, sheetId, sheetName };
}

export async function readValues(token, spreadsheetToken, range) {
  const r = await fetch(API_BASE + "/open-apis/sheets/v2/spreadsheets/" + spreadsheetToken +
    "/values/" + encodeURIComponent(range), { headers: { Authorization: "Bearer " + token } });
  const j = await r.json();
  if (j.code !== 0) throw new Error("read values: " + JSON.stringify(j));
  return (j.data && j.data.valueRange && j.data.valueRange.values) || [];
}

export async function writeValues(token, spreadsheetToken, range, values) {
  const r = await fetch(API_BASE + "/open-apis/sheets/v2/spreadsheets/" + spreadsheetToken + "/values", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ valueRange: { range, values } }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error("write values: " + JSON.stringify(j));
  return j;
}

// Next sequential 序号 = (max existing 序号) + 1.
export async function getNextSeq(env) {
  const info = await resolveInquirySheet(env);
  if (!info) return 1;
  const token = await getToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
  const vals = await readValues(token, info.spreadsheetToken, info.sheetId + "!A1:A1000");
  let max = 0;
  for (const row of vals) {
    const n = parseInt(row && row[0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

// Canonical follow-up statuses (Chinese keys; English aliases below).
export const STATUS_MAP = {
  "新": "新", "待跟进": "待跟进",
  "已对接": "已对接", "对接": "已对接", "联系中": "已对接",
  "跟进中": "跟进中", "处理中": "跟进中",
  "已报价": "已报价", "报价": "已报价",
  "完成": "完成", "搞定": "完成", "已完": "完成", "done": "完成",
  "成交": "成交", "成单": "成交", "下单": "成交",
  "流失": "流失", "放弃": "流失", "没戏": "流失", "不成": "流失",
  "忽略": "忽略", "暂不": "忽略", "搁置": "忽略",
};

export function normalizeStatus(word) {
  if (!word) return null;
  const w = word.trim();
  return STATUS_MAP[w.toLowerCase()] || STATUS_MAP[w] || null;
}

// Format a Date in Asia/Shanghai (UTC+8) deterministically.
export function bjParts(d) {
  const f = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return {
    date: p.year + "-" + p.month + "-" + p.day,
    time: p.hour + ":" + p.minute,
    dt: p.month + "-" + p.day + " " + p.hour + ":" + p.minute,
  };
}
