// Driftline landing. No dependencies.

// Lemon Squeezy checkout links (live mode). If one is empty, "Get Pro" opens an email instead.
const CHECKOUT = {
  monthly: "https://aidriftline.lemonsqueezy.com/checkout/buy/bf8d4d8c-de7c-4250-a484-502684504d23?enabled=2237388",
  yearly: "https://aidriftline.lemonsqueezy.com/checkout/buy/55745667-82c5-423d-baf4-5248c0f629bb?enabled=2237389",
};

const DAY = 86400000;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, el = document) => el.querySelector(s);
const daysUntil = (iso) => Math.ceil((Date.parse(iso + "T00:00:00Z") - Date.now()) / DAY);
const fmt = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Retirement data comes live from the product's registry, so updating registry/models.json
// on GitHub updates this page too (GitHub caches the file for about 5 minutes).
const REGISTRY_URL = "https://raw.githubusercontent.com/AI-Driftline/driftline/main/registry/models.json";
const WHO = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" };

// Backup copy, used until the live registry loads or if GitHub can't be reached.
// Models with a fixed date and a replacement, from registry/models.json (checked 2026-10-12).
const SNAPSHOT = {
  checked: "2026-10-12",
  count: 223,
  models: [
    { id: "gpt-3.5-turbo-instruct", provider: "openai", retires: "2026-09-28", replacement: "gpt-5.6-terra" },
    { id: "babbage-002", provider: "openai", retires: "2026-09-28", replacement: "gpt-5.6-terra" },
    { id: "davinci-002", provider: "openai", retires: "2026-09-28", replacement: "gpt-5.6-terra" },
    { id: "gpt-3.5-turbo-1106", provider: "openai", retires: "2026-09-28", replacement: "gpt-5.6-terra" },
    { id: "gpt-3.5-turbo-0125", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-terra" },
    { id: "gpt-3.5-turbo", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-terra" },
    { id: "o4-mini", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-terra" },
    { id: "o4-mini-2025-04-16", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-terra" },
    { id: "gpt-4", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "gpt-4-0613", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "gpt-4-turbo", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "gpt-4-turbo-2024-04-09", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "gpt-4o-2024-05-13", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "o1", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "o1-2024-12-17", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "o1-pro", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "o1-pro-2025-03-19", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "o3-mini", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "o3-mini-2025-01-31", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "gpt-4.1-nano", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-luna" },
    { id: "gpt-4.1-nano-2025-04-14", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-luna" },
    { id: "gpt-4-1106-preview", provider: "openai", retires: "2026-10-23", replacement: "gpt-5.6-sol" },
    { id: "gpt-image-1", provider: "openai", retires: "2026-10-23", replacement: "gpt-image-2.5-sunburst", kind: "image" },
    { id: "claude-sonnet-4-5-20250929", provider: "anthropic", retires: "2026-11-30", replacement: "claude-sonnet-5-5" },
    { id: "gpt-image-1-mini", provider: "openai", retires: "2026-12-01", replacement: "gpt-image-2.5-sunburst", kind: "image" },
    { id: "gpt-image-1.5", provider: "openai", retires: "2026-12-01", replacement: "gpt-image-2.5-sunburst", kind: "image" },
    { id: "chatgpt-image-latest", provider: "openai", retires: "2026-12-01", replacement: "gpt-image-2.5-sunburst", kind: "image" },
    { id: "gpt-5-2025-08-07", provider: "openai", retires: "2026-12-11", replacement: "gpt-5.6-sol" },
    { id: "gpt-5-pro-2025-10-06", provider: "openai", retires: "2026-12-11", replacement: "gpt-5.6-sol" },
    { id: "o3-2025-04-16", provider: "openai", retires: "2026-12-11", replacement: "gpt-5.6-sol" },
    { id: "o3-pro-2025-06-10", provider: "openai", retires: "2026-12-11", replacement: "gpt-5.6-sol" },
    { id: "gpt-5-mini-2025-08-07", provider: "openai", retires: "2026-12-11", replacement: "gpt-5.6-terra" },
    { id: "gpt-5-nano-2025-08-07", provider: "openai", retires: "2026-12-11", replacement: "gpt-5.6-luna" },
    { id: "tts-1", provider: "openai", retires: "2027-01-06", replacement: "gpt-realtime-2.1-mini", kind: "audio" },
    { id: "tts-1-hd", provider: "openai", retires: "2027-01-06", replacement: "gpt-realtime-2.1-mini", kind: "audio" },
    { id: "gpt-4o-mini-tts-2025-03-20", provider: "openai", retires: "2027-01-06", replacement: "gpt-realtime-2.1-mini", kind: "audio" },
    { id: "gpt-4o-mini-tts-2025-12-15", provider: "openai", retires: "2027-01-06", replacement: "gpt-realtime-2.1-mini", kind: "audio" },
    { id: "gpt-realtime", provider: "openai", retires: "2027-01-20", replacement: "gpt-realtime-2.1", kind: "audio" },
    { id: "gpt-4o-realtime", provider: "openai", retires: "2027-01-20", replacement: "gpt-realtime-2.1", kind: "audio" },
    { id: "gpt-audio", provider: "openai", retires: "2027-01-20", replacement: "gpt-audio-1.5", kind: "audio" },
    { id: "gpt-4o-audio", provider: "openai", retires: "2027-01-20", replacement: "gpt-audio-1.5", kind: "audio" },
    { id: "gpt-audio-mini", provider: "openai", retires: "2027-01-20", replacement: "gpt-audio-1.5", kind: "audio" },
    { id: "gpt-4o-mini-audio", provider: "openai", retires: "2027-01-20", replacement: "gpt-audio-1.5", kind: "audio" },
    { id: "gpt-realtime-mini", provider: "openai", retires: "2027-01-20", replacement: "gpt-realtime-2.1-mini", kind: "audio" },
    { id: "gpt-4o-mini-realtime", provider: "openai", retires: "2027-01-20", replacement: "gpt-realtime-2.1-mini", kind: "audio" },
    { id: "gpt-4o-mini-transcribe-2025-03-20", provider: "openai", retires: "2027-01-20", replacement: "gpt-4o-mini-transcribe-2025-12-15", kind: "audio" },
    { id: "whisper-1", provider: "openai", retires: "2027-02-26", replacement: "gpt-transcribe", kind: "audio" },
    { id: "gpt-4o-transcribe", provider: "openai", retires: "2027-02-26", replacement: "gpt-transcribe", kind: "audio" },
    { id: "gpt-4o-mini-transcribe", provider: "openai", retires: "2027-02-26", replacement: "gpt-transcribe", kind: "audio" },
    { id: "gpt-4o-transcribe-diarize", provider: "openai", retires: "2027-02-26", replacement: "gpt-transcribe", kind: "audio" },
    { id: "gpt-5.3-codex", provider: "openai", retires: "2027-04-01", replacement: "gpt-6-sol" },
    { id: "gpt-5.1", provider: "openai", retires: "2027-04-01", replacement: "gpt-6-sol" },
    { id: "gpt-5.4-nano", provider: "openai", retires: "2027-04-01", replacement: "gpt-6-luna" },
  ],
};

const rel = (d) => d > 1 ? `in ${d} days` : d === 1 ? "tomorrow" : d === 0 ? "today" : `${-d} days ago`;

// Timeline window: from the 1st of last month to 8 months later.
const t0 = new Date(Date.now() - 30 * DAY);
const START = Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), 1);
const END = Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + 8, 1);
const inWindow = (iso) => { const t = Date.parse(iso + "T00:00:00Z"); return t >= START && t <= END; };

// The hero shows an OpenAI call, so it follows the next OpenAI text retirement,
// and keeps showing a retired model for 14 days before moving on.
const HERO_DAYS_AFTER = 14;
const HERO_PREFER = "gpt-4o-2024-05-13";

const isText = (m) => (m.kind || "text") === "text";
// Recognizable names first: the hero model, then aliases like "gpt-4", then dated snapshots like "gpt-4-0613".
const dated = (id) => /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})(-preview)?$/.test(id);

function derive({ checked, count, models }) {
  const byDate = (a, b) => a.retires.localeCompare(b.retires);
  const heroDate = models.filter((m) => m.provider === "openai" && isText(m) && daysUntil(m.retires) > -HERO_DAYS_AFTER)
    .sort(byDate)[0]?.retires;
  const heroGroup = models.filter((m) => m.provider === "openai" && isText(m) && m.retires === heroDate);
  const hero = heroGroup.find((m) => m.id === HERO_PREFER) || heroGroup[0] || null;
  const rank = (id) => (hero && id === hero.id ? 0 : dated(id) ? 2 : 1);

  const group = (list) => {
    const map = new Map();
    for (const m of list.filter((m) => inWindow(m.retires)).sort(byDate)) {
      const key = m.retires + m.provider;
      if (!map.has(key)) map.set(key, { date: m.retires, who: WHO[m.provider] || m.provider, ids: [] });
      map.get(key).ids.push(m.id);
    }
    const groups = [...map.values()];
    groups.forEach((g) => g.ids.sort((a, b) => rank(a) - rank(b)));
    return groups;
  };

  return {
    checked, count,
    hero: hero && { id: hero.id, replacement: hero.replacement, retires: hero.retires },
    groups: group(models.filter(isText)),
    // One audio/image/video model per date, for the ticker only.
    extras: group(models.filter((m) => !isText(m))).map((g) => ({ id: g.ids[0], date: g.date })),
  };
}

const fromRegistry = (r) => derive({
  checked: r.checked,
  count: r.models.length,
  models: r.models.filter((m) => m.qualifier === "exact" && m.replacement),
});

// ---------- nav ----------
const nav = $("#nav");
const onScroll = () => nav.classList.toggle("scrolled", scrollY > 20);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- render retirement data ----------
function render({ checked, count, hero, groups, extras }) {
  $("#reg-status").textContent = `${count} model IDs tracked · checked ${fmt(checked)}`;
  $("#reg-checked").textContent = fmt(checked);

  // hero countdown + annotation
  if (hero) {
    const d = daysUntil(hero.retires);
    const code = (id) => `<code>${id}</code>`;
    $("#hit .model").textContent = `"${hero.id}"`;
    if (d > 0) {
      $("#cd-num").textContent = d === 1 ? "1 day" : `${d} days`;
      $("#cd-label").textContent = `until ${hero.id} retires`;
      $("#annot-text").innerHTML = `${code(hero.id)} retires soon (${hero.retires}). Replacement: ${code(hero.replacement)}.`;
    } else {
      $("#cd-num").textContent = "Retired";
      $("#cd-label").textContent = `${hero.id} · ${rel(d)}`;
      $("#annot-text").innerHTML = `${code(hero.id)} is retired (${hero.retires}). Replacement: ${code(hero.replacement)}.`;
    }
    $(".editor").setAttribute("aria-label", `Code editor showing a Driftline warning on line 6: ${hero.id} ${d > 0 ? "retires" : "was retired"} on ${fmt(hero.retires)}, replacement ${hero.replacement}.`);
  }

  // ticker
  const items = groups.flatMap((g) => g.ids.slice(0, 6).map((id) => ({ id, date: g.date })))
    .concat(extras)
    .sort((a, b) => a.date.localeCompare(b.date));
  const html = items.map(({ id, date }) => {
    const d = daysUntil(date);
    return `<span class="item"><i class="dot${d <= 0 ? " gone" : ""}"></i><b>${id}</b><span class="d">${fmt(date)} · ${rel(d)}</span></span>`;
  }).join("");
  $("#ticker").innerHTML = html + html.replace(/class="item"/g, 'class="item" aria-hidden="true"');

  // timeline
  const pos = (t) => Math.min(100, Math.max(0, ((t - START) / (END - START)) * 100));
  $("#tl-today").style.left = pos(Date.now()) + "%";
  const axis = $("#tl-axis");
  axis.querySelectorAll("i").forEach((m) => m.remove());
  for (const g of groups) {
    const m = document.createElement("i");
    const past = daysUntil(g.date) <= 0;
    m.style.cssText = `position:absolute;top:-3px;width:7px;height:7px;border-radius:2px;transform:translateX(-50%);left:${pos(Date.parse(g.date))}%;background:${past ? "var(--red)" : "var(--amber)"}`;
    axis.appendChild(m);
  }
  const months = [];
  for (let d = new Date(START); d.getTime() <= END; d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) + (d.getUTCMonth() === 0 ? " ’" + String(d.getUTCFullYear()).slice(2) : ""));
  }
  $("#tl-months").innerHTML = months.map((m, i) => `<span${i % 2 && innerWidth < 600 ? ' style="visibility:hidden"' : ""}>${m}</span>`).join("");

  $("#tl-rows").innerHTML = groups.map((g) => {
    const d = daysUntil(g.date);
    const shown = g.ids.slice(0, 7);
    const more = g.ids.length - shown.length;
    return `<div class="tl-row${d <= 0 ? " past" : d > 120 ? " far" : ""}">
      <span class="date">${fmt(g.date)}</span>
      <span class="who">${g.who} · ${g.ids.length}</span>
      <span class="ids">${shown.map((id) => `<code>${id}</code>`).join("")}${more > 0 ? `<code class="more">+${more} more</code>` : ""}</span>
      <span class="rel">${d <= 0 ? "retired " : ""}${rel(d)}</span>
    </div>`;
  }).join("");
}

{
  let shown = derive(SNAPSHOT);
  render(shown);
  fetch(REGISTRY_URL, { cache: "no-cache", signal: AbortSignal.timeout?.(6000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((r) => {
      const next = fromRegistry(r);
      // Re-render only if something changed, so the ticker doesn't jump.
      if (JSON.stringify(next) !== JSON.stringify(shown)) { shown = next; render(next); }
    })
    .catch(() => {}); // keep the backup copy
}

// ---------- hero scan animation ----------
{
  const scan = $("#scan"), hit = $("#hit"), annot = $("#annot"), code = $("#code");
  if (reduced) {
    hit.classList.add("on"); annot.classList.add("show");
  } else {
    const target = hit.offsetTop - 2;
    scan.style.transition = "none";
    setTimeout(() => {
      scan.style.opacity = "1";
      scan.style.transition = "top 1.1s cubic-bezier(.4,0,.2,1)";
      requestAnimationFrame(() => { scan.style.top = target + "px"; });
    }, 900);
    setTimeout(() => { hit.classList.add("on"); annot.classList.add("show"); }, 2050);
    setTimeout(() => {
      scan.style.transition = "top .9s cubic-bezier(.4,0,.2,1), opacity .5s .5s";
      scan.style.top = code.scrollHeight - 30 + "px";
      scan.style.opacity = "0";
    }, 2500);
  }
}

// ---------- reveal on scroll ----------
{
  const els = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) els.forEach((el) => el.classList.add("in"));
  else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    els.forEach((el) => io.observe(el));
  }
}

// ---------- copy button ----------
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#" + btn.dataset.copy).textContent);
      btn.textContent = "Copied"; btn.classList.add("done");
    } catch { btn.textContent = "Select and copy"; }
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1800);
  });
});

// ---------- billing toggle ----------
{
  const PLANS = {
    monthly: { price: "$19", unit: "/ month", note: "billed monthly, cancel any time" },
    yearly: { price: "$190", unit: "/ year", note: "billed yearly, about $15.83 a month" },
  };
  const btns = document.querySelectorAll(".billing button");
  const pill = $("#pill");
  const set = (period) => {
    btns.forEach((b) => {
      const on = b.dataset.period === period;
      b.setAttribute("aria-pressed", on);
      if (on) { pill.style.width = b.offsetWidth + "px"; pill.style.transform = `translateX(${b.offsetLeft - 4}px)`; }
    });
    const p = PLANS[period];
    $("#price").textContent = p.price; $("#price-unit").textContent = p.unit; $("#price-note").textContent = p.note;
    if (CHECKOUT[period]) $("#buy").href = CHECKOUT[period];
  };
  btns.forEach((b) => b.addEventListener("click", () => set(b.dataset.period)));
  set("monthly");
  addEventListener("resize", () => set($('.billing [aria-pressed="true"]').dataset.period));
  document.fonts?.ready.then(() => set($('.billing [aria-pressed="true"]').dataset.period));
}

// ---------- block field (the logo's drifting square, as a background) ----------
function field(canvas, { gap = 30, size = 5, drift = 0.03, base = 0.07, interactive = true } = {}) {
  const ctx = canvas.getContext("2d");
  let w, h, dpr, cells = [], mouse = { x: -1e4, y: -1e4 }, running = false, raf;

  function build() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cells = [];
    const cols = Math.ceil(w / gap) + 1, rows = Math.ceil(h / gap) + 1;
    const ox = (w - (cols - 1) * gap) / 2, oy = (h - (rows - 1) * gap) / 2;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      cells.push({ x: ox + c * gap, y: oy + r * gap, lime: rnd() < drift, ph: rnd() * Math.PI * 2, sp: 0.25 + rnd() * 0.5 });
    }
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    const s = t / 1000;
    for (const p of cells) {
      const wave = 0.5 + 0.5 * Math.sin(p.x * 0.006 + p.y * 0.009 - s * 0.6);
      const dx = p.x - mouse.x, dy = p.y - mouse.y, dist = Math.hypot(dx, dy);
      const near = interactive ? Math.max(0, 1 - dist / 170) : 0;
      let x = p.x, y = p.y, a = base + wave * 0.05 + near * 0.35, sz = size + near * 3;
      if (near) { x += (dx / (dist || 1)) * near * 8; y += (dy / (dist || 1)) * near * 8; }
      if (p.lime) {
        const k = 0.5 + 0.5 * Math.sin(s * p.sp + p.ph);
        x += k * 7; y -= k * 7;
        ctx.fillStyle = `rgba(198,244,50,${0.25 + k * 0.6})`;
        sz = size + 2;
      } else {
        ctx.fillStyle = `rgba(250,250,250,${a})`;
      }
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x - sz / 2, y - sz / 2, sz, sz, 1.5) : ctx.rect(x - sz / 2, y - sz / 2, sz, sz);
      ctx.fill();
    }
  }

  const loop = (t) => { draw(t); if (running) raf = requestAnimationFrame(loop); };
  build();
  if (reduced) { draw(0); addEventListener("resize", () => { build(); draw(0); }); return; }

  new IntersectionObserver(([e]) => {
    running = e.isIntersecting;
    cancelAnimationFrame(raf);
    if (running) raf = requestAnimationFrame(loop);
  }).observe(canvas);
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(build, 120); });
  if (interactive) {
    const host = canvas.parentElement;
    host.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
    host.addEventListener("pointerleave", () => { mouse.x = mouse.y = -1e4; });
  }
}

field($("#field"), { drift: 0.022 });
field($("#field2"), { gap: 34, size: 4, drift: 0.06, base: 0.05, interactive: false });
