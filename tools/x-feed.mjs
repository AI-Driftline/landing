#!/usr/bin/env node
// Posts model-retirement alerts to X (@aidriftline) from models.json. Fixed templates only, no free text.
//   - new or changed retirement in the registry        → "New: …" / "Date change: …"
//   - 7 days before a fixed date (exact or routing)    → reminder
//   - on the day                                       → "Today …"
// Remembers what it posted in feed/state.json (committed by the workflow), so nothing goes out twice.
// First run with no state: records everything as already seen and posts nothing.
// Without the four X_* secrets it only prints the posts (dry run) and still records them.
//
//   node tools/x-feed.mjs            (reads ./models.json, the copy tools/build.mjs writes)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "feed", "state.json");
const SITE = "aidriftline.com";
const MAX_POSTS = 3;   // per run; the workflow runs 4 times a day
const MAX_NEW_GROUPS = 6; // more than this at once looks like a parsing accident: record, don't post, fail loudly
const WHO = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" };
const DAY = 86400000;

const reg = JSON.parse(readFileSync(join(ROOT, "models.json"), "utf8"));
const today = process.env.FEED_TODAY || new Date().toISOString().slice(0, 10);
const plus = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const nice = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const sig = (m) => [m.retires, m.qualifier, m.replacement || "", m.routes ? "routes" : ""].join("|");

// X counts every link as 23 characters.
const xlen = (t) => [...t.replace(/\b[\w.-]+\.(com|ai|dev)\/\S*/g, "x".repeat(23))].length;

// Fit as many IDs as the 280 limit allows: "a, b and 3 more".
function fit(make, ids) {
  for (let n = ids.length; n >= 1; n--) {
    const shown = ids.slice(0, n);
    const rest = ids.length - n;
    const list = rest ? `${shown.join(", ")} and ${rest} more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0];
    const text = make(list, ids.length);
    if (xlen(text) <= 280) return text;
  }
  return null;
}

const link = (ids) => `${SITE}/models/${ids[0]}/`; // the first ID is the most recognizable one
const CHECK = "Check your code: npx -y github:AI-Driftline/driftline .";

// kind: "new" (first time seen), "date" (date or qualifier changed) or "repl" (only the replacement changed).
function newPost(g, kind) {
  const { provider, retires, qualifier, replacement, routes } = g.entry;
  const who = WHO[provider] || provider;
  if (kind === "repl") {
    const was = (state.seen[g.ids[0]] || "").split("|")[2];
    const note = g.entry.replacement_note ? ` (${g.entry.replacement_note})` : "";
    return fit((list) => `Replacement change: ${who} now recommends ${replacement || "no direct replacement"}${note} for ${list}${was ? `, not ${was}` : ""}. ` +
      `Date unchanged: ${nice(retires)}.\n\n${CHECK}\n${link(g.ids)}`, g.ids);
  }
  const head = kind === "date" ? "Date change" : "New";
  // Longest version first; if even one model name doesn't fit in 280 characters, drop the second replacement, then the line.
  const repls = replacement ? [`\nReplacement: ${replacement}${g.entry.replacement_alt ? ` or ${g.entry.replacement_alt}` : ""}.`, `\nReplacement: ${replacement}.`, ""] : [""];
  for (const repl of [...new Set(repls)]) {
    const text = postText(g, kind, head, who, repl);
    if (text) return text;
  }
  return null;
}
function postText(g, kind, head, who, repl) {
  const { retires, qualifier, replacement, routes } = g.entry;
  return fit((list, n) => {
    const them = n === 1 ? "it" : "them";
    const body = routes
      ? `${head}: from ${nice(retires)}, ${who} answers ${list} requests with ${replacement}. ${g.entry.migration?.change === "params" ? `${who} lists request changes to make first.` : "No error, different model."}`
      : qualifier === "earliest"
      ? `${head}: ${who} lists ${nice(retires)} as the earliest shutdown for ${list}. ${n === 1 ? "It" : "They"} can be switched off from that day on.${repl}`
      : qualifier === "not-before"
      ? `${head}: ${who} deprecates ${list}. Retirement not before ${nice(retires)}.${repl}`
      : `${head}: ${who} retires ${list} on ${nice(retires)}. Calls to ${them} fail after that.${repl}`;
    return `${body}\n\n${CHECK}\n${link(g.ids)}`;
  }, g.ids);
}

function reminder(g, when) {
  const { provider, retires } = g.entry;
  const who = WHO[provider] || provider;
  const repls = [...new Set(g.models.filter((m) => m.replacement).map((m) => m.replacement + (m.replacement_alt ? ` or ${m.replacement_alt}` : "")))];
  const routes = g.models.every((m) => m.routes);
  // Same fallback as newPost: shorter replacement line, then none, rather than no post at all.
  const options = repls.length === 1 ? [`\nReplacement: ${repls[0]}.`, `\nReplacement: ${repls[0].split(" or ")[0]}.`, ""] : [""];
  for (const repl of [...new Set(options)]) {
    const text = reminderText(g, when, who, routes, repl);
    if (text) return text;
  }
  return null;
}
function reminderText(g, when, who, routes, repl) {
  const { retires } = g.entry;
  return fit((list, n) => {
    const body = when === "day"
      ? (routes ? `From today, ${who} answers ${list} requests with a newer model. ${g.models.some((m) => m.migration?.change === "params") ? `${who} lists request changes to make for it.` : "No error, different answers."}${repl}`
        : `Today ${who} retires ${list}. Calls to ${n === 1 ? "it" : "them"} fail from now on.${repl}`)
      : (routes ? `In 7 days (${nice(retires)}), ${who} starts answering ${list} requests with a newer model.${repl}`
        : `In 7 days (${nice(retires)}), ${who} retires ${list}.${repl}`);
    return `${body}\n\n${CHECK}\n${link(g.ids)}`;
  }, g.ids);
}

const group = (list, key) => {
  const map = new Map();
  for (const m of list) {
    const k = key(m);
    if (!map.has(k)) map.set(k, { key: k, entry: m, ids: [], models: [] });
    map.get(k).ids.push(m.id);
    map.get(k).models.push(m);
  }
  // Short names people type (gpt-5, o3) before dated snapshots (gpt-5-2025-08-07), so the post and link lead with them.
  const dated = (id) => /-\d{4}-\d{2}-\d{2}$|-\d{8}$/.test(id);
  for (const g of map.values()) g.ids.sort((a, b) => dated(a) - dated(b));
  return [...map.values()];
};

// ---------- what to post ----------
const firstRun = !existsSync(STATE);
const state = firstRun ? { seen: {}, posted: [] } : JSON.parse(readFileSync(STATE, "utf8"));
const posts = [];

const fixed = reg.models.filter((m) => m.qualifier === "exact");
for (const g of group(fixed.filter((m) => m.retires === today), (m) => `day:${m.retires}:${m.provider}`))
  if (!state.posted.includes(g.key)) posts.push({ key: g.key, text: reminder(g, "day") });

const changed = reg.models.filter((m) => !firstRun && state.seen[m.id] !== sig(m) && m.retires >= plus(today, -1));
// What changed decides the post: a new entry, a new date, or only a new replacement.
const kindOf = (m) => { const old = state.seen[m.id]; if (!old) return "new"; const [r, q] = old.split("|"); return r !== m.retires || q !== m.qualifier ? "date" : "repl"; };
// The provider's note (e.g. reasoning.mode: pro) is part of the advice, so models with a note get their own post.
const newGroups = group(changed, (m) => `new:${m.provider}:${kindOf(m)}:${sig(m)}|${m.replacement_note || ""}`);
let warning = "";
if (newGroups.length > MAX_NEW_GROUPS) {
  warning = `${newGroups.length} new or changed groups at once (limit ${MAX_NEW_GROUPS}); recorded without posting. Check the registry.`;
} else {
  for (const g of newGroups) posts.push({ key: g.key, ids: g.ids, text: newPost(g, g.key.split(":")[2]) });
}

for (const g of group(fixed.filter((m) => m.retires === plus(today, 7)), (m) => `week:${m.retires}:${m.provider}`))
  if (!state.posted.includes(g.key)) posts.push({ key: g.key, text: reminder(g, "week") });

// ---------- post ----------
const KEYS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"];
const live = KEYS.every((k) => process.env[k]);

function oauthHeader(method, url) {
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const o = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const params = Object.keys(o).sort().map((k) => `${enc(k)}=${enc(o[k])}`).join("&");
  const base = [method, enc(url), enc(params)].join("&");
  const signingKey = `${enc(process.env.X_API_SECRET)}&${enc(process.env.X_ACCESS_SECRET)}`;
  o.oauth_signature = createHmac("sha1", signingKey).update(base).digest("base64");
  return "OAuth " + Object.keys(o).sort().map((k) => `${enc(k)}="${enc(o[k])}"`).join(", ");
}

async function tweet(text) {
  const url = "https://api.x.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: oauthHeader("POST", url), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`X API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).data?.id;
}

const save = () => {
  mkdirSync(dirname(STATE), { recursive: true });
  state.posted = state.posted.slice(-300);
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
};

// Started by hand from the Actions tab: prove the keys work with a read-only call (posts nothing).
if (live && process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
  const url = "https://api.x.com/2/users/me";
  const res = await fetch(url, { headers: { Authorization: oauthHeader("GET", url) } });
  const body = await res.text();
  console.log(res.ok ? `X keys OK: signed in as @${JSON.parse(body).data?.username}` : `X keys NOT working (${res.status}): ${body.slice(0, 300)}`);
  if (!res.ok) process.exitCode = 1;
}

let failed = null;
let sent = 0;
for (const p of posts) {
  if (!p.text) { console.log(`skip ${p.key}: does not fit in one post`); state.posted.push(p.key); continue; }
  if (sent >= MAX_POSTS) { console.log(`later: ${p.key}`); continue; }
  try {
    const id = live ? await tweet(p.text) : "dry-run";
    console.log(`\n--- ${live ? "posted " + id : "DRY RUN"} (${p.key}, ${xlen(p.text)} chars)\n${p.text}`);
    state.posted.push(p.key);
    if (p.ids) for (const i of p.ids) state.seen[i] = sig(reg.models.find((m) => m.id === i));
    sent++;
  } catch (e) { failed = e; break; }
}

// Everything not waiting to be posted counts as seen (first run, old entries, the flood guard).
const waiting = new Set(posts.filter((p) => !state.posted.includes(p.key)).flatMap((p) => p.ids || []));
for (const m of reg.models) if (!waiting.has(m.id)) state.seen[m.id] = sig(m);
save();

console.log(`\n${firstRun ? "First run: recorded " + reg.models.length + " models, posted nothing. " : ""}${sent} post(s) ${live ? "sent" : "printed (dry run: X keys not set)"}.`);
if (warning) { console.error(warning); process.exitCode = 1; }
if (failed) { console.error(failed.message); process.exitCode = 1; }
