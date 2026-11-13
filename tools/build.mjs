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

const WHO = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" };
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
    <p>Run this in your repository. No install and no API key; it lists every OpenAI, Anthropic and Google model ID it finds, with its retirement date and replacement:</p>
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
  faq.push({ q: `How do I find ${m.id} in my code?`, a: `Run "npx -y @aidriftline/driftline ." in your repository. It finds OpenAI, Anthropic and Google model IDs, including aliases and Bedrock/Vertex names, and lists each one's retirement date and replacement.` });

  const rows = [
    ["Provider", who],
    ["Status", `${status(m)} <span class="dim">(as of ${short(reg.checked)})</span>`],
    [dateKind(m), long(m.retires)],
    ...(m.replacement ? [["Replacement", link(m.replacement) + (m.replacement_alt ? ` or ${link(m.replacement_alt)}` : "") + (m.replacement_note ? ` <span class="dim">(${esc(m.replacement_note)})</span>` : "") + (m.previous_replacement ? ` <span class="dim">· changed ${short(m.replacement_changed)}, was ${esc(m.previous_replacement)}</span>` : "") + (r && r !== m.replacement ? ` → move to ${link(r)}` : "")]] : []),
    ...(mig && m.replacement ? [["Moving to it", `${mig.drop_in ? "Rename" : esc(MIGRATION_LABEL[mig.change])}${mig.note && !(mig.change === "settings") ? ` <span class="dim">· ${esc(mig.note)}${mig.guide ? ` <a href="${esc(mig.guide)}" rel="noopener">${esc(who)}'s guide</a>` : ""}</span>` : ""}`]] : []),
    ...(m.aliasOf ? [["Short name for", link(m.aliasOf)]] : []),
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
    <h2>Coming up (${upcoming.length})</h2>
${table(upcoming)}
    <h2>Already past (${gone.length})</h2>
${table(gone)}`,
  jsonld: [{ "@context": "https://schema.org", "@type": "Dataset", name: "AI model retirement dates", description: listDesc, url: `${SITE}/models/`,
    dateModified: reg.checked, license: "https://github.com/AI-Driftline/driftline/blob/main/LICENSE", creator: { "@type": "Organization", name: "Driftline", url: SITE },
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/models.json` }] }],
}));

// ---------- data + files for crawlers and agents ----------
// Each entry also says whether moving to its replacement is more than a rename (rules: product src/migration.js).
const withMigration = reg.models.map((m) => { const mig = migrationFor(m); return mig && mig.change !== "rename" ? { ...m, migration: mig } : m; });
writeFileSync(join(ROOT, "models.json"), JSON.stringify({ ...reg, models: withMigration, url: `${SITE}/models.json`, pages: `${SITE}/models/<id>/` }, null, 2) + "\n");

const LLMS = `# Driftline

> Driftline is a GitHub Action and CLI that finds OpenAI, Anthropic and Google model IDs in a codebase, warns before those models are retired, and (Pro) runs your real prompts on the current and the replacement model to show what changes. It runs in your own CI with your own API keys; there is no Driftline server.

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

const pages = ["/", "/models/", "/agents/", ...(posts.length ? ["/blog/", ...posts.map((p) => `/blog/${p.slug}/`)] : []), ...[...models, ...aliases].map((m) => url(m.id)), "/terms.html", "/privacy.html", "/refunds.html"];
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
