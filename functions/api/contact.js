// =========================================================
//  仙人森林 · IMMORTAL FOREST — Cloudflare Pages Function
//  POST /api/contact  ->  { ok: true, results: {...} }
//  GET  /api/contact  ->  diagnostic (which channels configured)
//  GET  /api/contact?test=1   -> send a TEST alert per channel + write a test row
//  GET  /api/contact?setup=1  -> create the "询盘" sheet tab (if missing) + write header
//
//  Receives the contact/form inquiry, then:
//   1) pushes a REAL-TIME alert to whichever chat channel is configured
//      (you only need ONE of them):
//        - WECOM_WEBHOOK        企业微信群机器人
//        - SERVERCHAN_KEY       Server酱  -> 个人微信
//        - PUSHPLUS_TOKEN       PushPlus  -> 个人微信
//        - FEISHU_GROUP_WEBHOOK 飞书群机器人 -> 飞书群
//   2) ARCHIVES the row into a Feishu sheet:
//        - auto-creates a "询盘" tab inside the SAME spreadsheet the site
//          already reads (FEISHU_SPREADSHEET_TOKEN), writing a header once;
//        - appends every inquiry as a new row. No extra config required —
//          it reuses the existing Feishu app credentials.
//
//  Diagnostics are returned in the HTTP response (free, no paid
//  Cloudflare Logs needed) so you can verify delivery from the
//  browser Network tab or by opening /api/contact in a browser.
// =========================================================

import { getNextSeq, bjParts, STATUS_KEYWORDS } from "./_feishu.js";

const API_BASE = "https://open.feishu.cn";

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

// ---- push helpers: each returns { ok, error } ----
async function pushWeCom(webhook, text) {
  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content: text } }),
    });
    const j = await r.json();
    if (j.errcode !== 0) return { ok: false, error: JSON.stringify(j) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function pushServerChan(key, title, desp) {
  try {
    const r = await fetch("https://sctapi.ftqq.com/" + key + ".send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "title=" + encodeURIComponent(title) + "&desp=" + encodeURIComponent(desp),
    });
    const j = await r.json();
    if (j.code !== 0) return { ok: false, error: JSON.stringify(j) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function pushPushPlus(token, title, content) {
  try {
    const r = await fetch("https://www.pushplus.plus/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, title, content }),
    });
    const j = await r.json();
    if (j.code !== 200) return { ok: false, error: JSON.stringify(j) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function pushFeishuGroup(webhook, text) {
  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg_type: "text", content: { text } }),
    });
    const j = await r.json();
    if (j.code !== 0 && j.StatusMessage !== "success") return { ok: false, error: JSON.stringify(j) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function mask(s) {
  if (!s) return null;
  if (s.length <= 12) return s;
  return s.slice(0, 12) + "****" + s.slice(-4);
}

// =========================================================
//  Feishu SHEET archive (auto-creates the "询盘" tab)
// =========================================================

// Column layout of the 询盘 sheet. Order: 序号 | 提交时间 | 姓名 | 公司/国家 |
// 邮箱 | 咨询类型 | 留言 | 来源IP | 状态 | 跟进时间 | 跟进结果
const INQUIRY_HEADERS = ["序号", "提交时间", "姓名", "公司/国家", "邮箱", "咨询类型", "留言", "来源IP", "状态", "跟进时间", "跟进结果"];
const INQUIRY_COLS = INQUIRY_HEADERS.length;

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function feishuSheetsQuery(token, spreadsheetToken) {
  const r = await fetch(API_BASE + "/open-apis/sheets/v3/spreadsheets/" + spreadsheetToken + "/sheets/query", {
    headers: { Authorization: "Bearer " + token },
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error("sheets query: " + JSON.stringify(j));
  return (j.data && j.data.sheets) || [];
}

async function getSheetIdByName(token, spreadsheetToken, name) {
  const sheets = await feishuSheetsQuery(token, spreadsheetToken);
  for (const s of sheets) if (s.title === name) return s.sheet_id;
  return null;
}

async function createSheet(token, spreadsheetToken, title) {
  const r = await fetch(API_BASE + "/open-apis/sheets/v2/spreadsheets/" + spreadsheetToken + "/sheets_batch_update", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title, index: 0 } } }] }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error("create sheet: " + JSON.stringify(j));
  return j.data.replies[0].addSheet.properties.sheetId;
}

async function writeValues(token, spreadsheetToken, range, values) {
  const r = await fetch(API_BASE + "/open-apis/sheets/v2/spreadsheets/" + spreadsheetToken + "/values", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ valueRange: { range, values } }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error("write values: " + JSON.stringify(j));
  return j;
}

async function appendValues(token, spreadsheetToken, sheetId, values) {
  // Feishu requires a RANGE (start:end), not a single cell, for append.
  // insertDataOption=INSERT_ROWS guarantees a new row is inserted instead of
  // overwriting existing data when trailing blank rows run out.
  const r = await fetch(API_BASE + "/open-apis/sheets/v2/spreadsheets/" + spreadsheetToken + "/values_append?insertDataOption=INSERT_ROWS", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ valueRange: { range: sheetId + "!A1:Z1000", values } }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error("append values: " + JSON.stringify(j));
  return j;
}

// Returns { spreadsheetToken, sheetId, sheetName, created } or null if unconfigured.
async function ensureInquirySheet(env) {
  const appId = env.FEISHU_APP_ID, appSecret = env.FEISHU_APP_SECRET;
  const spreadsheetToken = env.FEISHU_INQUIRY_TOKEN || env.FEISHU_SPREADSHEET_TOKEN || env.FEISHU_SHEET_TOKEN;
  const sheetName = env.FEISHU_INQUIRY_SHEET_NAME || "询盘";
  if (!appId || !appSecret || !spreadsheetToken) return null;
  const token = await getToken(appId, appSecret);
  let sheetId = await getSheetIdByName(token, spreadsheetToken, sheetName);
  let created = false;
  if (!sheetId) {
    sheetId = await createSheet(token, spreadsheetToken, sheetName);
    created = true;
  }
  // Ensure the header row exists (write once if A1 is empty).
  const headerRange = sheetId + "!A1:" + colLetter(INQUIRY_COLS) + "1";
  try {
    const r = await fetch(API_BASE + "/open-apis/sheets/v2/spreadsheets/" + spreadsheetToken +
      "/values/" + encodeURIComponent(sheetId + "!A1"), { headers: { Authorization: "Bearer " + token } });
    const rj = await r.json();
    const firstRow = (rj.data && rj.data.valueRange && rj.data.valueRange.values && rj.data.valueRange.values[0]) || [];
    if (!firstRow.length || String(firstRow[0]).trim() !== "序号") {
      await writeValues(token, spreadsheetToken, headerRange, [INQUIRY_HEADERS]);
    }
  } catch (e) { /* header best-effort; append still works without it */ }
  return { spreadsheetToken, sheetId, sheetName, created };
}

function buildInquiryRow(seq, time, data, ip) {
  return [
    seq,
    time,
    data.name || "",
    data.company || data.country || "",
    data.email || "",
    data.type || "",
    data.msg || "",
    ip,
    "新", // 状态：待跟进
    "",    // 跟进时间
    "",    // 跟进结果
  ];
}

async function archiveInquiry(env, row) {
  const info = await ensureInquirySheet(env);
  if (!info) return { ok: false, error: "Feishu not configured (need FEISHU_APP_ID/SECRET + spreadsheet token)" };
  try {
    const token = await getToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
    await appendValues(token, info.spreadsheetToken, info.sheetId, [row]);
    return { ok: true, sheet: info.sheetName, created: info.created };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function feishuArchiveConfigured(env) {
  return !!(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET &&
    (env.FEISHU_INQUIRY_TOKEN || env.FEISHU_SPREADSHEET_TOKEN || env.FEISHU_SHEET_TOKEN));
}

// =========================================================
//  Handlers
// =========================================================

export async function onRequestPost(context) {
  const env = context.env;
  const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  let data = {};
  try {
    const form = await context.request.formData();
    for (const [k, v] of form.entries()) data[k] = String(v);
  } catch (e) {
    try { data = await context.request.json(); } catch (_) { /* ignore */ }
  }

  const time = new Date().toISOString();
  const ip = context.request.headers.get("cf-connecting-ip") || "";
  const seq = await getNextSeq(env);
  const row = buildInquiryRow(seq, time, data, ip);

  console.log("Contact submission:", JSON.stringify({ seq, time, ...data, ip }));

  const submit = bjParts(new Date());
  const deadline = bjParts(new Date(Date.now() + 60 * 60 * 1000));
  const title = "【询盘 #" + seq + "】新询盘 · IMMORTAL FOREST";
  const plain = [
    "姓名: " + (data.name || "-"),
    "公司/国家: " + (data.company || data.country || "-"),
    "邮箱: " + (data.email || "-"),
    "类型: " + (data.type || "-"),
    "留言: " + (data.msg || "-"),
    "提交: " + submit.dt,
    "⏰ 请于 " + deadline.time + " 前跟进（1 小时）",
    "—— 处理后回复：@机器人 #" + seq + " 状态 备注(可选)",
    "状态可选：" + STATUS_KEYWORDS.join(" / "),
  ].join("\n");

  const results = {};
  if (env.WECOM_WEBHOOK) results.wecom = await pushWeCom(env.WECOM_WEBHOOK, "🔔 **" + title + "**\n> " + plain.replace(/\n/g, "\n> "));
  if (env.SERVERCHAN_KEY) results.serverchan = await pushServerChan(env.SERVERCHAN_KEY, title, plain);
  if (env.PUSHPLUS_TOKEN) results.pushplus = await pushPushPlus(env.PUSHPLUS_TOKEN, title, plain);
  if (env.FEISHU_GROUP_WEBHOOK) results.feishuGroup = await pushFeishuGroup(env.FEISHU_GROUP_WEBHOOK, title + "\n" + plain);

  // Archive to Feishu sheet (auto-creates the "询盘" tab on first use).
  results.feishuArchive = await archiveInquiry(env, row);

  return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: CORS });
}

export async function onRequestGet(context) {
  const env = context.env;
  const url = context.request.url;
  const doTest = url.includes("test=1");
  const doSetup = url.includes("setup=1");

  const configured = {
    wecom: !!env.WECOM_WEBHOOK,
    serverchan: !!env.SERVERCHAN_KEY,
    pushplus: !!env.PUSHPLUS_TOKEN,
    feishuGroup: !!env.FEISHU_GROUP_WEBHOOK,
    feishuArchive: feishuArchiveConfigured(env),
  };

  const out = {
    status: "diagnostic",
    configured,
    feishuGroupWebhook: mask(env.FEISHU_GROUP_WEBHOOK),
    feishuArchiveTarget: feishuArchiveConfigured(env)
      ? (env.FEISHU_INQUIRY_SHEET_NAME || "询盘") + " (auto-created in product spreadsheet)"
      : null,
    note: "Open with ?test=1 to send a test alert + write a test row; ?setup=1 to create the 询盘 tab now.",
  };

  if (doSetup) {
    try {
      const info = await ensureInquirySheet(env);
      out.setup = info
        ? { ok: true, spreadsheetToken: mask(info.spreadsheetToken), sheetId: info.sheetId, sheetName: info.sheetName, created: info.created }
        : { ok: false, error: "Feishu not configured" };
    } catch (e) {
      out.setup = { ok: false, error: e.message };
    }
  }

  if (doTest) {
    const title = "🧪 测试消息 · IMMORTAL FOREST";
    const plain = "这是一条来自网站后端的测试消息，用于验证推送通道是否配置正确。";
    const results = {};
    if (env.WECOM_WEBHOOK) results.wecom = await pushWeCom(env.WECOM_WEBHOOK, "🔔 **" + title + "**\n> " + plain);
    if (env.SERVERCHAN_KEY) results.serverchan = await pushServerChan(env.SERVERCHAN_KEY, title, plain);
    if (env.PUSHPLUS_TOKEN) results.pushplus = await pushPushPlus(env.PUSHPLUS_TOKEN, title, plain);
    if (env.FEISHU_GROUP_WEBHOOK) results.feishuGroup = await pushFeishuGroup(env.FEISHU_GROUP_WEBHOOK, title + "\n" + plain);
    // also write a clearly-marked test row so the whole path is verified
    try {
      const testRow = buildInquiryRow(await getNextSeq(env), new Date().toISOString(),
        { name: "【测试】", company: "测试公司", email: "test@example.com", type: "测试", msg: "【测试】这是一条测试询盘，可在飞书「询盘」表中删除" }, "127.0.0.1");
      results.feishuArchive = await archiveInquiry(env, testRow);
    } catch (e) {
      results.feishuArchive = { ok: false, error: e.message };
    }
    out.testResults = results;
  }

  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
