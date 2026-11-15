#!/usr/bin/env node
// Marketing posts from the approved queue in marketing/ (see marketing/README.md). Anything merged into main counts
// as approved; this script only decides WHEN each item goes out, and fills in numbers from the registry.
//
//   node tools/marketing.mjs blog     before the build: on a blog slot, publishes the next article in marketing/blog/
//   node tools/marketing.mjs x        after the build: on an X slot, posts the next item (a new article first)
//   node tools/marketing.mjs status   how many items are left; sets the step output low=1 when the queue runs low
//
// Slots (UTC, first workflow run from 12:00): X on Monday, Wednesday and Friday; blog on the 1st and 3rd Tuesday.
// MARKETING_NOW=2026-11-18T13:00:00Z overrides the clock (tests). Without the four X_* secrets, X posts are only
// printed (dry run) and NOT recorded, so a dry run never uses up an item.
// What went out is recorded in feed/marketing.json (committed by the workflow), so nothing is posted twice.
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "feed", "marketing.json");
const QUEUE_X = join(ROOT, "marketing", "x.json");
const BLOG_DIR = join(ROOT, "marketing", "blog");
const SITE = "aidriftline.com";
const DAY = 86400000;
const LOW_X = 4, LOW_BLOG = 1;

const now = new Date(process.env.MARKETING_NOW || Date.now());
const today = now.toISOString().slice(0, 10);
const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const readJson = (p, fallback) => existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
const log = readJson(LOG, { x: [], blog: {} });
const save = () => writeFileSync(LOG, JSON.stringify(log, null, 1) + "\n");

export const xSlot = (d) => d.getUTCHours() >= 12 && [1, 3, 5].includes(d.getUTCDay());
export const blogSlot = (d) => d.getUTCHours() >= 12 && d.getUTCDay() === 2 && [1, 3].includes(Math.ceil(d.getUTCDate() / 7));
export const xlen = (t) => [...t.replace(/\b[\w.-]+\.(com|ai|dev)\b\/?\S*/g, "x".repeat(23))].length;

// Numbers a post can use, always from today's registry: {total}, {retiring30}, {retiring90}, {next_id}, {next_date}, {next_days}.
export function tokens(reg, day = today) {
  const all = [...reg.models, ...Object.values(reg.platforms || {}).flatMap((p) => p.models || [])];
  const ahead = (n) => new Set(all.filter((m) => m.retires > day && m.retires <= plus(day, n) && m.qualifier !== "not-before").map((m) => m.id)).size;
  const next = reg.models.filter((m) => m.retires > day && m.qualifier === "exact").sort((a, b) => a.retires.localeCompare(b.retires))[0];
  return {
    total: String(all.length),
    retiring30: String(ahead(30)),
    retiring90: String(ahead(90)),
    next_id: next?.id || "", next_date: next ? nice(next.retires) : "", next_days: next ? String(Math.round((Date.parse(next.retires) - Date.parse(day)) / DAY)) : "",
  };
}
const plus = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const nice = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Fills {tokens}; returns null when the text names a token that doesn't exist or has no value today.
export function fill(text, t) {
  let ok = true;
  const s = text.replace(/\{(\w+)\}/g, (_, k) => { if (!t[k]) ok = false; return t[k] || ""; });
  return ok ? s : null;
}

// Articles go out by their "order" field (lowest first), then by file name.
export const blogQueue = () => existsSync(BLOG_DIR) ? readdirSync(BLOG_DIR).filter((f) => f.endsWith(".json"))
  .map((f) => ({ slug: f.slice(0, -5), order: readJson(join(BLOG_DIR, f), {}).order ?? 999 }))
  .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug)).map((a) => a.slug) : [];
const xQueue = () => readJson(QUEUE_X, []);
const postedX = () => new Set(log.x.map((p) => p.id));

// ---------- X ----------
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
async function tweet(text) {
  const url = "https://api.x.com/2/tweets";
  const res = await fetch(url, { method: "POST", headers: { Authorization: oauthHeader("POST", url), "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  const body = await res.text();
  if (!res.ok) throw new Error(`X API ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body).data?.id;
}

// The next X post: an article published in the last 7 days that X hasn't announced yet, else the next queue item.
export function nextX({ reg, day = today }) {
  const done = postedX();
  for (const [slug, date] of Object.entries(log.blog)) {
    if (date <= day && date > plus(day, -7) && !done.has(`blog:${slug}`)) {
      const a = readJson(join(BLOG_DIR, `${slug}.json`), null);
      if (a) return { id: `blog:${slug}`, text: `New on the blog: ${a.short || a.title}\n${SITE}/blog/${slug}/` };
    }
  }
  const t = tokens(reg, day);
  for (const item of xQueue()) {
    if (done.has(item.id)) continue;
    const text = fill(item.text, t);
    if (!text) { console.log(`Skipped ${item.id} for now: a number in it has no value today.`); continue; }
    if (xlen(text) > 280) { console.log(`Skipped ${item.id}: ${xlen(text)} characters (max 280).`); continue; }
    return { id: item.id, text };
  }
  return null;
}

const cmd = process.argv[2];
if (cmd === "blog") {
  if (!blogSlot(now)) { console.log("Not a blog slot."); process.exit(0); }
  if (Object.values(log.blog).includes(today)) { console.log("An article already went out today."); process.exit(0); }
  const next = blogQueue().find((s) => !log.blog[s]);
  if (!next) { console.log("Blog slot, but no approved article is waiting in marketing/blog/."); process.exit(0); }
  log.blog[next] = today;
  save();
  console.log(`Published marketing article ${next} (the build adds it to /blog/ and makes the dev.to draft).`);
} else if (cmd === "x") {
  if (!xSlot(now)) { console.log("Not an X slot."); process.exit(0); }
  if (log.x.some((p) => p.at.slice(0, 10) === today)) { console.log("A marketing post already went out today."); process.exit(0); }
  const reg = JSON.parse(readFileSync(join(ROOT, "models.json"), "utf8"));
  const post = nextX({ reg });
  if (!post) { console.log("X slot, but the queue in marketing/x.json is empty."); process.exit(0); }
  const live = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"].every((k) => process.env[k]);
  if (!live) { console.log(`Dry run (X keys not set), not recorded:\n${post.text}`); process.exit(0); }
  const id = await tweet(post.text);
  log.x.push({ id: post.id, at: now.toISOString(), tweet: id, text: post.text });
  save();
  console.log(`Posted https://x.com/aidriftline/status/${id}\n${post.text}`);
} else if (cmd === "status") {
  const xLeft = xQueue().filter((i) => !postedX().has(i.id)).length;
  const blogLeft = blogQueue().filter((s) => !log.blog[s]).length;
  console.log(`Marketing queue: ${xLeft} X post(s) and ${blogLeft} article(s) waiting.`);
  out("x_left", xLeft); out("blog_left", blogLeft);
  if (xLeft < LOW_X || blogLeft < LOW_BLOG) out("low", 1);
} else if (cmd === "check") {
  // Validates the queue (run before pushing new items): unique new ids, length with today's numbers, article fields.
  const reg = JSON.parse(readFileSync(join(ROOT, "models.json"), "utf8"));
  const t = tokens(reg), errors = [], ids = new Set();
  for (const [i, item] of xQueue().entries()) {
    if (!item.id || !item.text) { errors.push(`x.json item ${i + 1}: needs id and text`); continue; }
    if (ids.has(item.id)) errors.push(`x.json: id ${item.id} used twice`);
    ids.add(item.id);
    const unknown = [...item.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !(k in t));
    if (unknown.length) errors.push(`x.json ${item.id}: unknown number ${unknown.map((k) => `{${k}}`).join(", ")}`);
    const filled = fill(item.text, t);
    if (filled && xlen(filled) > 280) errors.push(`x.json ${item.id}: ${xlen(filled)} characters with today's numbers (max 280)`);
  }
  for (const slug of blogQueue()) {
    const a = readJson(join(BLOG_DIR, `${slug}.json`), null);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) errors.push(`blog/${slug}.json: file name must be lowercase words joined by hyphens`);
    for (const k of ["title", "short", "description", "blocks"]) if (!a?.[k]) errors.push(`blog/${slug}.json: missing ${k}`);
    if ((a?.tags || []).length > 4) errors.push(`blog/${slug}.json: dev.to allows at most 4 tags`);
    if (existsSync(join(ROOT, "tools", "posts", `${slug}.html`)) || existsSync(join(ROOT, "blog", slug)) && !log.blog[slug]) errors.push(`blog/${slug}.json: an article with this URL already exists`);
  }
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log(`Queue OK: ${xQueue().length} X post(s), ${blogQueue().length} article(s).`);
} else if (cmd) {
  console.error(`Unknown command ${cmd}. Use blog, x or status.`);
  process.exit(1);
}
