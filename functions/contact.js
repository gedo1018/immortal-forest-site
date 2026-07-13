// =========================================================
//  仙人森林 · IMMORTAL FOREST — Cloudflare Pages Function
//  POST /api/contact  ->  { ok: true }
//
//  Receives the contact/form inquiry and appends it to a
//  Feishu sheet (a dedicated "inquiry" table). If Feishu is
//  not configured, the submission is still accepted (never
//  drops a lead) — you just won't see it in the sheet until
//  creds are wired up.
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
  const { FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_INQUIRY_TOKEN, FEISHU_INQUIRY_RANGE } = context.env;
  const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  // Parse submitted data (FormData or JSON).
  let data = {};
  try {
    const form = await context.request.formData();
    for (const [k, v] of form.entries()) data[k] = String(v);
  } catch (e) {
    try { data = await context.request.json(); } catch (_) { /* ignore */ }
  }

  const row = [
    new Date().toISOString(),
    data.name || "",
    data.company || data.country || "",   // zh has company, en has country
    data.email || "",
    data.type || "",
    data.msg || "",
    context.request.headers.get("cf-connecting-ip") || "",
  ];

  // Only write to Feishu when fully configured; otherwise accept silently.
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
