// =========================================================
//  仙人森林 · IMMORTAL FOREST — Feishu group @bot callback
//  POST /api/feishu-callback  (Feishu event subscription, HTTP mode)
//  GET  /api/feishu-callback  (liveness probe)
//
//  CASE 1 (new inquiries): after you handle an inquiry, send in the
//  group (mentioning the bot) a FIXED-FORMAT command:
//
//      @机器人 #12 已对接 已发报价和目录(可选)
//
//  This function verifies the callback, parses  "#<序号> <状态> [结果]",
//  locates the row by 序号 in the 询盘 sheet, writes 状态 / 跟进时间 /
//  跟进结果, then replies in the group to confirm.
//
//  CASE 2 (past inquiries): you edit the sheet directly — no bot needed.
// =========================================================

import {
  getToken, resolveInquirySheet, readValues, writeValues, normalizeStatus, bjParts, STATUS_KEYWORDS,
} from "./_feishu.js";

const API_BASE = "https://open.feishu.cn";

// ---- verification (best-effort; configurable via env) ----
async function verifyRequest(context, env, rawBody, json) {
  // 1) legacy verification token in the event header
  const headerToken = json && json.header && json.header.token;
  if (env.FEISHU_EVENT_TOKEN && headerToken && headerToken === env.FEISHU_EVENT_TOKEN) return true;

  // 2) HMAC signature (encrypt key mode)
  const key = env.FEISHU_EVENT_ENCRYPT_KEY;
  if (key) {
    const header = (json && json.header) || {};
    const ts = header.timestamp ||
      context.request.headers.get("x-lark-request-timestamp") ||
      context.request.headers.get("timestamp");
    const nonce = header.nonce || context.request.headers.get("nonce");
    const sig = context.request.headers.get("x-lark-signature") ||
      context.request.headers.get("x-feishu-signature");
    if (ts && nonce && sig) {
      const expect = await hmacBase64(key, String(ts) + String(nonce) + rawBody);
      if (expect && expect.length === sig.length && timingSafeEqual(expect, sig)) return true;
      return false; // key configured but signature mismatch => reject
    }
  }
  // no verification configured => allow (dev convenience)
  return true;
}

async function hmacBase64(key, data) {
  const enc = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await globalThis.crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  let bin = "";
  const bytes = new Uint8Array(sig);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function jsonOk() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

// ---- reply into the same group chat ----
async function reply(env, message, text) {
  const token = await getToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
  const chatId = message.chat_id;
  if (!chatId) return;
  const r = await fetch(API_BASE + "/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) }),
  });
  const j = await r.json();
  if (j.code !== 0) console.error("feishu reply failed:", JSON.stringify(j));
}

// ---- the actual command handling ----
async function processCommand(env, message) {
  try {
    const content = JSON.parse(message.content || "{}");
    let text = content.text || "";
    // strip mention tokens like @_user_1
    text = text.replace(/@_user_\w+/g, "").replace(/\s+/g, " ").trim();

    const m = text.match(/#\s*(\d+)\s+(\S+)(?:\s+([\s\S]*))?/);
    if (!m) {
      await reply(env, message,
        "❓ 指令格式：@机器人 #序号 状态 备注(可选)\n状态可选：" + STATUS_KEYWORDS.join(" / ") + "\n例如：@机器人 #12 已对接 已发报价和目录");
      return;
    }
    const seq = parseInt(m[1], 10);
    const statusWord = m[2];
    const result = (m[3] || "").trim();
    const canonical = normalizeStatus(statusWord);
    if (!canonical) {
      await reply(env, message,
        "❓ 状态只能是固定词：「" + statusWord + "」无效\n可用：" + STATUS_KEYWORDS.join(" / "));
      return;
    }

    const info = await resolveInquirySheet(env);
    if (!info) { await reply(env, message, "⚠️ 飞书表格未配置，无法更新"); return; }

    const token = await getToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
    const vals = await readValues(token, info.spreadsheetToken, info.sheetId + "!A1:A1000");
    let targetRow = -1;
    for (let i = 0; i < vals.length; i++) {
      const n = parseInt(vals[i] && vals[i][0], 10);
      if (n === seq) { targetRow = i + 1; break; }
    }
    if (targetRow < 0) {
      await reply(env, message, "⚠️ 未找到序号 #" + seq + "，请确认编号"); return;
    }

    const followTime = bjParts(new Date()).dt;
    // columns: I=状态, J=跟进时间, K=跟进结果
    const range = info.sheetId + "!I" + targetRow + ":K" + targetRow;
    await writeValues(token, info.spreadsheetToken, range, [[canonical, followTime, result]]);

    let out = "✅ 已更新 询盘 #" + seq + "\n状态：" + canonical;
    if (result) out += "\n结果：" + result;
    await reply(env, message, out);
  } catch (e) {
    try { await reply(env, message, "⚠️ 处理失败：" + e.message); } catch (_) {}
  }
}

export async function onRequestPost(context) {
  const env = context.env;
  const raw = await context.request.text();
  let json;
  try { json = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  // URL verification handshake during event-subscription setup
  if (json.type === "url_verification" && json.challenge) {
    return new Response(JSON.stringify({ challenge: json.challenge }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  if (!verifyRequest(context, env, raw, json)) {
    return new Response("unauthorized", { status: 401 });
  }

  const event = json.event || json;
  const message = event && event.message;
  if (!message) return jsonOk(); // not a message event

  // only act on group text messages where the bot is mentioned
  if (message.message_type !== "text") return jsonOk();
  if (message.chat_type !== "group") return jsonOk();
  if (message.sender && message.sender.sender_type === "bot") return jsonOk(); // ignore our own reply

  const appId = env.FEISHU_APP_ID;
  const mentions = message.mentions || [];
  const botMentioned = mentions.some((mt) => {
    if (!mt) return false;
    const id = mt.id;
    if (id === appId) return true;                                  // id 为字符串(直接是 app_id)
    if (id && typeof id === "object" && id.app_id === appId) return true; // id 为对象含 app_id
    if (mt.id_type === "app_id") return true;                       // 按 id_type 判断
    return false;
  });
  // Fallback: even if the @mention isn't detected (Feishu format drift),
  // still act when the text clearly matches the command pattern. This is a
  // private dedicated group bot, so false-positive risk is negligible.
  const contentText = (() => {
    try { return JSON.parse(message.content || "{}").text || ""; } catch { return ""; }
  })();
  const looksLikeCommand = /#\s*\d+\s+\S+/.test(contentText.replace(/@_user_\w+/g, ""));
  if (!botMentioned && !looksLikeCommand) return jsonOk();

  // respond 200 immediately; process asynchronously so Feishu doesn't retry
  const task = processCommand(env, message);
  if (context.waitUntil) context.waitUntil(task); else await task;

  return jsonOk();
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, svc: "feishu-callback" }), {
    status: 200, headers: { "Content-Type": "application/json" },
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
