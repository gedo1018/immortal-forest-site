// =========================================================
//  仙人森林 · IMMORTAL FOREST — Cloudflare Pages Function
//  POST /api/contact  ->  { ok: true, results: {...} }
//  GET  /api/contact  ->  diagnostic (which channels configured)
//  GET  /api/contact?test=1 -> also send a TEST alert per channel
//
//  Receives the contact/form inquiry, then pushes a
//  REAL-TIME alert to whichever chat channel is configured
//  (you only need ONE of them):
//    - WECOM_WEBHOOK      企业微信群机器人 (webhook URL)
//    - SERVERCHAN_KEY     Server酱  -> 推送到个人微信 (扫码关注公众号)
//    - PUSHPLUS_TOKEN     PushPlus  -> 推送到个人微信 (扫码关注公众号)
//    - FEISHU_GROUP_WEBHOOK 飞书群机器人 webhook -> 推送到飞书群
//  Also archives the row to a Feishu sheet (optional).
//
//  Diagnostics are returned in the HTTP response (free, no paid
//  Cloudflare Logs needed) so you can verify delivery from the
//  browser Network tab or by opening /api/contact in a browser.
// =========================================================

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
  const row = [time, data.name || "", data.company || data.country || "", data.email || "", data.type || "", data.msg || "", ip];

  console.log("Contact submission:", JSON.stringify({ time, ...data, ip }));

  const title = "新询盘 · IMMORTAL FOREST";
  const plain = [
    "姓名: " + (data.name || "-"),
    "公司/国家: " + (data.company || data.country || "-"),
    "邮箱: " + (data.email || "-"),
    "类型: " + (data.type || "-"),
    "留言: " + (data.msg || "-"),
    "IP: " + ip,
    "时间: " + time,
  ].join("\n");

  const results = {};
  if (env.WECOM_WEBHOOK) results.wecom = await pushWeCom(env.WECOM_WEBHOOK, "🔔 **" + title + "**\n> " + plain.replace(/\n/g, "\n> "));
  if (env.SERVERCHAN_KEY) results.serverchan = await pushServerChan(env.SERVERCHAN_KEY, title, plain);
  if (env.PUSHPLUS_TOKEN) results.pushplus = await pushPushPlus(env.PUSHPLUS_TOKEN, title, plain);
  if (env.FEISHU_GROUP_WEBHOOK) results.feishuGroup = await pushFeishuGroup(env.FEISHU_GROUP_WEBHOOK, title + "\n" + plain);

  if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_INQUIRY_TOKEN && env.FEISHU_INQUIRY_RANGE) {
    try {
      const token = await getToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
      const url = API_BASE + "/open-apis/sheets/v2/spreadsheets/" + env.FEISHU_INQUIRY_TOKEN + "/values_append";
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ valueRange: { range: env.FEISHU_INQUIRY_RANGE, values: [row] } }),
      });
      const j = await r.json();
      results.feishuArchive = j.code === 0 ? { ok: true } : { ok: false, error: JSON.stringify(j) };
    } catch (e) {
      results.feishuArchive = { ok: false, error: e.message };
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: CORS });
}

export async function onRequestGet(context) {
  const env = context.env;
  const doTest = context.request.url.includes("test=1");

  const configured = {
    wecom: !!env.WECOM_WEBHOOK,
    serverchan: !!env.SERVERCHAN_KEY,
    pushplus: !!env.PUSHPLUS_TOKEN,
    feishuGroup: !!env.FEISHU_GROUP_WEBHOOK,
    feishuArchive: !!(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_INQUIRY_TOKEN && env.FEISHU_INQUIRY_RANGE),
  };

  const out = {
    status: "diagnostic",
    configured,
    feishuGroupWebhook: mask(env.FEISHU_GROUP_WEBHOOK),
    note: "Open with ?test=1 to actually send a test alert to every configured channel.",
  };

  if (doTest) {
    const title = "🧪 测试消息 · IMMORTAL FOREST";
    const plain = "这是一条来自网站后端的测试消息，用于验证推送通道是否配置正确。";
    const results = {};
    if (env.WECOM_WEBHOOK) results.wecom = await pushWeCom(env.WECOM_WEBHOOK, "🔔 **" + title + "**\n> " + plain);
    if (env.SERVERCHAN_KEY) results.serverchan = await pushServerChan(env.SERVERCHAN_KEY, title, plain);
    if (env.PUSHPLUS_TOKEN) results.pushplus = await pushPushPlus(env.PUSHPLUS_TOKEN, title, plain);
    if (env.FEISHU_GROUP_WEBHOOK) results.feishuGroup = await pushFeishuGroup(env.FEISHU_GROUP_WEBHOOK, title + "\n" + plain);
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
