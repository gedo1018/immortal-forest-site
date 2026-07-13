// =========================================================
//  仙人森林 · IMMORTAL FOREST — Cloudflare Pages Function
//  POST /api/contact  ->  { ok: true }
//
//  Receives the contact/form inquiry, then pushes a
//  REAL-TIME alert to whichever chat channel is configured
//  (you only need ONE of them):
//    - WECOM_WEBHOOK    企业微信群机器人 (webhook URL)
//    - SERVERCHAN_KEY   Server酱  -> 推送到个人微信 (扫码关注公众号)
//    - PUSHPLUS_TOKEN   PushPlus  -> 推送到个人微信 (扫码关注公众号)
//  Also archives the row to a Feishu sheet (optional).
//
//  The form always returns { ok: true } so a lead is never
//  lost at the front end. Every arrival is also logged to
//  Cloudflare Functions logs so you can verify delivery.
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

export async function onRequestPost(context) {
  const {
    FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_INQUIRY_TOKEN, FEISHU_INQUIRY_RANGE,
    WECOM_WEBHOOK, SERVERCHAN_KEY, PUSHPLUS_TOKEN, FEISHU_GROUP_WEBHOOK,
  } = context.env;
  const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  // Parse submitted data (FormData or JSON).
  let data = {};
  try {
    const form = await context.request.formData();
    for (const [k, v] of form.entries()) data[k] = String(v);
  } catch (e) {
    try { data = await context.request.json(); } catch (_) { /* ignore */ }
  }

  const time = new Date().toISOString();
  const ip = context.request.headers.get("cf-connecting-ip") || "";
  const row = [
    time,
    data.name || "",
    data.company || data.country || "",
    data.email || "",
    data.type || "",
    data.msg || "",
    ip,
  ];

  // Always log the arrival so it's verifiable in Cloudflare Functions logs.
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

  // --- Channel 1: WeCom (企业微信) group bot webhook ---
  if (WECOM_WEBHOOK) {
    const content = [
      "🔔 **" + title + "**",
      "> **姓名**: " + (data.name || "-"),
      "> **公司/国家**: " + (data.company || data.country || "-"),
      "> **邮箱**: " + (data.email || "-"),
      "> **类型**: " + (data.type || "-"),
      "> **留言**: " + (data.msg || "-"),
      "> **IP**: " + ip,
      "> **时间**: " + time,
    ].join("\n");
    try {
      const r = await fetch(WECOM_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
      });
      const j = await r.json();
      if (j.errcode !== 0) console.error("WeCom push failed:", JSON.stringify(j));
    } catch (e) {
      console.error("WeCom push error:", e.message);
    }
  }

  // --- Channel 2: Server酱 (personal WeChat via official account) ---
  if (SERVERCHAN_KEY) {
    try {
      const r = await fetch("https://sctapi.ftqq.com/" + SERVERCHAN_KEY + ".send", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "title=" + encodeURIComponent(title) + "&desp=" + encodeURIComponent(plain),
      });
      const j = await r.json();
      if (j.code !== 0) console.error("ServerChan push failed:", JSON.stringify(j));
    } catch (e) {
      console.error("ServerChan push error:", e.message);
    }
  }

  // --- Channel 3: PushPlus (personal WeChat via official account) ---
  if (PUSHPLUS_TOKEN) {
    try {
      const r = await fetch("https://www.pushplus.plus/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: PUSHPLUS_TOKEN, title, content: plain }),
      });
      const j = await r.json();
      if (j.code !== 200) console.error("PushPlus push failed:", JSON.stringify(j));
    } catch (e) {
      console.error("PushPlus push error:", e.message);
    }
  }

  // --- Channel 4: Feishu (飞书) group bot webhook ---
  if (FEISHU_GROUP_WEBHOOK) {
    try {
      const r = await fetch(FEISHU_GROUP_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msg_type: "text",
          content: { text: title + "\n" + plain },
        }),
      });
      const j = await r.json();
      if (j.code !== 0 && j.StatusMessage !== "success") {
        console.error("Feishu group push failed:", JSON.stringify(j));
      }
    } catch (e) {
      console.error("Feishu group push error:", e.message);
    }
  }

  // --- Archive to Feishu sheet (optional, requires write perms) ---
  if (FEISHU_APP_ID && FEISHU_APP_SECRET && FEISHU_INQUIRY_TOKEN && FEISHU_INQUIRY_RANGE) {
    try {
      const token = await getToken(FEISHU_APP_ID, FEISHU_APP_SECRET);
      const url = API_BASE + "/open-apis/sheets/v2/spreadsheets/" +
                  FEISHU_INQUIRY_TOKEN + "/values_append";
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ valueRange: { range: FEISHU_INQUIRY_RANGE, values: [row] } }),
      });
      const j = await r.json();
      if (j.code !== 0) console.error("Feishu inquiry append failed:", JSON.stringify(j));
    } catch (e) {
      console.error("Feishu inquiry error:", e.message);
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
}

// Allow the browser's preflight / direct GET (so the endpoint is testable).
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
