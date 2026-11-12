#!/usr/bin/env node
// Posts one hand-written post to X (@aidriftline). Started by hand from the Actions tab (x-post workflow)
// with the text as input; the regular alerts come from tools/x-feed.mjs.
import { createHmac, randomBytes } from "node:crypto";

const text = (process.env.POST_TEXT || "").replace(/\\n/g, "\n").trim();
const xlen = (t) => [...t.replace(/\b[\w.-]+\.(com|ai|dev)\b\/?\S*/g, "x".repeat(23))].length;
if (!text) { console.error("POST_TEXT is empty"); process.exit(1); }
if (xlen(text) > 280) { console.error(`Too long: ${xlen(text)} characters (max 280)`); process.exit(1); }

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function oauthHeader(method, url) {
  const o = {
    oauth_consumer_key: process.env.X_API_KEY, oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: process.env.X_ACCESS_TOKEN, oauth_version: "1.0",
  };
  const params = Object.keys(o).sort().map((k) => `${enc(k)}=${enc(o[k])}`).join("&");
  const key = `${enc(process.env.X_API_SECRET)}&${enc(process.env.X_ACCESS_SECRET)}`;
  o.oauth_signature = createHmac("sha1", key).update([method, enc(url), enc(params)].join("&")).digest("base64");
  return "OAuth " + Object.keys(o).sort().map((k) => `${enc(k)}="${enc(o[k])}"`).join(", ");
}

const url = "https://api.x.com/2/tweets";
const res = await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url), "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
const body = await res.text();
if (!res.ok) { console.error(`X API ${res.status}: ${body.slice(0, 400)}`); process.exit(1); }
console.log(`Posted https://x.com/aidriftline/status/${JSON.parse(body).data?.id} (${xlen(text)} chars)\n${text}`);
