// Driftline landing. No dependencies.

// Lemon Squeezy checkout links. Paste them here once the Pro product exists.
// While empty, "Get Pro" opens an email instead.
const CHECKOUT = { monthly: "", yearly: "" };

const DAY = 86400000;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, el = document) => el.querySelector(s);
const daysUntil = (iso) => Math.ceil((Date.parse(iso + "T00:00:00Z") - Date.now()) / DAY);
const fmt = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Snapshot of registry/models.json (checked 2026-10-10): text models with a fixed date.
const RETIREMENTS = [
  { date: "2026-09-28", who: "OpenAI", ids: ["gpt-3.5-turbo-1106", "gpt-3.5-turbo-instruct", "babbage-002", "davinci-002"] },
  { date: "2026-10-23", who: "OpenAI", ids: ["gpt-4o-2024-05-13", "gpt-4", "gpt-4-turbo", "gpt-3.5-turbo", "o1", "o1-pro", "o3-mini", "o4-mini", "gpt-4.1-nano", "gpt-4-0613", "gpt-4-1106-preview", "gpt-4-turbo-2024-04-09", "gpt-3.5-turbo-0125", "o1-2024-12-17", "o1-pro-2025-03-19", "o3-mini-2025-01-31", "o4-mini-2025-04-16", "gpt-4.1-nano-2025-04-14"] },
  { date: "2026-11-30", who: "Anthropic", ids: ["claude-sonnet-4-5-20250929"] },
  { date: "2026-12-11", who: "OpenAI", ids: ["gpt-5-2025-08-07", "gpt-5-mini-2025-08-07", "gpt-5-nano-2025-08-07", "gpt-5-pro-2025-10-06", "o3-2025-04-16", "o3-pro-2025-06-10"] },
  { date: "2027-04-01", who: "OpenAI", ids: ["gpt-5.1", "gpt-5.3-codex", "gpt-5.4-nano"] },
];
const TICKER_EXTRA = [
  { id: "gpt-image-1", date: "2026-10-23" },
  { id: "tts-1", date: "2027-01-06" },
  { id: "whisper-1", date: "2027-02-26" },
];

const rel = (d) => d > 1 ? `in ${d} days` : d === 1 ? "tomorrow" : d === 0 ? "today" : `${-d} days ago`;

// ---------- nav ----------
const nav = $("#nav");
const onScroll = () => nav.classList.toggle("scrolled", scrollY > 20);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- hero countdown + annotation ----------
{
  const d = daysUntil("2026-10-23");
  if (d > 0) {
    $("#cd-num").textContent = d === 1 ? "1 day" : `${d} days`;
  } else {
    $("#cd-num").textContent = "Retired";
    $("#cd-label").textContent = `gpt-4o-2024-05-13 · ${rel(d)}`;
    $("#annot-text").innerHTML = "<code>gpt-4o-2024-05-13</code> is retired (2026-10-23). Replacement: <code>gpt-5.6-sol</code>.";
  }

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

// ---------- ticker ----------
{
  const items = RETIREMENTS.flatMap((g) => g.ids.slice(0, 6).map((id) => ({ id, date: g.date })))
    .concat(TICKER_EXTRA)
    .sort((a, b) => a.date.localeCompare(b.date));
  const html = items.map(({ id, date }) => {
    const d = daysUntil(date);
    return `<span class="item"><i class="dot${d <= 0 ? " gone" : ""}"></i><b>${id}</b><span class="d">${fmt(date)} · ${rel(d)}</span></span>`;
  }).join("");
  $("#ticker").innerHTML = html + html.replace(/class="item"/g, 'class="item" aria-hidden="true"');
}

// ---------- timeline ----------
{
  const start = Date.parse("2026-09-01T00:00:00Z"), end = Date.parse("2027-05-01T00:00:00Z");
  const pos = (t) => Math.min(100, Math.max(0, ((t - start) / (end - start)) * 100));
  $("#tl-today").style.left = pos(Date.now()) + "%";
  const axis = $("#tl-axis");
  for (const g of RETIREMENTS) {
    const m = document.createElement("i");
    const past = daysUntil(g.date) <= 0;
    m.style.cssText = `position:absolute;top:-3px;width:7px;height:7px;border-radius:2px;transform:translateX(-50%);left:${pos(Date.parse(g.date))}%;background:${past ? "var(--red)" : "var(--amber)"}`;
    axis.appendChild(m);
  }
  const months = [];
  for (let d = new Date(start); d.getTime() <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) + (d.getUTCMonth() === 0 ? " ’" + String(d.getUTCFullYear()).slice(2) : ""));
  }
  $("#tl-months").innerHTML = months.map((m, i) => `<span${i % 2 && innerWidth < 600 ? ' style="visibility:hidden"' : ""}>${m}</span>`).join("");

  $("#tl-rows").innerHTML = RETIREMENTS.map((g) => {
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
