#!/usr/bin/env node
// Creates dev.to drafts (never published) for the articles tools/build.mjs writes from the registry.
// Mirza reads each draft on dev.to and clicks Publish himself; the canonical link points to aidriftline.com.
//
//   DEVTO_API_KEY=… node tools/devto-draft.mjs     one draft per run, soonest retirement first
//
// Remembers drafted articles in feed/articles.json (field "devto"), so nothing is drafted twice.
// Without DEVTO_API_KEY it only prints what it would draft. In GitHub Actions it sets the step outputs
// title= and url= when it made a draft, so the workflow can open an issue (which emails Mirza).
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "feed", "articles.json");
const DIR = join(ROOT, "feed", "devto");
const today = new Date().toISOString().slice(0, 10);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

const todo = (existsSync(DIR) ? readdirSync(DIR) : []).filter((f) => f.endsWith(".json"))
  .map((f) => ({ slug: f.slice(0, -5), ...JSON.parse(readFileSync(join(DIR, f), "utf8")) }))
  .filter((a) => state[a.slug] && !state[a.slug].devto && a.retires >= today) // still ahead, not drafted yet
  .sort((a, b) => a.retires.localeCompare(b.retires));

if (!todo.length) { console.log("No new articles to draft on dev.to."); process.exit(0); }
const a = todo[0];
if (!process.env.DEVTO_API_KEY) { console.log(`DEVTO_API_KEY not set; would draft: ${a.title} (${todo.length} waiting)`); process.exit(0); }

const res = await fetch("https://dev.to/api/articles", {
  method: "POST",
  headers: { "api-key": process.env.DEVTO_API_KEY, "content-type": "application/json", accept: "application/vnd.forem.api-v1+json", "user-agent": "driftline-devto-draft" },
  body: JSON.stringify({ article: { title: a.title, body_markdown: a.body_markdown, published: false, canonical_url: a.canonical_url, description: a.description.slice(0, 250), tags: a.tags.slice(0, 4) } }),
  signal: AbortSignal.timeout(30000),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`dev.to refused the draft (${res.status}): ${JSON.stringify(body).slice(0, 300)}`); process.exit(1); }
state[a.slug].devto = { id: body.id, drafted: today };
writeFileSync(STATE, JSON.stringify(state, null, 1) + "\n");
console.log(`Draft created on dev.to: ${a.title} (id ${body.id}). ${todo.length - 1} more waiting.`);
out("title", a.title);
out("url", "https://dev.to/dashboard");
out("site", a.canonical_url);
