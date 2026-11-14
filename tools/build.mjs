#!/usr/bin/env node
// Builds the pages that search engines and AI assistants read, from the product registry:
//   models/index.html            every tracked model, by date
//   models/<id>/index.html       one page per model ID (date, replacement, source, how to check)
//   models.json                  the registry, served from aidriftline.com for scripts and agents
//   llms.txt, llms-full.txt      plain-text summary for AI assistants (llmstxt.org)
//   feed.xml                     RSS: one item per announced retirement (models sharing date + replacement grouped)
//   retirements.ics              the same as a calendar to subscribe to (all-day events)
//   sitemap.xml, robots.txt
// It also refreshes the model count and "checked" date written into index.html and agents/index.html.
//
// Run after every registry change:  node tools/build.mjs [path/to/models.json]
// Default registry path: ../product/registry/models.json (the product repo next to this one).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://aidriftline.com";
const regPath = resolve(process.argv[2] || join(ROOT, "..", "product", "registry", "models.json"));
const reg = JSON.parse(readFileSync(regPath, "utf8"));
// Entries the page check found out of step with the provider's page (feed/disputed.json): marked "under review".
const DISPUTED = join(ROOT, "feed", "disputed.json");
const disputed = existsSync(DISPUTED) ? JSON.parse(readFileSync(DISPUTED, "utf8")) : {};
for (const m of reg.models) if (disputed[m.id]) m.under_review = disputed[m.id];
// Migration rules live in the product repo next to the registry (same rules the Action and MCP use).
const { migrationFor, MIGRATION_LABEL } = await import(pathToFileURL(join(dirname(regPath), "..", "src", "migration.js")).href);
const { buildRegistry } = await import(pathToFileURL(join(dirname(regPath), "..", "src", "registry.js")).href);
const { batchArticles } = await import("./articles.mjs");
const models = [...reg.models].sort((a, b) => a.retires.localeCompare(b.retires) || a.id.localeCompare(b.id));
const byId = new Map(models.map((m) => [m.id, m]));
// Claude short names ("claude-sonnet-4-5") get a page too: people search for those, not the dated snapshot.
// Same rule as the Action: only when every snapshot behind the name shares one date.
const aliases = [];
{
  const groups = new Map();
  for (const m of models) {
    const base = m.provider === "anthropic" && m.id.match(/^(claude-.+)-\d{8}$/)?.[1];
    if (base) groups.set(base, [...(groups.get(base) || []), m]);
  }
  for (const [base, snaps] of groups) {
    if (byId.has(base) || snaps.some((s) => s.retires !== snaps[0].retires || s.qualifier !== snaps[0].qualifier)) continue;
    const latest = snaps.reduce((a, b) => (a.id > b.id ? a : b));
    aliases.push({ ...latest, id: base, aliasOf: latest.id });
  }
  for (const a of aliases) byId.set(a.id, a);
}
const TODAY = new Date().toISOString().slice(0, 10);
// Amazon Bedrock's own dates (registry platforms.bedrock): pages under /models/bedrock/, see the Bedrock section below.
// Google Vertex AI's own dates (registry platforms.vertex): pages under /models/vertex/. Same model names as the
// Gemini API (and Claude's), different dates; each page links to the other.
const VX = reg.platforms?.vertex;
const vertex = [...(VX?.models || [])].sort((a, b) => a.retires.localeCompare(b.retires) || a.id.localeCompare(b.id));
const vxById = new Map(vertex.map((v) => [v.id, v]));
const vxSlug = (id) => id.replace(/[:@]/g, "-");
const vxUrl = (id) => `/models/vertex/${vxSlug(id)}/`;
const vxLink = (id) => (vxById.has(id) ? `<a href="${vxUrl(id)}"><code>${esc(id)}</code></a>` : `<code>${esc(id)}</code>`);
// The Gemini API / Anthropic entry for a Vertex model, and back: gemini-2.5-pro ↔ gemini-2.5-pro, claude-3-haiku ↔ claude-3-haiku-20240307.
const vxTwinOf = (v) => v.maker === "google" ? reg.models.find((m) => m.id === v.id && m.provider === "google")
  : v.maker === "anthropic" ? reg.models.filter((m) => m.provider === "anthropic" && m.id.replace(/-\d{8}$/, "") === v.id.replace(/-v\d+$/, "")).sort((a, b) => b.id.localeCompare(a.id))[0] : null;
const vxOf = (m) => vertex.find((v) => vxTwinOf(v)?.id === (m.aliasOf || m.id));
// Microsoft Azure's own dates, per model version (registry platforms.azure): pages under /models/azure/.
const AZ = reg.platforms?.azure;
const azure = [...(AZ?.models || [])].sort((a, b) => a.retires.localeCompare(b.retires) || a.id.localeCompare(b.id));
const azById = new Map(azure.map((a) => [a.id, a]));
const azSlug = (id) => id.replace(/[:@\s/]/g, "-");
const azUrl = (id) => `/models/azure/${azSlug(id)}/`;
const azLink = (id) => (azById.has(id) ? `<a href="${azUrl(id)}"><code>${esc(id)}</code></a>` : `<code>${esc(id)}</code>`);
// Azure lists a planned end date for every model; GA/Preview ones are current, the rest are on their way out.
const azCurrent = (v) => /^(ga|preview|generally available)$/i.test(v?.lifecycle || "");
// OpenAI's entry for an Azure model version: gpt-4o 2024-05-13 ↔ gpt-4o-2024-05-13, o3 ↔ o3.
const azTwin = (a, v) => byId.get(`${a.id}-${v?.version}`) || byId.get(a.id);
const azOf = (m) => { for (const a of azure) for (const v of a.versions) if (`${a.id}-${v.version}` === m.id || (a.id === m.id && a.versions.length === 1)) return { a, v }; return null; };
const BR = reg.platforms?.bedrock;
const bedrock = [...(BR?.models || [])].sort((a, b) => a.retires.localeCompare(b.retires) || a.id.localeCompare(b.id));

const WHO = { openai: "OpenAI", anthropic: "Anthropic", google: "Google", bedrock: "Amazon Bedrock", vertex: "Vertex AI", azure: "Azure" };
// "X or Y" when the provider names two replacements.
const replName = (m) => m.replacement + (m.replacement_alt ? ` or ${m.replacement_alt}` : "");
const KIND = { text: "Text", audio: "Audio", image: "Image", video: "Video", embedding: "Embedding", moderation: "Moderation", agent: "Agent" };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const long = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const short = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const past = (m) => m.retires <= TODAY;
const url = (id) => `/models/${id}/`;
const link = (id) => (byId.has(id) ? `<a href="${url(id)}"><code>${esc(id)}</code></a>` : `<code>${esc(id)}</code>`);

// Follow replacement chains (a replacement that is itself retiring) to the model to move to, like the Action does.
function finalReplacement(m) {
  const seen = new Set([m.id]);
  let next = m.replacement;
  while (next && byId.get(next)?.replacement && byId.get(next).qualifier !== "not-before" && !seen.has(next)) {
    seen.add(next);
    next = byId.get(next).replacement;
  }
  return next;
}

// The one-paragraph answer that leads each page (and its meta description).
function answer(m) {
  const who = WHO[m.provider] || m.provider;
  const d = long(m.retires);
  let s = m.aliasOf ? `${m.id} is the short name for the snapshot ${m.aliasOf}. ` : "";
  if (m.routes) {
    s += past(m)
      ? `Since ${d}, ${who} routes API requests for ${m.id} to ${m.replacement}. Calls to ${m.id} still succeed, but the answers come from a different model.`
      : `On ${d}, ${who} starts routing API requests for ${m.id} to ${m.replacement}. Calls to ${m.id} will keep succeeding, but the answers will come from a different model.`
    if (migrationFor(m)?.change === "params") s += ` ${who} lists request changes to make for ${m.replacement} before then: ${migrationFor(m).note.replace(/^Gemini 3 changes the request: /, "")}`;
  } else if (m.qualifier === "earliest") {
    s += past(m)
      ? `${who} listed ${d} as the earliest shutdown date for ${m.id}. That date has passed, so ${m.id} may stop working at any time.`
      : `${who} lists ${d} as the earliest shutdown date for ${m.id}. Google gives earliest dates only; the model can be switched off from that day on.`;
  } else if (m.qualifier === "not-before") {
    s += `${who} has deprecated ${m.id} and will retire it no sooner than ${d}. The exact date has not been announced yet.`;
  } else {
    s += past(m) ? `${who} retired ${m.id} on ${d}. API calls to it now fail.` : `${who} will retire ${m.id} on ${d}. After that date, API calls to it fail.`;
  }
  const r = finalReplacement(m);
  if (m.replacement && !m.routes) s += ` The recommended replacement is ${replName(m)}${m.replacement_note ? ` (${m.replacement_note})` : ""}${r && r !== m.replacement ? ` (which is itself retiring; move to ${r})` : ""}.${m.previous_replacement ? ` ${who} changed this recommendation on ${long(m.replacement_changed)}; before, it was ${m.previous_replacement}.` : ""}`;
  else if (!m.replacement) s += ` ${who} names no direct replacement.`;
  return s;
}

const dateKind = (m) => (m.routes ? "Routing starts" : m.qualifier === "earliest" ? "Earliest shutdown" : m.qualifier === "not-before" ? "Not before" : "Shutdown");
const status = (m) => (m.routes ? (past(m) ? "Routed to the replacement" : "Will be routed")
  : m.qualifier === "not-before" ? "Deprecated, date not final"
  : past(m) ? (m.qualifier === "earliest" ? "May already be off" : "Retired") : "Retiring");

// ---------- shared page frame ----------
const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><g transform="translate(-2 2)"><rect x="12" y="12" width="19" height="19" rx="3" fill="#FAFAFA"/><rect class="blip" x="39" y="6" width="19" height="19" rx="3" fill="#C6F432"/><rect x="12" y="33" width="19" height="19" rx="3" fill="#FAFAFA"/><rect x="33" y="33" width="19" height="19" rx="3" fill="#FAFAFA"/></g></svg>`;
function page({ path, title, description, body, jsonld = [] }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0A0A0A">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/assets/driftline-social-preview-v3.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@aidriftline">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/favicon-180.png">
<link rel="alternate" type="application/json" href="/models.json" title="Driftline model retirement registry">
<link rel="alternate" type="application/rss+xml" href="/feed.xml" title="AI model retirements (Driftline)">
<link rel="stylesheet" href="/styles.css">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
<header class="nav scrolled">
  <div class="wrap">
    <a class="logo" href="/" aria-label="Driftline home">${LOGO}driftline</a>
    <a class="btn small" href="/#install">Add the free Action <span class="arrow" aria-hidden="true">→</span></a>
  </div>
</header>
<main class="doc">
  <div class="wrap">
${body}
  </div>
</main>
<footer>
  <div class="wrap">
    <a class="logo" href="/" aria-label="Driftline home">${LOGO}driftline</a>
    <nav aria-label="Footer">
      <a href="/models/">All retirement dates</a>
      <a href="/agents/">For AI agents</a>
      <a href="/blog/">Blog</a>
      <a href="https://github.com/AI-Driftline/driftline" rel="noopener">GitHub</a>
      <a href="https://x.com/aidriftline" rel="noopener">X</a>
      <a href="/feed.xml">RSS</a>
      <a href="mailto:hello@aidriftline.com">hello@aidriftline.com</a>
    </nav>
    <div class="legal">
      <span>© 2026 Driftline. Driftline is not affiliated with OpenAI, Anthropic or Google.</span>
      <span><a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · <a href="/refunds.html">Refunds</a></span>
    </div>
  </div>
</footer>
<script src="/count.js" defer></script>
</body>
</html>
`;
}

const CHECK_BLOCK = (id) => `
    <h2>Check your code for it</h2>
    <p>Run this in your repository. No install and no API key; it lists every OpenAI, Anthropic, Google, Amazon Bedrock, Vertex AI and Azure model ID it finds, with its retirement date and replacement:</p>
    <pre class="cmd"><code>npx -y @aidriftline/driftline .</code></pre>
    <p>Or look for this ID only: <code>grep -rn "${esc(id)}" .</code> (misses aliases, Bedrock and Vertex names, and IDs split across lines).</p>
    <p>To be warned automatically before the next retirement, add the <a href="/#install">free Driftline GitHub Action</a>. It annotates the exact line in pull requests and can fail the build on retired models.</p>`;

// Email alert sign-up (the driftline-api Worker). count.js shows the result message.
const API = "https://driftline-api.aidriftline.workers.dev";
const ALERT_BLOCK = (m, named = false) => `
    <h2 id="alert">Get an email before ${named ? esc(m.id) : "it"} ${m.routes ? "is re-routed" : "retires"}</h2>
    <form class="alert-form" method="post" action="${API}/subscribe">
      <input type="hidden" name="model" value="${esc(m.id)}">
      <input type="email" name="email" required maxlength="200" placeholder="you@company.com" aria-label="Your email address">
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn small" type="submit">Email me</button>
    </form>
    <p class="alert-msg" role="status" hidden></p>
    <p class="note">One email 30 days before, one 7 days before and one on the day, plus a note if ${WHO[m.provider] || m.provider} changes the date. Nothing else. One-click unsubscribe.</p>`;

// ---------- one page per model ----------
rmSync(join(ROOT, "models"), { recursive: true, force: true });
for (const m of [...models, ...aliases]) {
  const who = WHO[m.provider] || m.provider;
  const kind = m.kind || "text";
  const r = finalReplacement(m);
  const same = models.filter((o) => o.id !== m.id && o.provider === m.provider && o.retires === m.retires).slice(0, 12);
  const text = answer(m);
  const title = m.routes
    ? `${m.id}: switches to ${m.replacement} on ${short(m.retires)} · Driftline`
    : `${m.id} retirement date: ${short(m.retires)}${m.qualifier === "earliest" ? " (earliest)" : m.qualifier === "not-before" ? " (not before)" : ""} · Driftline`;
  const q1 = m.routes ? `What happens to ${m.id} on ${long(m.retires)}?` : `When is ${m.id} retired?`;
  const faq = [{ q: q1, a: text }];
  if (m.replacement) faq.push({ q: `What replaces ${m.id}?`, a: `${who} recommends ${replName(m)}${m.replacement_note ? ` (${m.replacement_note})` : ""}${r && r !== m.replacement ? `, which is itself retiring; the model to move to is ${r}` : ""}. Test your prompts on it before you switch: answers, formats and JSON output can change.` });
  const mig = m.routes && migrationFor(m)?.change !== "params" ? null : migrationFor(m);
  if (mig && m.replacement) faq.push({ q: `Is ${m.replacement} a drop-in replacement for ${m.id}?`, a: mig.drop_in
    ? `In most code, yes: change the model name.${mig.note ? " " + mig.note : ""} Answers can still differ, so test your prompts on it before you switch.`
    : `Not quite. ${mig.note}${mig.guide ? ` ${who}'s guide: ${mig.guide}` : ""} Then test your prompts on it before you switch.` });
  faq.push({ q: `How do I find ${m.id} in my code?`, a: `Run "npx -y @aidriftline/driftline ." in your repository. It finds OpenAI, Anthropic, Google and Amazon Bedrock model IDs, including aliases and Vertex names, and lists each one's retirement date and replacement.` });

  const rows = [
    ["Provider", who],
    ["Status", `${status(m)} <span class="dim">(as of ${short(reg.checked)})</span>`],
    [dateKind(m), long(m.retires) + (m.under_review ? ` <span class="dim">· under review: ${esc(WHO[m.provider] || m.provider)}'s page changed on ${short(m.under_review.since)}, Driftline is updating this. <a href="${esc(m.under_review.page)}" rel="noopener">Check the source</a></span>` : "")],
    ...(m.replacement ? [["Replacement", link(m.replacement) + (m.replacement_alt ? ` or ${link(m.replacement_alt)}` : "") + (m.replacement_note ? ` <span class="dim">(${esc(m.replacement_note)})</span>` : "") + (m.previous_replacement ? ` <span class="dim">· changed ${short(m.replacement_changed)}, was ${esc(m.previous_replacement)}</span>` : "") + (r && r !== m.replacement ? ` → move to ${link(r)}` : "")]] : []),
    ...(mig && m.replacement ? [["Moving to it", `${mig.drop_in ? "Rename" : esc(MIGRATION_LABEL[mig.change])}${mig.note && !(mig.change === "settings") ? ` <span class="dim">· ${esc(mig.note)}${mig.guide ? ` <a href="${esc(mig.guide)}" rel="noopener">${esc(who)}'s guide</a>` : ""}</span>` : ""}`]] : []),
    ...(m.aliasOf ? [["Short name for", link(m.aliasOf)]] : []),
    ...(azOf(m) && azOf(m).v.retires !== m.retires ? [["On Azure", `${azLink(azOf(m).a.id)}${azOf(m).v.version ? ` <span class="dim">version ${esc(azOf(m).v.version)}</span>` : ""} · ${azOf(m).v.retires <= TODAY ? "retired" : "retires"} ${short(azOf(m).v.retires)} <span class="dim">(Azure sets its own date)</span>`]] : []),
    ...(vxOf(m) && vxOf(m).retires !== m.retires ? [["On Vertex AI", `${vxLink(vxOf(m).id)} · ${vxOf(m).retires <= TODAY ? "retired" : "retires"} ${short(vxOf(m).retires)} <span class="dim">(Vertex sets its own date)</span>`]] : []),
    ["Model type", KIND[kind] || kind],
    ...(m.announced ? [["Announced", long(m.announced)]] : []),
    ["Source", `<a href="${esc(reg.sources[m.provider])}" rel="noopener">${who} deprecations page</a>`],
  ];
  const body = `    <p class="crumbs"><a href="/models/">Model retirement dates</a> / ${who}</p>
    <h1 class="model-h1"><code>${esc(m.id)}</code></h1>
    <p class="answer">${esc(text)}</p>
    <table class="kv"><tbody>
${rows.map(([k, v]) => `      <tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("\n")}
    </tbody></table>
${kind === "text" ? `
    <h2>Before you switch</h2>
    <p>A replacement model answers the same prompt differently: tone, length, format, and whether JSON still parses. ${past(m) && !m.replacement ? "Pick the new model yourself and test your prompts on it before you ship." : past(m) && m.qualifier === "exact" && !m.routes
      ? `Driftline Pro runs your real prompts on ${esc(r || m.replacement)} in CI, so you see the new answers before you ship the switch.`
      : `Driftline Pro runs your real prompts on ${esc(m.id)} and ${esc(r || m.replacement || "the replacement")} side by side in CI and shows what changed.`} <a href="/#drift">See a drift test</a>.</p>` : ""}
${past(m) ? "" : ALERT_BLOCK(m)}
${CHECK_BLOCK(m.id)}
${same.length ? `
    <h2>Same date at ${who}</h2>
    <p class="ids">${same.map((o) => link(o.id)).join(" ")}</p>` : ""}
    <p class="updated" style="margin-top:48px">Checked against ${who}'s official page on ${long(reg.checked)}. Something wrong? <a href="mailto:hello@aidriftline.com">hello@aidriftline.com</a></p>`;
  const jsonld = [
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Model retirement dates", item: `${SITE}/models/` },
      { "@type": "ListItem", position: 2, name: m.id, item: `${SITE}${url(m.id)}` },
    ] },
  ];
  const dir = join(ROOT, "models", m.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page({ path: url(m.id), title, description: text, body, jsonld }));
}

// ---------- the full list ----------
const upcoming = models.filter((m) => !past(m));
const gone = models.filter(past).reverse();
const table = (list) => `    <div class="table-scroll"><table class="list">
      <thead><tr><th scope="col">Model</th><th scope="col">Provider</th><th scope="col">Date</th><th scope="col">Replacement</th></tr></thead>
      <tbody>
${list.map((m) => `        <tr><td>${link(m.id)}${m.kind && m.kind !== "text" ? ` <span class="dim">${m.kind}</span>` : ""}</td><td>${WHO[m.provider]}</td><td>${short(m.retires)}${m.routes ? " <span class=\"dim\">routing</span>" : m.qualifier === "earliest" ? " <span class=\"dim\">earliest</span>" : m.qualifier === "not-before" ? " <span class=\"dim\">not before</span>" : ""}</td><td>${m.replacement ? `<code>${esc(m.replacement)}</code>` : ""}</td></tr>`).join("\n")}
      </tbody>
    </table></div>`;
const listDesc = `Retirement and shutdown dates for ${models.length} OpenAI, Anthropic and Google model IDs, with recommended replacements. From the providers' official deprecation pages, checked ${long(reg.checked)}.`;
writeFileSync(join(ROOT, "models", "index.html"), page({
  path: "/models/",
  title: "AI model retirement dates: OpenAI, Anthropic, Google · Driftline",
  description: listDesc,
  body: `    <span class="eyebrow">Registry</span>
    <h1>AI model retirement dates</h1>
    <p class="updated">${models.length} model IDs · checked ${long(reg.checked)}</p>
    <p class="answer">Every OpenAI, Anthropic and Google model ID that has a published retirement date, with the recommended replacement. Dates come from the providers' official pages (<a href="${reg.sources.openai}" rel="noopener">OpenAI</a>, <a href="${reg.sources.anthropic}" rel="noopener">Anthropic</a>, <a href="${reg.sources.google}" rel="noopener">Google</a>). Google publishes earliest dates only, and routes some old IDs to newer models instead of switching them off. Anthropic's dates are "not sooner than".</p>
    <p>To check your own code against this list: <code>npx -y @aidriftline/driftline .</code> · Machine-readable: <a href="/models.json">/models.json</a></p>
    <p>Get new dates as they are announced: <a href="/feed.xml">RSS feed</a> · <a href="webcal://aidriftline.com/retirements.ics">add to your calendar</a> (<a href="https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Faidriftline.com%2Fretirements.ics" rel="noopener">Google Calendar</a>, or subscribe to <code>${SITE}/retirements.ics</code>) · <a href="https://x.com/aidriftline" rel="noopener">@aidriftline on X</a></p>
    <p>On Amazon Bedrock? Bedrock sets its own dates, per model and region: <a href="/models/bedrock/">${bedrock.length} Bedrock retirement dates</a>.${vertex.length ? ` On Google Vertex AI? Vertex uses the Gemini API's model names with its own dates: <a href="/models/vertex/">${vertex.length} Vertex retirement dates</a>.` : ""}${azure.length ? ` On Azure? Azure sets its own date for every model version: <a href="/models/azure/">${azure.length} Azure retirement dates</a>.` : ""}</p>
    <h2>Coming up (${upcoming.length})</h2>
${table(upcoming)}
    <h2>Already past (${gone.length})</h2>
${table(gone)}`,
  jsonld: [{ "@context": "https://schema.org", "@type": "Dataset", name: "AI model retirement dates", description: listDesc, url: `${SITE}/models/`,
    dateModified: reg.checked, license: "https://github.com/AI-Driftline/driftline/blob/main/LICENSE", creator: { "@type": "Organization", name: "Driftline", url: SITE },
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/models.json` }] }],
}));

// ---------- Amazon Bedrock: its own dates, per model and region (registry platforms.bedrock) ----------
// Bedrock IDs contain ":" (…-v1:0); the page address uses "-" instead.
const MAKER = { ai21: "AI21 Labs", amazon: "Amazon", anthropic: "Anthropic", cohere: "Cohere", deepseek: "DeepSeek", google: "Google", meta: "Meta", minimax: "MiniMax", mistral: "Mistral AI", moonshot: "Moonshot AI", nvidia: "NVIDIA", openai: "OpenAI", qwen: "Qwen", twelvelabs: "TwelveLabs", writer: "Writer", zai: "Z.AI", stability: "Stability AI", luma: "Luma AI" };
const brUrl = (id) => `/models/bedrock/${id.replace(/:/g, "-")}/`;
const brLink = (id) => `<a href="${brUrl(id)}"><code>${esc(id)}</code></a>`;
const regionList = (g) => g.regions.length > 6 ? `${g.regions.slice(0, 6).join(", ")} and ${g.regions.length - 6} more` : g.regions.join(", ");
// Anthropic's own entry for a Claude model on Bedrock (anthropic.claude-…-v1:0 → claude-…), to show both dates.
const anthropicBase = (pm) => pm.maker === "anthropic" ? byId.get(pm.id.replace(/^anthropic\./, "").replace(/-v\d+(?::\d+)?$/, "")) : null;
function brAnswer(pm) {
  const name = `${pm.name || pm.id} (${pm.id})`;
  const d = long(pm.retires);
  let s = pm.retires <= TODAY
    ? `Amazon Bedrock retired ${name} on ${d}${pm.regions.length > 1 ? " in its first regions" : ""}. Calls to it there now fail.`
    : `Amazon Bedrock will retire ${name} on ${d}${pm.regions.length > 1 ? " in its first regions" : ""}. After that, calls to it fail.`;
  if (pm.regions.length > 1) { const last = pm.regions[pm.regions.length - 1]; s += ` Other regions follow, the last on ${long(last.retires)}.`; }
  if (pm.extended && pm.retires > TODAY) s += pm.extended <= TODAY ? ` It has been in extended access since ${long(pm.extended)}, when the model maker may charge more.` : ` Extended access, when the model maker may charge more, starts ${long(pm.extended)}.`;
  const base = anthropicBase(pm);
  if (base) s += ` On Anthropic's own API the date is different (${long(base.retires)}). Bedrock names no replacement; Anthropic's is ${replName(base)}, which has its own Bedrock model ID.`;
  else s += " Bedrock names no replacement.";
  return s;
}
rmSync(join(ROOT, "models", "bedrock"), { recursive: true, force: true });
for (const pm of bedrock) {
  const maker = MAKER[pm.maker] || pm.maker;
  const base = anthropicBase(pm);
  const text = brAnswer(pm);
  const regionsTable = `    <div class="table-scroll"><table class="list">
      <thead><tr><th scope="col">Regions</th><th scope="col">Legacy since</th><th scope="col">Extended access</th><th scope="col">Retires (EOL)</th></tr></thead>
      <tbody>
${pm.regions.map((g) => `        <tr><td>${esc(regionList(g))}</td><td>${g.legacy ? short(g.legacy) : "—"}</td><td>${g.extended ? short(g.extended) : "—"}</td><td>${short(g.retires)}</td></tr>`).join("\n")}
      </tbody>
    </table></div>`;
  const rows = [
    ["Platform", "Amazon Bedrock"],
    ["Model", `${esc(pm.name || pm.id)} <span class="dim">by ${esc(maker)}</span>`],
    ["Status", `${pm.retires <= TODAY ? "Retired" + (pm.regions.length > 1 ? " in some regions" : "") : "Legacy, retiring"} <span class="dim">(as of ${short(BR.checked || reg.checked)})</span>`],
    [pm.regions.length > 1 ? "First shutdown" : "Shutdown", long(pm.retires)],
    ...(base ? [["On Anthropic's API", `${link(base.id)} · ${short(base.retires)}`], ["Anthropic's replacement", link(base.replacement) + ' <span class="dim">(use its Bedrock model ID)</span>']] : []),
    ["Model type", KIND[pm.kind] || pm.kind],
    ["Source", `<a href="${esc(BR.source)}" rel="noopener">Amazon Bedrock model lifecycle page</a>`],
  ];
  const same = bedrock.filter((o) => o.id !== pm.id && o.retires === pm.retires).slice(0, 12);
  const faq = [{ q: `When does Amazon Bedrock retire ${pm.id}?`, a: text }];
  if (base) faq.push({ q: `Is the Bedrock date the same as Anthropic's?`, a: `No. Bedrock sets its own dates: ${short(pm.retires)} on Bedrock, ${short(base.retires)} on Anthropic's API. For Bedrock calls, only Bedrock's date applies.` });
  const body = `    <p class="crumbs"><a href="/models/">Model retirement dates</a> / <a href="/models/bedrock/">Amazon Bedrock</a></p>
    <h1 class="model-h1"><code>${esc(pm.id)}</code></h1>
    <p class="answer">${esc(text)}</p>
    <table class="kv"><tbody>
${rows.map(([k, v]) => `      <tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("\n")}
    </tbody></table>
    <h2>Dates by region</h2>
    <p>Bedrock retires a model region by region. During the legacy period new customers can't start using it and existing ones may lose access after 15 days without calls.</p>
${regionsTable}
${pm.retires <= TODAY && pm.regions.every((g) => g.retires <= TODAY) ? "" : ALERT_BLOCK({ ...pm, provider: "bedrock" })}
${CHECK_BLOCK(pm.id)}
${same.length ? `
    <h2>Same date on Bedrock</h2>
    <p class="ids">${same.map((o) => brLink(o.id)).join(" ")}</p>` : ""}
    <p class="updated" style="margin-top:48px">Read from Amazon Bedrock's official page on ${long(BR.checked || reg.checked)}, checked every 6 hours. Something wrong? <a href="mailto:hello@aidriftline.com">hello@aidriftline.com</a></p>`;
  const dir = join(ROOT, "models", "bedrock", pm.id.replace(/:/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page({ path: brUrl(pm.id), title: `${pm.id} on Amazon Bedrock: retires ${short(pm.retires)} · Driftline`, description: text, body, jsonld: [
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Model retirement dates", item: `${SITE}/models/` },
      { "@type": "ListItem", position: 2, name: "Amazon Bedrock", item: `${SITE}/models/bedrock/` },
      { "@type": "ListItem", position: 3, name: pm.id, item: `${SITE}${brUrl(pm.id)}` },
    ] },
  ] }));
}
if (bedrock.length) {
  // Coming up: each model's next date that hasn't passed yet; "already retired" lists the last date.
  const nextDate = (pm) => pm.regions.map((g) => g.retires).filter((d) => d > TODAY).sort()[0];
  const brTable = (list, upcoming) => `    <div class="table-scroll"><table class="list">
      <thead><tr><th scope="col">Model ID</th><th scope="col">Maker</th><th scope="col">Retires</th><th scope="col">Regions</th></tr></thead>
      <tbody>
${list.map((pm) => `        <tr><td>${brLink(pm.id)}${pm.kind && pm.kind !== "text" ? ` <span class="dim">${pm.kind}</span>` : ""}</td><td>${esc(MAKER[pm.maker] || pm.maker)}</td><td>${upcoming ? short(nextDate(pm)) + (pm.retires <= TODAY ? ` <span class="dim">earlier in some regions</span>` : pm.regions.length > 1 ? ` <span class="dim">first</span>` : "") : short(pm.regions[pm.regions.length - 1].retires)}</td><td>${pm.regions.length > 1 ? `${pm.regions.length} dates` : esc(regionList(pm.regions[0]))}</td></tr>`).join("\n")}
      </tbody>
    </table></div>`;
  const brUp = bedrock.filter((pm) => pm.regions.some((g) => g.retires > TODAY)).sort((a, b) => nextDate(a).localeCompare(nextDate(b)) || a.id.localeCompare(b.id)), brGone = bedrock.filter((pm) => pm.regions.every((g) => g.retires <= TODAY)).reverse();
  const brDesc = `Retirement (end-of-life) dates for ${bedrock.length} Amazon Bedrock model IDs, per region, from AWS's own model lifecycle page. Bedrock's dates often differ from the model maker's.`;
  writeFileSync(join(ROOT, "models", "bedrock", "index.html"), page({
    path: "/models/bedrock/", title: "Amazon Bedrock model retirement dates (EOL) · Driftline", description: brDesc,
    body: `    <p class="crumbs"><a href="/models/">Model retirement dates</a> / Amazon Bedrock</p>
    <span class="eyebrow">Amazon Bedrock</span>
    <h1>Bedrock model retirement dates</h1>
    <p class="updated">${bedrock.length} model IDs · read from AWS ${long(BR.checked || reg.checked)}, checked every 6 hours</p>
    <p class="answer">Amazon Bedrock sets its own end-of-life dates, per model and per region, and they often differ from the model maker's. Claude Opus 4.1 left Anthropic's API on 5 August 2026 but runs on Bedrock until 8 January 2027. For Bedrock calls, only Bedrock's dates apply. Source: <a href="${esc(BR.source)}" rel="noopener">Amazon Bedrock model lifecycle</a>.</p>
    <p>Check your code: <code>npx -y @aidriftline/driftline .</code> reads Bedrock model IDs, cross-region profiles (<code>us.anthropic.…</code>) and ARNs.</p>
    <h2>Coming up (${brUp.length})</h2>
${brTable(brUp, true)}
    <h2>Already retired everywhere (${brGone.length})</h2>
${brTable(brGone, false)}`,
    jsonld: [{ "@context": "https://schema.org", "@type": "Dataset", name: "Amazon Bedrock model retirement dates", description: brDesc, url: `${SITE}/models/bedrock/`, dateModified: BR.checked || reg.checked,
      creator: { "@type": "Organization", name: "Driftline", url: SITE }, distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/models.json` }] }],
  }));
}

// ---------- Google Vertex AI: its own dates (registry platforms.vertex) ----------
const VX_MAKER = { google: "Google", anthropic: "Anthropic", ai21: "AI21 Labs", deepseek: "DeepSeek", zai: "Z.AI", openai: "OpenAI", moonshot: "Moonshot AI", meta: "Meta", minimax: "MiniMax", qwen: "Qwen", mistral: "Mistral AI", other: "Open model" };
const vxSource = (v) => VX.sources?.[v.page] || VX.source;
function vxAnswer(v) {
  const d = long(v.retires);
  let s = v.retires <= TODAY ? `Google Vertex AI retired ${v.id} on ${d}. Calls to it on Vertex now fail.` : `Google Vertex AI will retire ${v.id} on ${d}. After that, calls to it on Vertex fail.`;
  if (v.replacement) s += ` Vertex recommends ${v.replacement}${v.replacement_alt ? ` or ${v.replacement_alt}` : ""}.`;
  const twin = vxTwinOf(v);
  if (twin) s += ` On ${v.maker === "google" ? "the Gemini API" : "Anthropic's own API"} the date is different: ${twin.routes ? (twin.retires <= TODAY ? "routed to a newer model since" : "routed to a newer model from") : twin.retires <= TODAY ? "retired" : "retires"} ${long(twin.retires)}.`;
  if (!v.replacement && v.maker === "anthropic" && twin?.replacement) s += ` Vertex names no replacement; Anthropic's is ${replName(twin)}.`;
  return s;
}
rmSync(join(ROOT, "models", "vertex"), { recursive: true, force: true });
for (const v of vertex) {
  const twin = vxTwinOf(v);
  const text = vxAnswer(v);
  const rows = [
    ["Platform", `Google Vertex AI <span class="dim">(Gemini Enterprise Agent Platform)</span>`],
    ["Model", `<code>${esc(v.id)}</code> <span class="dim">by ${esc(v.name ? `${VX_MAKER[v.maker] || v.maker} · ${v.name}` : VX_MAKER[v.maker] || v.maker)}</span>`],
    ["Status", `${v.retires <= TODAY ? "Retired" : "Retiring"} <span class="dim">(as of ${short(VX.checked || reg.checked)})</span>`],
    ["Shutdown", long(v.retires)],
    ...(v.replacement ? [["Replacement", vxLink(v.replacement) + (v.replacement_alt ? ` or ${vxLink(v.replacement_alt)}` : "") + ' <span class="dim">(named by Vertex)</span>']] : []),
    ...(twin ? [[v.maker === "google" ? "On the Gemini API" : "On Anthropic's API", `${link(twin.id)} · ${twin.routes ? "routed" : twin.retires <= TODAY ? "retired" : "retires"} ${short(twin.retires)}`]] : []),
    ...(!v.replacement && v.maker === "anthropic" && twin?.replacement ? [["Anthropic's replacement", link(twin.replacement)]] : []),
    ["Model type", KIND[v.kind] || v.kind],
    ...(v.released ? [["Released", long(v.released)]] : []),
    ["Source", `<a href="${esc(vxSource(v))}" rel="noopener">Google Cloud: ${v.page === "partner" ? "partner model deprecations" : v.page === "open" ? "open model deprecations" : "model versions and lifecycle"}</a>`],
  ];
  const same = vertex.filter((o) => o.id !== v.id && o.retires === v.retires).slice(0, 12);
  const faq = [{ q: `When does Vertex AI retire ${v.id}?`, a: text }];
  if (twin) faq.push({ q: `Is the Vertex AI date the same as ${v.maker === "google" ? "the Gemini API's" : "Anthropic's"}?`, a: `No. Vertex sets its own dates: ${short(v.retires)} on Vertex, ${short(twin.retires)} on ${v.maker === "google" ? "the Gemini API" : "Anthropic's API"}. For calls through Vertex AI, only Vertex's date applies.` });
  const body = `    <p class="crumbs"><a href="/models/">Model retirement dates</a> / <a href="/models/vertex/">Vertex AI</a></p>
    <h1 class="model-h1"><code>${esc(v.id)}</code> <span class="dim" style="font-size:.5em">on Vertex AI</span></h1>
    <p class="answer">${esc(text)}</p>
    <table class="kv"><tbody>
${rows.map(([k, val]) => `      <tr><th scope="row">${k}</th><td>${val}</td></tr>`).join("\n")}
    </tbody></table>
    <h2>How Driftline tells Vertex from the Gemini API</h2>
    <p>Vertex uses the same model names as the Gemini API${v.maker === "anthropic" ? " and Anthropic" : ""}. Driftline uses Vertex's dates in files that show they run on Vertex: <code>vertexai=True</code>, <code>vertexai</code> or <code>google.cloud.aiplatform</code> imports, <code>@google-cloud/vertexai</code>, <code>AnthropicVertex</code>, <code>vertex_ai/</code> model names, Claude's <code>@date</code> spelling and <code>-maas</code> IDs. Elsewhere it uses the Gemini API's dates and notes when Vertex's differ.</p>
${v.retires <= TODAY ? "" : ALERT_BLOCK({ ...v, id: `vertex:${v.id}`, provider: "vertex" })}
${CHECK_BLOCK(v.id)}
${same.length ? `
    <h2>Same date on Vertex AI</h2>
    <p class="ids">${same.map((o) => vxLink(o.id)).join(" ")}</p>` : ""}
    <p class="updated" style="margin-top:48px">Read from Google Cloud's official pages on ${long(VX.checked || reg.checked)}, checked every 6 hours. Something wrong? <a href="mailto:hello@aidriftline.com">hello@aidriftline.com</a></p>`;
  const dir = join(ROOT, "models", "vertex", vxSlug(v.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page({ path: vxUrl(v.id), title: `${v.id} on Vertex AI: ${v.retires <= TODAY ? "retired" : "retires"} ${short(v.retires)} · Driftline`, description: text, body, jsonld: [
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Model retirement dates", item: `${SITE}/models/` },
      { "@type": "ListItem", position: 2, name: "Vertex AI", item: `${SITE}/models/vertex/` },
      { "@type": "ListItem", position: 3, name: v.id, item: `${SITE}${vxUrl(v.id)}` },
    ] },
  ] }));
}
if (vertex.length) {
  const vxTable = (list) => `    <div class="table-scroll"><table class="list">
      <thead><tr><th scope="col">Model ID</th><th scope="col">Maker</th><th scope="col">Date on Vertex</th><th scope="col">Gemini API / Anthropic</th></tr></thead>
      <tbody>
${list.map((v) => { const t = vxTwinOf(v); return `        <tr><td>${vxLink(v.id)}${v.kind && v.kind !== "text" ? ` <span class="dim">${v.kind}</span>` : ""}</td><td>${esc(VX_MAKER[v.maker] || v.maker)}</td><td>${short(v.retires)}</td><td>${t ? `${link(t.id)} <span class="dim">${short(t.retires)}</span>` : '<span class="dim">—</span>'}</td></tr>`; }).join("\n")}
      </tbody>
    </table></div>`;
  const vxUp = vertex.filter((v) => v.retires > TODAY), vxGone = vertex.filter((v) => v.retires <= TODAY).reverse();
  const vxDesc = `Retirement dates for ${vertex.length} Google Vertex AI model IDs (Gemini, Imagen, Veo, embeddings, Claude and open models), from Google Cloud's own pages. Vertex uses the Gemini API's model names with its own dates.`;
  writeFileSync(join(ROOT, "models", "vertex", "index.html"), page({
    path: "/models/vertex/", title: "Vertex AI model retirement dates · Driftline", description: vxDesc,
    body: `    <p class="crumbs"><a href="/models/">Model retirement dates</a> / Vertex AI</p>
    <span class="eyebrow">Google Vertex AI</span>
    <h1>Vertex AI model retirement dates</h1>
    <p class="updated">${vertex.length} model IDs · read from Google Cloud ${long(VX.checked || reg.checked)}, checked every 6 hours</p>
    <p class="answer">Google Vertex AI (now part of Gemini Enterprise Agent Platform) uses the Gemini API's model names but sets its own retirement dates, and they often differ: gemini-2.5-pro was retired on Vertex on 20 October 2026 while the Gemini API keeps answering it until 1 December, when it routes to a newer model. For calls through Vertex, only Vertex's dates apply. Sources: <a href="${esc(VX.sources?.gemini || VX.source)}" rel="noopener">model versions</a>, <a href="${esc(VX.sources?.partner || VX.source)}" rel="noopener">partner models</a>, <a href="${esc(VX.sources?.open || VX.source)}" rel="noopener">open models</a>.</p>
    <p>Check your code: <code>npx -y @aidriftline/driftline .</code> uses Vertex's dates in files that run on Vertex.</p>
    <h2>Coming up (${vxUp.length})</h2>
${vxTable(vxUp)}
    <h2>Already retired (${vxGone.length})</h2>
${vxTable(vxGone)}`,
    jsonld: [{ "@context": "https://schema.org", "@type": "Dataset", name: "Google Vertex AI model retirement dates", description: vxDesc, url: `${SITE}/models/vertex/`, dateModified: VX.checked || reg.checked,
      creator: { "@type": "Organization", name: "Driftline", url: SITE }, distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/models.json` }] }],
  }));
}

// ---------- Microsoft Azure: its own date per model version (registry platforms.azure) ----------
const AZ_MAKER = { openai: "OpenAI", anthropic: "Anthropic", meta: "Meta", microsoft: "Microsoft", mistral: "Mistral AI", moonshot: "Moonshot AI", xai: "xAI", deepseek: "DeepSeek", cohere: "Cohere", bfl: "Black Forest Labs", stability: "Stability AI", nixtla: "Nixtla", ntt: "NTT Data", fireworks: "Fireworks" };
const azStatus = (v) => v.retires <= TODAY ? "Retired" : azCurrent(v) ? `${v.lifecycle}, end planned` : v.lifecycle || "Retiring";
function azAnswer(a) {
  const vs = a.versions, first = vs[0];
  const one = (v) => `${v.version && v.version !== "—" ? `version ${v.version} ` : ""}${v.retires <= TODAY ? "retired" : "retires"} on ${long(v.retires)}`;
  let s = vs.length > 1 ? `On Azure, ${a.id} retires version by version: ${vs.map(one).join("; ")}.` : `On Azure, ${a.id} ${one(first).replace(/^version \S+ /, "")}${first.version && first.version !== "—" ? ` (version ${first.version})` : ""}.`;
  if (vs.every((v) => azCurrent(v)) && first.retires > TODAY) s += " It is a current model: Azure plans an end date for every model ahead of time.";
  if (a.replacement) s += ` Azure recommends ${a.replacement}.`;
  const twin = azTwin(a, first);
  if (twin && a.maker === "openai") s += ` On OpenAI's own API the date is different: ${twin.retires <= TODAY ? "retired" : "retires"} ${long(twin.retires)}.`;
  return s;
}
rmSync(join(ROOT, "models", "azure"), { recursive: true, force: true });
for (const a of azure) {
  const text = azAnswer(a);
  const twin = a.maker === "openai" ? azTwin(a, a.versions[0]) : null;
  const rows = [
    ["Platform", `Microsoft Azure <span class="dim">(Azure OpenAI / Foundry Models)</span>`],
    ["Model", `<code>${esc(a.id)}</code> <span class="dim">by ${esc(AZ_MAKER[a.maker] || a.maker)}</span>`],
    ["Status", `${azStatus(a.versions[0])} <span class="dim">(as of ${short(AZ.checked || reg.checked)})</span>`],
    [a.versions.length > 1 ? "First retirement" : "Retirement", long(a.retires)],
    ...(a.replacement ? [["Replacement", `${link(a.replacement)} <span class="dim">(named by Azure)</span>`]] : []),
    ...(twin ? [["On OpenAI's API", `${link(twin.id)} · ${twin.retires <= TODAY ? "retired" : "retires"} ${short(twin.retires)}`]] : []),
    ["Model type", KIND[a.kind] || a.kind],
    ["Source", `<a href="${esc(AZ.source)}" rel="noopener">Microsoft: model retirement schedule</a>`],
  ];
  const versions = `    <div class="table-scroll"><table class="list">
      <thead><tr><th scope="col">Version</th><th scope="col">Lifecycle</th><th scope="col">Retires</th><th scope="col">Replacement</th></tr></thead>
      <tbody>
${a.versions.map((v) => `        <tr><td><code>${esc(v.version || "—")}</code></td><td>${esc(v.lifecycle || "—")}</td><td>${short(v.retires)}</td><td>${v.replacement ? `<code>${esc(v.replacement)}</code>${v.replacement_version ? ` <span class="dim">${esc(v.replacement_version)}</span>` : ""}` : '<span class="dim">—</span>'}</td></tr>`).join("\n")}
      </tbody>
    </table></div>`;
  const faq = [{ q: `When does Azure retire ${a.id}?`, a: text }];
  if (twin) faq.push({ q: `Is the Azure date the same as OpenAI's?`, a: `No. Azure sets its own date for each model version: ${short(a.retires)} on Azure${a.versions.length > 1 ? " (earliest version)" : ""}, ${short(twin.retires)} on OpenAI's API. For calls through Azure, only Azure's date applies.` });
  const body = `    <p class="crumbs"><a href="/models/">Model retirement dates</a> / <a href="/models/azure/">Azure</a></p>
    <h1 class="model-h1"><code>${esc(a.id)}</code> <span class="dim" style="font-size:.5em">on Azure</span></h1>
    <p class="answer">${esc(text)}</p>
    <table class="kv"><tbody>
${rows.map(([k, val]) => `      <tr><th scope="row">${k}</th><td>${val}</td></tr>`).join("\n")}
    </tbody></table>
    <h2>Dates by version</h2>
    <p>Azure retires each model version on its own date. Check which version your deployment uses (deployment details in the Azure portal, or <code>version</code> in your Bicep or Terraform).</p>
${versions}
    <h2>How Driftline tells Azure from OpenAI's API</h2>
    <p>Azure uses OpenAI's model names. Driftline uses Azure's dates in files that show they call Azure: <code>AzureOpenAI</code>, <code>azure_endpoint</code>, <code>openai.azure.com</code>, <code>AZURE_OPENAI_…</code>, <code>azure/</code> model names, and Bicep or Terraform deployments, where it also reads the model version (never <code>api_version</code>). Elsewhere it uses OpenAI's dates and notes when Azure's differ.</p>
${a.versions.every((v) => v.retires <= TODAY) ? "" : ALERT_BLOCK({ ...a, id: `azure:${a.id}`, provider: "azure" })}
${CHECK_BLOCK(a.id)}
    <p class="updated" style="margin-top:48px">Read from Microsoft's official schedule on ${long(AZ.checked || reg.checked)}, checked every 6 hours. Something wrong? <a href="mailto:hello@aidriftline.com">hello@aidriftline.com</a></p>`;
  const dir = join(ROOT, "models", "azure", azSlug(a.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page({ path: azUrl(a.id), title: `${a.id} on Azure: ${a.retires <= TODAY ? "retired" : "retires"} ${short(a.retires)}${a.versions.length > 1 ? " (first version)" : ""} · Driftline`, description: text, body, jsonld: [
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(({ q, a: ans }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: ans } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Model retirement dates", item: `${SITE}/models/` },
      { "@type": "ListItem", position: 2, name: "Azure", item: `${SITE}/models/azure/` },
      { "@type": "ListItem", position: 3, name: a.id, item: `${SITE}${azUrl(a.id)}` },
    ] },
  ] }));
}
if (azure.length) {
  const next = (a) => a.versions.map((v) => v.retires).filter((d) => d > TODAY).sort()[0];
  const azTable = (list, mode) => `    <div class="table-scroll"><table class="list">
      <thead><tr><th scope="col">Model</th><th scope="col">Maker</th><th scope="col">${mode === "gone" ? "Retired" : "Next date"}</th><th scope="col">Versions</th><th scope="col">OpenAI's API</th></tr></thead>
      <tbody>
${list.map((a) => { const t = a.maker === "openai" ? azTwin(a, a.versions[0]) : null; return `        <tr><td>${azLink(a.id)}${a.kind && a.kind !== "text" ? ` <span class="dim">${a.kind}</span>` : ""}</td><td>${esc(AZ_MAKER[a.maker] || a.maker)}</td><td>${short(mode === "gone" ? a.versions[a.versions.length - 1].retires : next(a))}</td><td>${a.versions.length}</td><td>${t ? `${link(t.id)} <span class="dim">${short(t.retires)}</span>` : '<span class="dim">—</span>'}</td></tr>`; }).join("\n")}
      </tbody>
    </table></div>`;
  const live = azure.filter((a) => next(a)).sort((x, y) => next(x).localeCompare(next(y)) || x.id.localeCompare(y.id));
  const retiring = live.filter((a) => a.versions.some((v) => v.retires > TODAY && !azCurrent(v)) || next(a) <= new Date(Date.parse(TODAY) + 90 * 86400000).toISOString().slice(0, 10));
  const current = live.filter((a) => !retiring.includes(a));
  const gone = azure.filter((a) => !next(a)).reverse();
  const azDesc = `Retirement dates for ${azure.length} Azure OpenAI and Foundry models (OpenAI, Claude, Llama, Mistral, xAI, DeepSeek, Cohere and more), per model version, from Microsoft's own schedule. Azure's dates often differ from the model maker's.`;
  writeFileSync(join(ROOT, "models", "azure", "index.html"), page({
    path: "/models/azure/", title: "Azure OpenAI model retirement dates · Driftline", description: azDesc,
    body: `    <p class="crumbs"><a href="/models/">Model retirement dates</a> / Azure</p>
    <span class="eyebrow">Microsoft Azure</span>
    <h1>Azure model retirement dates</h1>
    <p class="updated">${azure.length} models · read from Microsoft ${long(AZ.checked || reg.checked)}, checked every 6 hours</p>
    <p class="answer">Azure (Azure OpenAI and Foundry Models) uses OpenAI's model names but sets its own retirement date for every model version, and it differs in both directions: o3 retires on Azure on 19 November 2026, three weeks before OpenAI's 11 December, while gpt-5 lasts on Azure until 9 February 2027. For calls through Azure, only Azure's dates apply. Source: <a href="${esc(AZ.source)}" rel="noopener">Microsoft model retirement schedule</a>.</p>
    <p>Check your code: <code>npx -y @aidriftline/driftline .</code> uses Azure's dates in files that call Azure, and reads the model version from Bicep and Terraform deployments.</p>
    <h2>Retiring (${retiring.length})</h2>
    <p class="dim">Deprecated or legacy versions, and any model within 90 days of its date.</p>
${azTable(retiring)}
    <h2>Current models with a planned end (${current.length})</h2>
    <p class="dim">Azure plans an end date for every model ahead of time. These are current (GA or preview).</p>
${azTable(current)}
    <h2>Already retired (${gone.length})</h2>
${azTable(gone, "gone")}`,
    jsonld: [{ "@context": "https://schema.org", "@type": "Dataset", name: "Azure OpenAI model retirement dates", description: azDesc, url: `${SITE}/models/azure/`, dateModified: AZ.checked || reg.checked,
      creator: { "@type": "Organization", name: "Driftline", url: SITE }, distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/models.json` }] }],
  }));
}

// ---------- data + files for crawlers and agents ----------
// Each entry also says whether moving to its replacement is more than a rename (rules: product src/migration.js).
const withMigration = reg.models.map((m) => { const mig = migrationFor(m); return mig && mig.change !== "rename" ? { ...m, migration: mig } : m; });
writeFileSync(join(ROOT, "models.json"), JSON.stringify({ ...reg, models: withMigration, url: `${SITE}/models.json`, pages: `${SITE}/models/<id>/` }, null, 2) + "\n");

const LLMS = `# Driftline

> Driftline is a GitHub Action and CLI that finds OpenAI, Anthropic, Google, Amazon Bedrock, Vertex AI and Azure model IDs in a codebase, warns before those models are retired, and (Pro) runs your real prompts on the current and the replacement model to show what changes. It runs in your own CI with your own API keys; there is no Driftline server.

- Free scan: \`npx -y @aidriftline/driftline .\` in any repository (no install, no key). Add \`--json\` for machine-readable output. Exit code 1 = a retired model is used in code.
- GitHub Action: \`uses: AI-Driftline/driftline@v0\` (Marketplace: "Driftline AI Model Check"). Annotates the file and line, writes a job summary, can open one self-updating issue and fail the build.
- Pro: drift tests on your prompts. $19/month or $190/year, one key covers up to 3 GitHub accounts or organizations.
- Tracks ${models.length} model IDs (checked ${reg.checked}), including Bedrock, Vertex and OpenRouter spellings and Claude short names.
- License: Elastic License 2.0 (source available). Contact: hello@aidriftline.com

## Retirement data

- [All retirement dates](${SITE}/models/): every tracked model with date, replacement and source
- [models.json](${SITE}/models.json): the same data as JSON (fields: id, provider, retires, qualifier exact|earliest|not-before, replacement, kind, routes)
- Per model: ${SITE}/models/<model-id>/ (for example ${SITE}/models/gemini-2.5-pro/)
- [RSS feed](${SITE}/feed.xml) and [calendar](${SITE}/retirements.ics) of retirement dates
${azure.length ? `- [Azure dates](${SITE}/models/azure/): ${azure.length} Azure OpenAI and Foundry models with Azure's own retirement date per model version, read from Microsoft's schedule every 6 hours. They differ from OpenAI's in both directions (o3: Azure 19 Nov 2026, OpenAI 11 Dec 2026). Azure plans an end date for current models too (lifecycle GA/Preview). In models.json: \`platforms.azure.models\` (id, maker, retires = earliest version, versions[] with version, lifecycle, retires, replacement).
` : ""}${vertex.length ? `- [Google Vertex AI dates](${SITE}/models/vertex/): ${vertex.length} Vertex model IDs (Gemini, Imagen, Veo, embeddings, Claude, open models ending in -maas) with Vertex's own retirement dates, read from Google Cloud's pages every 6 hours. Vertex uses the Gemini API's model names but its dates often differ (gemini-2.5-pro: retired on Vertex 20 Oct 2026, routed on the Gemini API 1 Dec 2026). In models.json: \`platforms.vertex.models\`.
` : ""}${bedrock.length ? `- [Amazon Bedrock dates](${SITE}/models/bedrock/): ${bedrock.length} Bedrock model IDs (Claude, Llama, Mistral, DeepSeek, Cohere and more) with Bedrock's own end-of-life dates per region, read from AWS's page every 6 hours. They often differ from the model maker's dates; for Bedrock calls only Bedrock's apply. In models.json: \`platforms.bedrock.models\` (id, maker, retires = earliest region, regions[], extended).
` : ""}- Free email alerts: sign up on any model page for emails 30 days and 7 days before, on the day, and when a date or replacement changes
- How it stays current: a script compares every entry with the official deprecation pages every 6 hours, and an AI check following written rules updates the registry daily or right away when the script finds a difference. Until then, affected models carry \`under_review\` in models.json and say "under review" on their pages; alerts for them wait.

## For AI coding agents

- [Agent guide](${SITE}/agents/): how to check model IDs before you write or keep them, and a snippet for AGENTS.md / CLAUDE.md
- MCP server: \`claude mcp add driftline -- npx -y @aidriftline/driftline mcp\` (tools: check_models, scan_project, upcoming_retirements)
- Rule of thumb: before adding or keeping an OpenAI, Anthropic or Google model ID, look it up. Do not introduce an ID whose status is retired, or whose date is within 90 days, without telling the user.

## Docs

- [README](https://github.com/AI-Driftline/driftline#readme): inputs, scoring, local use
- [Example workflow](https://github.com/AI-Driftline/driftline/blob/main/examples/driftline.yml)
- [Example prompts file](https://github.com/AI-Driftline/driftline/blob/main/examples/prompts.yml)
- [GitHub Marketplace](https://github.com/marketplace/actions/driftline-ai-model-check)
- [Pricing and FAQ](${SITE}/#pricing)
`;
writeFileSync(join(ROOT, "llms.txt"), LLMS);

const line = (m) => `- ${m.id} (${WHO[m.provider]}${m.kind && m.kind !== "text" ? `, ${m.kind}` : ""}): ${dateKind(m).toLowerCase()} ${m.retires}${m.replacement ? `, replacement ${m.replacement}` : ""}${m.routes ? " (requests routed to the replacement)" : ""}`;
writeFileSync(join(ROOT, "llms-full.txt"), `${LLMS}
## Upcoming retirements (as of ${reg.checked})

${upcoming.map(line).join("\n")}

## Past retirement dates

${gone.map(line).join("\n")}
`);


// ---------- feeds: RSS + calendar ----------
// One entry per retirement event: models from one provider sharing date, qualifier, replacement and routing.
// Anthropic "not sooner than" dates are minimum lifetimes, not announcements, so they stay out.
const events = (() => {
  const map = new Map();
  for (const m of models) {
    if (m.qualifier === "not-before") continue;
    const key = [m.provider, m.retires, m.qualifier, m.replacement || "", m.routes ? "routes" : ""].join("|");
    if (!map.has(key)) map.set(key, { key, provider: m.provider, retires: m.retires, qualifier: m.qualifier, replacement: m.replacement, routes: !!m.routes, ids: [], announced: "" });
    const e = map.get(key);
    e.ids.push(m.id);
    if (m.announced && m.announced > e.announced) e.announced = m.announced;
  }
  return [...map.values()];
})();
const names = (ids) => ids.length <= 3 ? ids.join(", ") : `${ids.slice(0, 2).join(", ")} and ${ids.length - 2} more`;
function eventTitle(e) {
  const who = WHO[e.provider];
  if (e.routes) return `${who} routes ${names(e.ids)} to ${e.replacement} from ${short(e.retires)}`;
  if (e.qualifier === "earliest") return `${who} may shut down ${names(e.ids)} from ${short(e.retires)}`;
  return `${who} retires ${names(e.ids)} on ${short(e.retires)}`;
}
function eventText(e) {
  const who = WHO[e.provider];
  const what = e.routes ? `From ${long(e.retires)}, ${who} answers requests for these models with ${e.replacement}. Nothing errors, but the answers come from a different model.`
    : e.qualifier === "earliest" ? `${who} lists ${long(e.retires)} as the earliest shutdown date. The models can be switched off from that day on.`
    : `${who} shuts these models down on ${long(e.retires)}. Calls to them fail after that.`;
  return [what, `Models: ${e.ids.join(", ")}`, e.replacement && !e.routes ? `Replacement: ${e.replacement}` : "",
    `Source: ${reg.sources[e.provider]}`, `Details: ${SITE}${url(e.ids[0])}`, "Check your code: npx -y @aidriftline/driftline ."].filter(Boolean).join("\n");
}
const rfc822 = (d) => new Date(d + "T00:00:00Z").toUTCString();
const xml = (t) => esc(t).replace(/'/g, "&apos;");
const feedItems = events.filter((e) => e.retires >= addDays(TODAY, -60))
  .sort((a, b) => (b.announced || "").localeCompare(a.announced || "") || a.retires.localeCompare(b.retires));
function addDays(d, n) { return new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10); }
writeFileSync(join(ROOT, "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>AI model retirements (Driftline)</title>
  <link>${SITE}/models/</link>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>When OpenAI, Anthropic and Google retire or re-route their models, from the official deprecation pages, checked daily.</description>
  <language>en</language>
  <lastBuildDate>${rfc822(reg.checked)}</lastBuildDate>
  <ttl>360</ttl>
${feedItems.map((e) => `  <item>
    <title>${xml(eventTitle(e))}</title>
    <link>${SITE}${url(e.ids[0])}</link>
    <guid isPermaLink="false">driftline:${xml(e.key)}</guid>${e.announced ? `\n    <pubDate>${rfc822(e.announced)}</pubDate>` : ""}
    <description>${xml(eventText(e))}</description>
  </item>`).join("\n")}
</channel>
</rss>
`);

// iCalendar text: escape, then fold lines at 75 octets (RFC 5545).
const icsEsc = (t) => String(t).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
function fold(lineText) {
  const out = [];
  let cur = "";
  for (const ch of lineText) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const ymd = (d) => d.replace(/-/g, "");
const calEvents = events.filter((e) => e.retires >= addDays(TODAY, -90)).sort((a, b) => a.retires.localeCompare(b.retires));
writeFileSync(join(ROOT, "retirements.ics"), [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Driftline//AI model retirements//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  "X-WR-CALNAME:AI model retirements", "X-WR-CALDESC:OpenAI\\, Anthropic and Google model retirement dates from aidriftline.com",
  "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
  ...calEvents.flatMap((e) => [
    "BEGIN:VEVENT",
    `UID:${e.key.replace(/[^\w.-]+/g, "-")}@aidriftline.com`,
    `DTSTAMP:${ymd(reg.checked)}T000000Z`,
    `DTSTART;VALUE=DATE:${ymd(e.retires)}`,
    `DTEND;VALUE=DATE:${ymd(addDays(e.retires, 1))}`,
    `SUMMARY:${icsEsc(eventTitle(e).replace(/ (on|from) \d+ \w+ \d{4}$/, ""))}`,
    `DESCRIPTION:${icsEsc(eventText(e))}`,
    `URL:${SITE}${url(e.ids[0])}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ]),
  "END:VCALENDAR",
].map(fold).join("\r\n") + "\r\n");

// ---------- blog: tools/posts/<slug>.html = a JSON header comment + the article body ----------
// {{ALERT:<model-id>}} in the body becomes the email alert form for that model.
// Replacements are never typed into an article: they come from the registry on every build, so a provider
// changing its advice changes the article too.
//   {{REPL:<id>}}        <code>replacement</code> (+ the provider's note, e.g. reasoning.mode: pro)
//   {{REPLTEXT:<id>}}    the replacement as plain text, for headings and sentences
//   {{ASOF}}             "as of 13 November 2026" (the registry's last check)
//   {{CHANGES:<id>,...}} a sentence listing recommendations the provider changed, or nothing
const posts = existsSync(join(ROOT, "tools", "posts")) ? readdirSync(join(ROOT, "tools", "posts")).filter((f) => f.endsWith(".html")).map((f) => {
  const raw = readFileSync(join(ROOT, "tools", "posts", f), "utf8");
  const meta = JSON.parse(raw.match(/^<!--([\s\S]*?)-->/)[1]);
  const model = (id) => { const m = byId.get(id); if (!m) throw new Error(`blog ${f}: unknown model ${id}`); return m; };
  const body = raw.replace(/^<!--[\s\S]*?-->\s*/, "").replace(/\{\{ALERT:([\w.-]+)\}\}/g, (_, id) => {
    const m = model(id);
    return past(m) ? "" : ALERT_BLOCK(m, true);
  }).replace(/\{\{REPL:([\w.-]+)\}\}/g, (_, id) => {
    const m = model(id);
    return m.replacement ? `<code>${esc(m.replacement)}</code>${m.replacement_alt ? ` or <code>${esc(m.replacement_alt)}</code>` : ""}${m.replacement_note ? ` (<code>${esc(m.replacement_note)}</code>)` : ""}` : "no direct replacement";
  }).replace(/\{\{REPLTEXT:([\w.-]+)\}\}/g, (_, id) => esc(model(id).replacement || "a newer model"))
    .replace(/\{\{ASOF\}\}/g, `as of ${long(reg.checked)}`)
    .replace(/\{\{CHANGES:([\w.,-]+)\}\}/g, (_, list) => {
      const changed = list.split(",").map(model).filter((m) => m.previous_replacement);
      if (!changed.length) return "";
      const by = [...new Set(changed.map((m) => m.replacement_changed))].sort();
      return `<p class="note"><b>Changed:</b> ${esc(WHO[changed[0].provider] || changed[0].provider)} changed these recommendations on ${by.map(long).join(" and ")}. Before, it recommended ` +
        changed.map((m) => `<code>${esc(m.previous_replacement)}</code> for <code>${esc(m.id)}</code>`).join(", ") +
        `. The table above shows the current advice; each model's page has the source.</p>`;
    });
  return { ...meta, body };
}).sort((a, b) => b.date.localeCompare(a.date)) : [];
// ---------- blog: articles written from the registry (tools/articles.mjs), one per retirement batch ----------
// Published here automatically; feed/devto/<slug>.json is what tools/devto-draft.mjs turns into a dev.to draft.
{
  const ARTICLES = join(ROOT, "feed", "articles.json");
  const state = existsSync(ARTICLES) ? JSON.parse(readFileSync(ARTICLES, "utf8")) : {};
  const covered = new Set(posts.map((p) => p.covers).filter(Boolean));
  const generated = batchArticles({ reg, byId: buildRegistry(reg).byId, today: TODAY, migrationFor, MIGRATION_LABEL, ALERT_BLOCK, site: SITE, covered, state });
  mkdirSync(join(ROOT, "feed", "devto"), { recursive: true });
  for (const g of generated) {
    posts.push(g);
    writeFileSync(join(ROOT, "feed", "devto", `${g.slug}.json`), JSON.stringify({ title: g.title, description: g.description, tags: g.tags, retires: g.retires,
      canonical_url: `${SITE}/blog/${g.slug}/`, body_markdown: g.markdown }, null, 1) + "\n");
  }
  posts.sort((a, b) => b.date.localeCompare(a.date) || a.retires?.localeCompare?.(b.retires || "") || 0);
  writeFileSync(ARTICLES, JSON.stringify(state, null, 1) + "\n");
}
for (const post of posts) {
  const path = `/blog/${post.slug}/`;
  const dir = join(ROOT, "blog", post.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page({
    path, title: post.title, description: post.description,
    body: `    <p class="crumbs"><a href="/blog/">Blog</a></p>
    <h1 class="post-h1">${esc(post.title)}</h1>
    <p class="updated">${long(post.date)}${post.updated ? ` · updated ${long(post.updated)}` : ""} · Driftline</p>
${post.body}`,
    jsonld: [{ "@context": "https://schema.org", "@type": "Article", headline: post.title, description: post.description, datePublished: post.date, dateModified: post.updated || post.date, author: { "@type": "Organization", name: "Driftline", url: SITE }, publisher: { "@type": "Organization", name: "Driftline", url: SITE }, mainEntityOfPage: `${SITE}${path}` }],
  }));
}
if (posts.length) writeFileSync(join(ROOT, "blog", "index.html"), page({
  path: "/blog/", title: "Driftline blog · AI model retirements explained", description: "What changes when OpenAI, Anthropic and Google retire a model, and how to move your code and prompts to the replacement.",
  body: `    <span class="eyebrow">Blog</span>
    <h1>Model retirements, explained</h1>
    <p class="answer">What changes when OpenAI, Anthropic and Google retire a model, and how to move your code and prompts to the replacement.</p>
    <ul class="posts">
${posts.map((p) => `      <li><a href="/blog/${p.slug}/">${esc(p.short || p.title)}</a><span class="dim"> · ${long(p.date)}</span><br><span>${esc(p.description)}</span></li>`).join("\n")}
    </ul>`,
}));

const pages = ["/", "/models/", "/agents/", ...(posts.length ? ["/blog/", ...posts.map((p) => `/blog/${p.slug}/`)] : []), ...[...models, ...aliases].map((m) => url(m.id)), ...(bedrock.length ? ["/models/bedrock/", ...bedrock.map((pm) => brUrl(pm.id))] : []), ...(vertex.length ? ["/models/vertex/", ...vertex.map((v) => vxUrl(v.id))] : []), ...(azure.length ? ["/models/azure/", ...azure.map((a) => azUrl(a.id))] : []), "/terms.html", "/privacy.html", "/refunds.html"];
writeFileSync(join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${p.startsWith("/models") || p === "/" ? reg.checked : "2026-10-11"}</lastmod></url>`).join("\n")}
</urlset>
`);
// Everyone, AI crawlers included, is welcome: being quoted by assistants is the point.
writeFileSync(join(ROOT, "robots.txt"), `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);

// ---------- refresh the numbers written into static pages ----------
for (const f of ["index.html", "agents/index.html"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const s = readFileSync(p, "utf8")
    .replace(/(<(span|b) data-reg="count">)[^<]*(<\/\2>)/g, `$1${models.length}$3`)
    .replace(/(<span data-reg="checked">)[^<]*(<\/span>)/g, `$1${short(reg.checked)}$2`);
  writeFileSync(p, f === "index.html" ? withFaqLd(s) : s);
}

// The home page FAQ, copied into FAQPage structured data so assistants can quote it.
function withFaqLd(html) {
  const strip = (t) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const qa = [...html.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)]
    .map(([, q, a]) => ({ "@type": "Question", name: strip(q), acceptedAnswer: { "@type": "Answer", text: strip(a) } }));
  const tag = `<script type="application/ld+json" id="faq-ld">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: qa }).replace(/</g, "\\u003c")}</script>`;
  return /<script type="application\/ld\+json" id="faq-ld">[\s\S]*?<\/script>/.test(html)
    ? html.replace(/<script type="application\/ld\+json" id="faq-ld">[\s\S]*?<\/script>/, tag)
    : html.replace("</head>", `${tag}\n</head>`);
}

console.log(`Built ${models.length} model pages + ${aliases.length} Claude short-name pages, models/index.html, models.json, llms.txt, llms-full.txt, feed.xml (${feedItems.length} items), retirements.ics (${calEvents.length} events), sitemap.xml (${pages.length} URLs), robots.txt. Registry checked ${reg.checked}.`);
