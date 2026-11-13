// Blog articles written from the registry, one per retirement batch (one provider, one date).
// Every fact (models, dates, replacements, what else changes) comes from the registry and the migration rules,
// so an article updates itself when a provider changes its advice. The wording around the facts is fixed.
//
// A batch gets an article when its date is firm and still ahead, and it has at least two different models or one
// text model that isn't a preview. Batches a hand-written post already covers ("covers" in its header) are skipped.
// feed/articles.json remembers when each article first appeared (its publish date) and its dev.to draft.

const WHO = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" };
const TAG = { openai: "openai", anthropic: "claude", google: "gemini" };
const long = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SNAPSHOT = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{2}-\d{4}|preview-\d{2}-\d{2})$/;
const base = (id) => id.replace(SNAPSHOT, "");
const listOf = (xs, max = 3) => xs.length <= max ? (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]) : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`;

// Inline text: `code`, [text](url) and **bold**, rendered for HTML or kept as Markdown.
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inlineHtml = (s) => escHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}"${u.startsWith("http") ? ' rel="noopener"' : ""}>${t}</a>`);

function render(blocks, kind, site) {
  const md = kind === "md";
  const abs = (s) => md ? s.replace(/\]\((\/[^)]*)\)/g, `](${site}$1)`) : s; // dev.to needs full links
  return blocks.map((b) => {
    if (b.p) return md ? abs(b.p) : `    <p${b.answer ? ' class="answer"' : ""}>${inlineHtml(b.p)}</p>`;
    if (b.h2) return md ? `## ${b.h2}` : `    <h2>${escHtml(b.h2)}</h2>`;
    if (b.h3) return md ? `### ${b.h3}` : `    <h3>${escHtml(b.h3)}</h3>`;
    if (b.ul) return md ? b.ul.map((x) => `- ${abs(x)}`).join("\n") : `    <ul>\n${b.ul.map((x) => `      <li>${inlineHtml(x)}</li>`).join("\n")}\n    </ul>`;
    if (b.code) return md ? "```bash\n" + b.code + "\n```" : `    <pre class="cmd"><code>${escHtml(b.code)}</code></pre>`;
    if (b.table) return md
      ? [`| ${b.table[0].join(" | ")} |`, `|${b.table[0].map(() => "---").join("|")}|`, ...b.table.slice(1).map((r) => `| ${r.map(abs).join(" | ")} |`)].join("\n")
      : `    <table>\n      <thead><tr>${b.table[0].map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr></thead>\n      <tbody>\n${b.table.slice(1).map((r) => `        <tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`).join("\n")}\n      </tbody>\n    </table>`;
    if (b.html) return md ? "" : b.html;
    return "";
  }).filter(Boolean).join(md ? "\n\n" : "\n");
}

export function batchArticles({ reg, byId, today, migrationFor, MIGRATION_LABEL, ALERT_BLOCK, site, covered, state }) {
  const groups = new Map();
  for (const m of reg.models) {
    if (m.qualifier !== "exact" || m.retires < today) continue;
    const k = `${m.provider}|${m.retires}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(byId.get(m.id) || m);
  }
  const out = [];
  for (const [key, ms] of [...groups].sort()) {
    if (covered.has(key)) continue;
    const bases = [...new Set(ms.map((m) => base(m.id)))];
    const textModel = ms.some((m) => (!m.kind || m.kind === "text") && !/preview|cyber/.test(m.id));
    if (bases.length < 2 && !textModel) continue;

    const [provider, retires] = key.split("|");
    const who = WHO[provider] || provider;
    const date = long(retires);
    const routes = ms.every((m) => m.routes);
    const src = reg.sources?.[provider];
    // Names people search for: the short name when the registry has it, else the dated IDs.
    // Anthropic short names (claude-sonnet-4-5) point at the dated snapshot and retire with it (byId knows them as aliases).
    const names = bases.flatMap((b) => ms.some((m) => m.id === b) || byId.get(b)?.aliasOf ? [b] : ms.filter((m) => base(m.id) === b).map((m) => m.id));
    const slug = `${provider}-${retires}-${base(names[0]).replace(/[^a-z0-9.-]/gi, "").replace(/\./g, "-")}${names.length > 1 ? "-and-more" : ""}-retirement`;
    const repl = (m) => m.replacement ? `\`${m.replacement}\`${m.replacement_alt ? ` or \`${m.replacement_alt}\`` : ""}${m.replacement_note ? ` (${m.replacement_note})` : ""}` : "no direct replacement";
    const replsPlain = [...new Set(ms.filter((m) => m.replacement).map((m) => m.replacement + (m.replacement_alt ? ` or ${m.replacement_alt}` : "")))];
    const isText = ms.every((m) => !m.kind || m.kind === "text");

    // When only dated versions retire (the short names aren't on the provider's list), say so instead of listing dates.
    const onlyDated = names.every((n) => SNAPSHOT.test(n));
    const shown = onlyDated ? bases : names;
    const what = (n = 3) => onlyDated ? `dated ${listOf(bases, n)} versions` : listOf(names, n);
    const title = routes
      ? `${who} switches ${what()} to a newer model on ${date}: what to change`
      : `${who} retires ${what(4)} on ${date}: what to change`;
    const short = `${who} ${routes ? "switches" : "retires"} ${onlyDated ? `dated ${listOf(bases, 2)} versions` : listOf(names, 2)} on ${long(retires).replace(/ \d{4}$/, "")}`;
    const description = routes
      ? `On ${date}, ${who} starts answering requests for ${what(4)} with a newer model. What changes, what to update in your code, and how to test it.`
      : `On ${date}, ${who} removes ${what(4)} from the API. The replacements, what else changes, how to find every use in your code, and how to test before you switch.`;

    const blocks = [];
    blocks.push({ answer: true, p: routes
      ? `On ${date}, ${who} starts answering API requests for ${replsPlain.length > 1 && ms.length <= 4 ? ms.map((m) => `${m.id} with ${m.replacement}`).join(" and ") : `${listOf(names, 4)} with ${listOf(replsPlain)}`}. The calls keep going through, but the answers come from a different model.`
      : `On ${date}, ${who} removes ${what(4)} from the API${!onlyDated && ms.some((m) => SNAPSHOT.test(m.id)) ? (ms.filter((m) => SNAPSHOT.test(m.id)).length === 1 ? ", together with its dated version" : ", together with the dated versions listed below") : ""}. From that day, API calls to ${ms.length > 1 ? "these models" : "it"} fail. ${who}'s recommended replacement${replsPlain.length > 1 ? "s" : ""} (as of ${long(reg.checked)}): ${listOf(replsPlain, 4)}.` });

    blocks.push({ h2: routes ? "What changes" : "What retires, and what replaces it" });
    blocks.push({ p: `${who} lists ${names.length > 1 ? "these models" : "this model"} on its ${src ? `[deprecations page](${src})` : "deprecations page"}. The dates and replacements on this page come from Driftline's registry, which is checked against that page several times a day, so they stay current if ${who} changes them.` });
    const aliases = names.filter((n) => byId.get(n)?.aliasOf);
    if (aliases.length) blocks.push({ p: `${aliases.map((n) => `\`${n}\` is the short name for \`${byId.get(n).aliasOf}\``).join("; ")}, so both stop working.` });
    if (onlyDated) blocks.push({ p: `Only these dated versions are on ${who}'s list. The short names (${bases.map((b) => `\`${b}\``).join(", ")}) aren't, so check which version your code really calls.` });
    blocks.push({ table: [["Model", "Replacement", "Moving to it"], ...ms.map((m) => {
      const mig = migrationFor(m);
      return [`[\`${m.id}\`](/models/${m.id}/)`, repl(m), mig ? (mig.drop_in ? "Rename" : MIGRATION_LABEL[mig.change]) : "No direct replacement"];
    })] });
    const changed = ms.filter((m) => m.previous_replacement);
    if (changed.length) blocks.push({ p: `**Changed:** ${who} changed its recommendation on ${long(changed[0].replacement_changed)}. Before, it pointed to ${listOf([...new Set(changed.map((m) => m.previous_replacement))])}.` });

    const byNote = new Map(); // one bullet per note, with every guide it needs (e.g. Gemini 3.8 and 3.6)
    for (const m of ms) {
      const x = migrationFor(m);
      if (!x || !x.note || x.change === "rename" || x.change === "settings") continue;
      if (!byNote.has(x.note)) byNote.set(x.note, { note: x.note, guides: new Map() });
      if (x.guide) byNote.get(x.note).guides.set(x.guide, m.replacement);
    }
    const migs = [...byNote.values()];
    if (migs.length) {
      blocks.push({ h2: "More than a new model name" });
      blocks.push({ p: `For ${migs.length > 1 ? "some of these models" : names.length > 1 ? "these models" : "this model"}, changing the name isn't the whole job:` });
      blocks.push({ ul: migs.map((x) => x.note + (x.guides.size === 1 ? ` [${who}'s guide](${[...x.guides.keys()][0]})`
        : x.guides.size ? ` ${who}'s guides: ${[...x.guides].map(([u, r]) => `[for ${r}](${u})`).join(", ")}` : "")) });
    }

    blocks.push({ h2: "Find every place your code uses them" });
    blocks.push({ p: "Run this in the root of your repository. No install, account or API key; it lists every OpenAI, Anthropic and Google model ID it finds, with file, line, retirement date and replacement:" });
    blocks.push({ code: "npx -y @aidriftline/driftline ." });
    blocks.push({ p: "A plain search works too:" });
    blocks.push({ code: `grep -rnE '"(${[...new Set(ms.map((m) => m.id))].map((id) => id.replace(/\./g, "\\.")).join("|")})"' .` });
    blocks.push({ p: "It misses model names set outside the code: environment variables, deployment settings, values stored in a database, and defaults inside SDKs or agent frameworks you never configured." });

    blocks.push({ h2: `Test before ${date}` });
    blocks.push({ p: isText
      ? "A new model answers the same prompt differently: format, length, tone, and whether JSON still parses. Take 10 to 20 real prompts from your logs, run each on the old model and the replacement, and compare. Do it while the old model still answers; after the date there is nothing left to compare against."
      : "Run a handful of real requests on the replacement and compare the results with what you get today, before the date. Check the parts your code depends on: output format, quality, length and timing." });
    if (isText) blocks.push({ p: "[Driftline Pro](/#drift) does this in your GitHub Actions: it runs the prompts your app sends on the current model and the replacement, and shows what changed in the pull request." });

    const first = ms.find((m) => m.retires > today) || ms[0];
    blocks.push({ h2: "Get a reminder" });
    blocks.push({ html: ALERT_BLOCK(first, true) });
    blocks.push({ p: "The free [Driftline GitHub Action](/#install) flags retired and soon-to-retire model IDs on every pull request, so the next retirement doesn't come as a surprise." });

    blocks.push({ h2: "Questions" });
    blocks.push({ h3: `Will calls to ${shown[0]} keep working after ${date}?` });
    blocks.push({ p: routes
      ? `They keep being answered, by ${listOf(replsPlain)}.${migs.length ? ` ${who} still lists request changes to make before then, see above.` : " Nothing errors, but the answers come from a different model."}`
      : onlyDated ? `Calls to the dated versions listed above stop working on that day and return an error. Check which version a short name like \`${bases[0]}\` points to before relying on it.`
      : `No. ${who} removes the model from the API on that day, and requests to it return an error.` });

    const facts = JSON.stringify(ms.map((m) => [m.id, m.retires, m.replacement, m.replacement_alt, m.replacement_note]));
    const st = state[slug] || { date: today, facts };
    if (st.facts !== facts) { st.updated = today; st.facts = facts; }
    state[slug] = st;
    out.push({
      slug, title, short, description, date: st.date, updated: st.updated, provider, retires,
      body: render(blocks, "html", site),
      markdown: render(blocks, "md", site) + `\n\n---\n\n*I build [Driftline](${site}), which tracks these retirement dates. The current list, with one page per model: [aidriftline.com/models](${site}/models/).*\n`,
      tags: ["ai", TAG[provider] || provider, "devops", "api"],
    });
  }
  return out;
}
