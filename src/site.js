// The site: one live controller feeding every instrument on the page.
import { simHash, STAGES, STAGE_NOTES } from "./engine.js";
import { txUrl, CHAIN, makeRpc } from "./chain.js";
import { Renderer, FRAME_NUMBERS, CLIPS } from "./render.js";
import { Live, loadConfig } from "./live.js";
import { Brain, REGIONS, TOTAL_NEURONS } from "./brain.js";
import { Brain3D } from "./brain3d.js";
import { Stats } from "./stats.js";

const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SLUGS = ["01-shades", "02-heavy", "03-mug", "04-spill", "05-soaked", "06-fists", "07-suit", "08-aiming", "09-firing", "10-blast"];
const pad2 = (n) => String(n).padStart(2, "0");
const set = (id, v) => { const e = $(id); if (e && e.textContent !== v) e.textContent = v; };

function fmtTok(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(1);
}
const fmtEth = (q) => (q >= 1 ? q.toFixed(2) : q >= 0.01 ? q.toFixed(3) : q >= 0.0001 ? q.toFixed(4) : q.toPrecision(2));
const fmtInt = (n) => (n == null ? "-" : Math.round(n).toLocaleString("en-US"));
const clock = (ms) => new Date(ms).toTimeString().slice(0, 8);
let demoMode = false;
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : demoMode ? "demo" : "v4 pool");
const hms = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
};
const spawnedText = (sp) => {
  if (!sp.length) return "adds up";
  const j = sp.filter((s) => s === "joint").length;
  const k = sp.length - j;
  return j ? (j > 1 ? `${j} joints` : "a joint") : k > 1 ? `${k} buzzkills` : "a buzzkill";
};

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("could not load " + src));
    i.src = src;
  });
}

function screen(kind, title, body, pct) {
  const el = $("screen");
  if (!el) return;
  el.hidden = !kind;
  el.dataset.kind = kind || "";
  if (!kind) return;
  set("screen-title", title);
  set("screen-body", body || "");
  $("screen-bar").hidden = pct == null;
  if (pct != null) $("screen-bar").firstElementChild.style.width = `${Math.round(pct * 100)}%`;
}

// ---------- header ----------
function header(cfg) {
  const ca = (cfg.ca || "").toLowerCase();
  const buyUrl = ca ? cfg.buyUrl.replace("{token}", ca) : "";
  document.querySelectorAll("[data-buy]").forEach((a) => {
    if (buyUrl) { a.href = buyUrl; a.target = "_blank"; a.rel = "noopener"; a.removeAttribute("aria-disabled"); }
    else a.addEventListener("click", (e) => e.preventDefault());
  });
  if (ca) {
    set("ca", ca);
    document.querySelectorAll("[data-ca]").forEach((e) => (e.textContent = ca));
    const btn = $("copy");
    btn.hidden = false;
    btn.onclick = async () => {
      await navigator.clipboard.writeText(ca);
      btn.textContent = "COPIED";
      setTimeout(() => (btn.textContent = "COPY"), 1400);
    };
    document.querySelectorAll("[data-pons]").forEach((a) => { a.href = buyUrl; a.hidden = false; });
    document.querySelectorAll("[data-scan]").forEach((a) => { a.href = `${CHAIN.blockscout}/token/${ca}`; a.hidden = false; });
  }
  for (const [key, ids] of [["x", ["x-link"]], ["github", ["gh-link"]]]) {
    if (!cfg[key]) continue;
    for (const id of ids) if ($(id)) { $(id).href = cfg[key]; $(id).hidden = false; }
    document.querySelectorAll(key === "x" ? "[data-x]" : "[data-gh]").forEach((a) => { a.href = cfg[key]; a.hidden = false; });
  }
}

// ---------- the ten-step scale ----------
function buildScale() {
  const ol = $("scale");
  if (!ol) return () => {};
  ol.innerHTML = STAGES.map((s, i) => `<li data-i="${i}"><i></i><span>${pad2(i + 1)} ${s}</span></li>`).join("");
  let last = -1;
  return (stage) => {
    if (stage === last) return;
    last = stage;
    ol.querySelectorAll("li").forEach((li, i) => {
      li.classList.toggle("now", i === stage);
      li.classList.toggle("past", i < stage);
    });
  };
}

// ---------- the reel of ten states ----------
function buildReel() {
  const reel = $("reel");
  if (!reel) return () => {};
  reel.innerHTML = STAGES.map((s, i) => {
    const still = `frames/${pad2(CLIPS[i].frames[Math.floor(CLIPS[i].frames.length / 2)])}.webp`;
    return `<figure data-i="${i}"><img src="${still}" data-still="${still}" data-clip="clips/${SLUGS[i]}-clean.webp" alt="" loading="lazy" width="672" height="720"><figcaption class="mono"><b>${pad2(i + 1)} ${s}</b>${STAGE_NOTES[i]}</figcaption></figure>`;
  }).join("");
  if (!reduced) {
    reel.querySelectorAll("figure").forEach((f) => {
      const img = f.querySelector("img");
      f.addEventListener("mouseenter", () => (img.src = img.dataset.clip));
      f.addEventListener("mouseleave", () => (img.src = img.dataset.still));
    });
  }
  let last = -1;
  return (stage) => {
    if (stage === last) return;
    last = stage;
    reel.querySelectorAll("figure").forEach((f, i) => f.classList.toggle("now", i === stage));
  };
}

// ---------- toasts ----------
function toaster() {
  const box = $("toasts");
  const stack = [];
  function push(el, ms = 4000) {
    box.appendChild(el);
    stack.push(el);
    while (stack.length > 3) drop(stack[0]);
    setTimeout(() => drop(el), ms);
  }
  function drop(el) {
    const i = stack.indexOf(el);
    if (i < 0) return;
    stack.splice(i, 1);
    el.classList.add("out");
    setTimeout(() => el.remove(), 350);
  }
  return {
    trade(r) {
      const el = document.createElement("div");
      el.className = "toast " + (r.side > 0 ? "is-buy" : "is-sell");
      el.dataset.tx = r.tx;
      el.innerHTML = `<span class="who">${short(r.trader)}</span><span class="amt">${r.side > 0 ? "+" : "-"}${fmtEth(r.eth)} ETH</span><span class="what">${r.side > 0 ? "a joint lands" : "buzzkill incoming"}</span>`;
      push(el);
    },
    spill(r) {
      // the big sell gets the full-width card instead of a small one
      for (const el of [...stack]) if (el.dataset.tx === r.tx) drop(el);
      const big = $("bigtoast");
      set("bigtoast-sub", r.cause === "sell" ? `a ${fmtEth(r.eth)} ETH sell knocked it over. two states down.` : "he boiled over. two states down.");
      big.hidden = false;
      clearTimeout(big._t);
      big._t = setTimeout(() => (big.hidden = true), 4000);
      const stage = $("frame");
      if (stage && !reduced) {
        stage.classList.remove("shake");
        void stage.offsetWidth;
        stage.classList.add("shake");
      }
    },
  };
}

// ---------- tape ----------
function tape(live) {
  const box = $("tape");
  const rows = [];
  return (r, fresh) => {
    if (!box) return;
    const demo = live.mode === "demo";
    const el = document.createElement(demo ? "div" : "a");
    el.className = `trow ${r.side > 0 ? "is-buy" : "is-sell"}${fresh ? " fresh" : ""}`;
    if (!demo) { el.href = txUrl(r.tx); el.target = "_blank"; el.rel = "noopener"; }
    el.innerHTML = `<span class="t">${clock(live.timeOf(r))}</span><span class="s">${r.side > 0 ? "BUY" : "SELL"}</span><span class="q r">${r.side > 0 ? "+" : "-"}${fmtEth(r.eth)}</span><span class="r">${fmtTok(r.tok)}</span><span class="w">${short(r.trader)}</span><span class="e">${spawnedText(r.spawned)}</span>`;
    box.prepend(el);
    rows.unshift(el);
    while (rows.length > 40) rows.pop().remove();
    set("empty", "");
    if ($("empty")) $("empty").hidden = true;
  };
}

// ---------- brain section ----------
function atlas(buds) {
  const cv = $("brain-canvas");
  if (!cv) return null;
  // the point-cloud brain when WebGL is there, the flat plate when it is not
  let brain;
  try {
    if (!window.THREE) throw new Error("no three.js");
    brain = new Brain3D(cv, { reduced, mobile: innerWidth < 700 });
    $("atlas").classList.add("scope");
  } catch {
    brain = new Brain(cv, buds, { reduced });
  }
  const view = $("atlas");
  const svg = $("callouts");
  const labels = $("labels");
  set("neurons-total", TOTAL_NEURONS.toLocaleString("en-US"));
  // label slots down the left and right edges, in the order of their
  // anchors' height so no leader line crosses another
  const slot = {};
  for (const side of [-1, 1]) {
    const col = REGIONS.filter((r) => (side < 0 ? r.at[0] < 0.5 || r.key === "bud" : r.at[0] >= 0.5 && r.key !== "bud"));
    col.sort((a, b) => a.at[1] - b.at[1]);
    let prev = -Infinity;
    col.forEach((r) => {
      const ay = 40 + r.at[1] * 560;
      const y = Math.min(600, Math.max(70, ay, prev + 150));
      slot[r.key] = { x: side < 0 ? 18 : 1082, y, side };
      prev = y;
    });
  }
  labels.innerHTML = REGIONS.map((r) => `<div class="label" data-k="${r.key}"><b>${r.name}</b><span>${r.sub}</span><br><em data-hz="${r.key}">- HZ</em></div>`).join("");
  svg.innerHTML = REGIONS.map((r) => `<g data-k="${r.key}"><line class="halo"/><line class="ln"/><circle r="4"/></g>`).join("");
  const place = () => {
    for (const r of REGIONS) {
      const s = slot[r.key];
      const el = labels.querySelector(`[data-k="${r.key}"]`);
      el.style.top = `${(s.y / 660) * 100}%`;
      el.style.transform = "translateY(-50%)";
      if (s.side < 0) { el.style.left = `${(s.x / 1100) * 100}%`; el.style.right = "auto"; }
      else { el.style.right = `${((1100 - s.x) / 1100) * 100}%`; el.style.left = "auto"; }
      const [ax, ay] = brain.anchor(r.key);
      const g = svg.querySelector(`[data-k="${r.key}"]`);
      const lx = s.side < 0 ? s.x + 200 : s.x - 200;
      for (const l of g.querySelectorAll("line")) { l.setAttribute("x1", lx); l.setAttribute("y1", s.y); l.setAttribute("x2", ax); l.setAttribute("y2", ay); }
      const c = g.querySelector("circle");
      c.setAttribute("cx", ax); c.setAttribute("cy", ay);
    }
  };
  const focus = (key) => {
    brain.hover = key;
    view.parentElement.classList.toggle("focus", !!key);
    labels.querySelectorAll(".label").forEach((l) => l.classList.toggle("on", l.dataset.k === key));
    svg.querySelectorAll("g").forEach((g) => g.classList.toggle("on", g.dataset.k === key));
    $("region-card").classList.toggle("on", !!key);
    card();
  };
  const card = () => {
    const key = brain.hover;
    if (!key) return;
    const st = brain.stats(key);
    set("rc-name", st.name);
    set("rc-sub", st.sub);
    set("rc-neurons", st.neurons.toLocaleString("en-US"));
    set("rc-syn", st.synapses.toLocaleString("en-US"));
    set("rc-hz", `${st.hz.toFixed(1)} HZ`);
    set("rc-act", `${Math.round(st.activity * 100)}%`);
    set("rc-joke", st.joke);
  };
  const toCanvas = (e) => {
    const b = cv.getBoundingClientRect();
    return [((e.clientX - b.left) / b.width) * 1100, ((e.clientY - b.top) / b.height) * 660];
  };
  cv.addEventListener("mousemove", (e) => { if (!(brain.dragging && brain.dragging())) focus(brain.regionAt(...toCanvas(e))); });
  cv.addEventListener("mouseleave", () => focus(null));
  labels.querySelectorAll(".label").forEach((l) => {
    l.addEventListener("mouseenter", () => focus(l.dataset.k));
    l.addEventListener("mouseleave", () => focus(null));
  });
  view.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", () => {
    const z = b.dataset.z;
    if (z === "in") brain.zoom = Math.min(2.2, brain.zoom * 1.2);
    if (z === "out") brain.zoom = Math.max(0.7, brain.zoom / 1.2);
    if (z === "rot") brain.rotT = brain.rotT > 0 ? -0.21 : brain.rotT < 0 ? 0 : 0.21;
    if (z === "reset") { brain.zoom = 1; brain.rotT = 0; }
  }));
  new IntersectionObserver((es) => (brain.visible = es[0].isIntersecting)).observe(view);
  let lastLbl = 0;
  return {
    brain,
    tick(now) {
      brain.draw(now);
      if (brain.visible) place();
      if (now - lastLbl > 250) {
        lastLbl = now;
        for (const r of REGIONS) {
          const st = brain.stats(r.key);
          const em = labels.querySelector(`[data-hz="${r.key}"]`);
          em.textContent = `${st.hz.toFixed(1)} HZ · ${Math.round(st.activity * 100)}%`;
          em.parentElement.classList.toggle("hot", st.activity > 0.55);
        }
        card();
        set("atlas-readout", `ZOOM ${brain.zoom.toFixed(2)} · TILT ${Math.round((brain.rot * 180) / Math.PI)}°`);
      }
    },
  };
}

// ---------- the three panels under the brain ----------
// Drawn like the brain itself: dark glass, thin grids, light that glows.
function panels(brain) {
  const m = $("p-matrix"), a = $("p-activity"), c = $("p-cells");
  if (!m) return null;
  const C = { grid: "rgba(237,233,224,0.07)", text: "#9a9285", hi: "#EDE9E0", bud: "#b5cc6a", budDim: "rgba(181,204,106,", ember: "#E8541E", yellow: "#F5A623", blood: "#e0533f" };
  const coact = REGIONS.map(() => REGIONS.map(() => 0));
  const buckets = new Map(); // 10 s bucket -> {b, s}
  const moods = [];
  const font = (px, w = 400) => `${w} ${px}px 'IBM Plex Mono', monospace`;
  // crisp on any DPR: size each buffer from its CSS box
  const fit = (cv) => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = cv.clientWidth, h = Math.round(w * (cv.dataset.ratio || 0.55));
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + "px"; }
    const x = cv.getContext("2d");
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    return [x, w, h];
  };
  const gridLines = (x, w, h, step) => {
    x.strokeStyle = C.grid;
    x.lineWidth = 1;
    x.beginPath();
    for (let gx = 0.5; gx < w; gx += step) { x.moveTo(gx, 0); x.lineTo(gx, h); }
    for (let gy = 0.5; gy < h; gy += step) { x.moveTo(0, gy); x.lineTo(w, gy); }
    x.stroke();
  };
  const glow = (x, color, blur) => { x.shadowColor = color; x.shadowBlur = blur; };
  const noGlow = (x) => { x.shadowBlur = 0; };
  let t0 = performance.now();
  return {
    trade(r, t) {
      const k = Math.floor(t / 10000);
      const v = buckets.get(k) || { b: 0, s: 0 };
      if (r.side > 0) v.b++; else v.s++;
      buckets.set(k, v);
    },
    fired(key) {
      const i = REGIONS.findIndex((g) => g.key === key);
      for (let j = 0; j < REGIONS.length; j++) if (brain.act[REGIONS[j].key] > 0.3) { coact[i][j] += 1; coact[j][i] += 1; }
    },
    draw(S, now) {
      if (!moods.length || now - moods.at(-1).t > 2000) { moods.push({ t: now, v: S.mood }); if (moods.length > 160) moods.shift(); }
      const scan = ((now - t0) / 3000) % 1;

      // connectivity: a lattice of nodes, brighter and warmer where regions fire together
      let [x, W, H] = fit(m);
      gridLines(x, W, H, 16);
      const n = REGIONS.length;
      const cell = Math.min((W - 110) / n, (H - 30) / n);
      const ox = Math.round((W - n * cell) / 2 + 36), oy = Math.round((H - n * cell) / 2) - 4;
      const mx = Math.max(1, ...coact.flat());
      x.font = font(10);
      x.textAlign = "right";
      REGIONS.forEach((g, i) => {
        x.fillStyle = brain.act[g.key] > 0.5 ? C.yellow : C.text;
        x.fillText(g.name.split(" ")[0], ox - 10, oy + i * cell + cell / 2 + 3);
        for (let j = 0; j < n; j++) {
          const v = Math.min(1, brain.conn[i][j] * 0.5 + (coact[i][j] / mx) * 0.7);
          const cx = ox + j * cell + cell / 2, cy = oy + i * cell + cell / 2;
          const r = 2 + v * (cell * 0.36);
          const col = i === j ? C.hi : v > 0.75 ? C.yellow : v > 0.5 ? C.ember : C.budDim + (0.25 + v * 0.75) + ")";
          if (v > 0.5 || i === j) glow(x, col, 10);
          x.fillStyle = col;
          x.beginPath();
          x.arc(cx, cy, r, 0, 6.283);
          x.fill();
          noGlow(x);
        }
      });
      // a slow scan line across the lattice
      const sy = oy + scan * n * cell;
      x.strokeStyle = "rgba(245,166,35,0.35)";
      x.beginPath(); x.moveTo(ox - 4, sy); x.lineTo(ox + n * cell + 4, sy); x.stroke();

      // activity: glowing bars and the mood trace over the last 5 minutes
      [x, W, H] = fit(a);
      gridLines(x, W, H, 20);
      const mid = Math.round(H * 0.5), padL = 30, bw = (W - padL - 8) / 30;
      const nowK = Math.floor(Date.now() / 10000);
      const vals = [];
      for (let i = 29; i >= 0; i--) vals.push(buckets.get(nowK - i) || { b: 0, s: 0 });
      const top = Math.max(4, ...vals.map((v) => Math.max(v.b, v.s)));
      x.strokeStyle = "rgba(237,233,224,0.25)";
      x.beginPath(); x.moveTo(padL, mid + 0.5); x.lineTo(W, mid + 0.5); x.stroke();
      vals.forEach((v, i) => {
        const px = padL + i * bw + 2, w = Math.max(2, bw - 4), hb = (v.b / top) * (mid - 16), hs = (v.s / top) * (mid - 16);
        if (hb) { glow(x, C.bud, 8); x.fillStyle = C.bud; x.fillRect(px, mid - hb, w, hb); }
        if (hs) { glow(x, C.blood, 8); x.fillStyle = C.blood; x.fillRect(px, mid + 1, w, hs); }
        noGlow(x);
      });
      x.font = font(10);
      x.textAlign = "left";
      x.fillStyle = C.text;
      x.fillText(`+${top}`, 2, 14);
      x.fillText(`-${top}`, 2, H - 6);
      x.fillText("-5m", padL, H - 6);
      x.textAlign = "right";
      x.fillText("now", W - 2, H - 6);
      if (moods.length > 1) {
        const tt = now - 300000;
        const pts = moods.map((p) => [padL + ((p.t - tt) / 300000) * (W - padL - 8), 12 + p.v * (H - 30)]).filter((p) => p[0] >= padL);
        if (pts.length > 1) {
          const g = x.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, "rgba(232,84,30,0.28)");
          g.addColorStop(1, "rgba(232,84,30,0)");
          x.beginPath();
          x.moveTo(pts[0][0], H);
          for (const [px, py] of pts) x.lineTo(px, py);
          x.lineTo(pts.at(-1)[0], H);
          x.fillStyle = g;
          x.fill();
          glow(x, C.ember, 12);
          x.strokeStyle = C.yellow;
          x.lineWidth = 1.6;
          x.beginPath();
          pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
          x.stroke();
          const [lx, ly] = pts.at(-1);
          x.fillStyle = "#fff";
          x.beginPath(); x.arc(lx, ly, 3, 0, 6.283); x.fill();
          noGlow(x);
          x.lineWidth = 1;
        }
      }

      // cell types: segmented LED bars, the leading type lit in ember
      [x, W, H] = fit(c);
      gridLines(x, W, H, 16);
      const pile = Math.max(0, 1 - Math.min(1, S.melt) / 0.8);
      const wts = { GIGGLY: 1 - S.mood, SLEEPY: S.high * 0.8 + 0.1, HUNGRY: 0.9, PARANOID: 0.15 + S.kills.length / 10, FURIOUS: S.mood * S.mood * 1.4, HOARDING: pile * 0.7 };
      const sum = Object.values(wts).reduce((p, q) => p + q, 0);
      const keys = Object.keys(wts);
      const lead = Math.max(...Object.values(wts));
      const rowH = (H - 16) / keys.length, barX = 86, barW = W - barX - 70, seg = 5, segs = Math.floor(barW / seg);
      keys.forEach((k, i) => {
        const y = 10 + i * rowH, lit = Math.round((wts[k] / lead) * segs), isLead = wts[k] === lead;
        x.font = font(10);
        x.textAlign = "left";
        x.fillStyle = isLead ? C.yellow : C.text;
        x.fillText(k, 0, y + rowH / 2 + 3);
        for (let sgi = 0; sgi < segs; sgi++) {
          const on = sgi < lit;
          x.fillStyle = on ? (isLead ? C.ember : C.bud) : "rgba(237,233,224,0.06)";
          if (on && sgi === lit - 1) glow(x, isLead ? C.yellow : C.bud, 10);
          x.fillRect(barX + sgi * seg, y + rowH * 0.25, seg - 2, rowH * 0.5);
          noGlow(x);
        }
        x.textAlign = "right";
        x.font = font(11, 500);
        x.fillStyle = isLead ? C.hi : C.text;
        x.fillText(Math.round((wts[k] / sum) * TOTAL_NEURONS).toLocaleString("en-US"), W, y + rowH / 2 + 4);
      });
    },
  };
}

// ---------- boot ----------
async function boot() {
  const cfg = await loadConfig();
  header(cfg);
  const scale = buildScale();
  const reel = buildReel();
  const toast = $("toasts") ? toaster() : null;

  screen("load", "LOADING", "reading the frames", 0);
  const framesP = Promise.all(FRAME_NUMBERS.map((n) => loadImage(`frames/${pad2(n)}.webp`).then((img) => [n, img]))).then((l) => new Map(l));
  const budsImgP = loadImage("frames/buds.webp");

  let renderer, at, pan, stats;
  let stageSince = Date.now(), shownStage = -1, lastHud = 0;
  const recent = [];
  const heroClip = $("hero-clip");
  let row;

  const live = new Live(cfg, {
    progress: (title, body, pct) => screen(title ? "load" : null, title, body, pct),
    error: (title, body) => screen("error", title, body),
    ready: (lv) => {
      document.body.dataset.mode = lv.mode;
      demoMode = lv.mode === "demo";
      const badge = $("badge");
      if (badge) { badge.textContent = { demo: "DEMO", direct: "LOCAL", collector: "SYNC" }[lv.mode]; badge.dataset.mode = lv.mode; }
      const m = lv.feed.meta;
      if (lv.mode !== "demo" && m) {
        set("watching", `watching ${m.symbol}${m.name ? " / " + m.name : ""} · ${short(m.token)}`);
        document.querySelectorAll("[data-symbol]").forEach((e) => (e.textContent = cfg.name || "WEEDBRAIN"));
        if (lv.mode === "direct" || lv.mode === "collector") {
          // its own client, so the counters queue behind each other and not behind the live poll
          stats = new Stats(makeRpc(), m, () => {}, lv.mode === "direct" ? lv.feed : null);
          setTimeout(() => stats.start(), 1500);
        }
      }
      row = tape(lv);
    },
    record: (r, isLive) => {
      if (renderer) renderer.handle(r, isLive);
      if (r.t === "trade") {
        row && row(r, isLive);
        recent.push({ t: live.timeOf(r), side: r.side });
        if (pan) pan.trade(r, live.timeOf(r));
        if (stats && isLive) stats.addTrade(r.blk);
        if (isLive && toast && r.eth > 0) toast.trade(r);
        if (isLive && at) { if (r.side > 0) { at.brain.fire("cb1", 0.6); at.brain.fire("munchie", 0.15); pan.fired("cb1"); } else { at.brain.fire("ember", 0.5); pan.fired("ember"); } }
      } else if (isLive && at) {
        if (r.t === "kill") { at.brain.fire("paranoia", 0.4); pan.fired("paranoia"); }
        if (r.t === "repel") at.brain.fire("cb1", 0.2);
        if (r.t === "arrive") { at.brain.fire("paranoia", 0.5); at.brain.fire("ember", 0.3); }
        if (r.t === "spill") { at.brain.fire("mug", 1); pan.fired("mug"); }
        if (r.t === "refill") at.brain.fire("mug", 0.5);
      }
      if (r.t === "spill" && isLive && toast) toast.spill(r);
    },
    frame: (S, now) => {
      if (renderer) { renderer.syncEntities(S); renderer.draw(S, now); }
      if (at) { at.brain.track(S); at.tick(now); }
      if (S.stage !== shownStage) {
        shownStage = S.stage;
        stageSince = Date.now();
        if (heroClip) heroClip.src = reduced ? `frames/${pad2(CLIPS[S.stage].frames[0])}.webp` : `clips/${SLUGS[S.stage]}-clean.webp`;
        scale(S.stage);
        reel(S.stage);
      }
      if (now - lastHud > 200) {
        lastHud = now;
        hud(S);
        if (pan) pan.draw(S, now);
      }
      if ($("empty")) $("empty").hidden = S.evCount > 0;
    },
    stale: (isStale, lastOk) => {
      const el = $("stale");
      if (!el) return;
      el.hidden = !isStale;
      if (isStale) el.textContent = `RPC NOT ANSWERING · LAST STATE ${clock(lastOk)}`;
    },
  });

  function hud(S) {
    const n = S.joints.length;
    const pile = Math.max(0, 1 - Math.min(1, S.melt) / 0.8);
    set("hero-stage", `${pad2(S.stage + 1)}/10 ${STAGES[S.stage]}`);
    set("hero-joints", `${n} JOINT${n === 1 ? "" : "S"} BURNING`);
    set("hero-time", hms(Date.now() - stageSince));
    set("hash", `${simHash(S)} @${S.step}`);
    set("g-mood", STAGES[S.stage]);
    set("g-joints", String(n));
    set("g-pile", `${Math.round(pile * 100)}%`);
    set("g-mug", S.spilled ? "SPILLED" : "FULL");
    const cut = live.now() - 300000;
    while (recent.length && recent[0].t < cut) recent.shift();
    const b5 = recent.filter((x) => x.side > 0).length;
    set("g-flow", `${b5} / ${recent.length - b5}`);
    if ($("m-joints")) {
      $("m-mood").style.width = `${Math.round(S.mood * 100)}%`;
      $("m-joints").style.width = `${Math.min(100, (n / 8) * 100)}%`;
      $("m-pile").style.width = `${Math.round(pile * 100)}%`;
    }
    set("c-state", STAGES[S.stage]);
    const f = live.feed;
    if (live.mode === "demo") {
      set("c-holders", "n/a");
      set("c-trades", fmtInt(S.evCount));
      set("c-mcap", S.px > 0 ? (S.px * 1e9).toFixed(2) : "-");
      set("c-updated", "DEMO");
      set("c-block", fmtInt(S.step));
    } else {
      set("c-holders", fmtInt(stats && stats.holders));
      set("c-trades", fmtInt(stats && stats.trades24));
      const mc = stats && stats.mcapEth(S.px);
      set("c-mcap", mc == null ? "-" : mc >= 100 ? fmtInt(mc) : mc.toFixed(2));
      set("c-updated", `${Math.max(0, Math.round((Date.now() - f.lastOk) / 1000))} S AGO`);
      set("c-block", fmtInt(f.headBlk));
    }
  }

  const ok = await live.start();
  if (!ok) return;
  const [frames, budsImg] = await Promise.all([framesP, budsImgP]);
  if ($("scene")) {
    const c = document.createElement("canvas");
    c.width = budsImg.width;
    c.height = budsImg.height;
    const x = c.getContext("2d");
    x.drawImage(budsImg, 0, 0);
    renderer = new Renderer($("art"), $("scene"), frames, x.getImageData(0, 0, c.width, c.height), { reducedMotion: reduced });
    renderer.syncEntities(live.S);
  }
  at = atlas(budsImg);
  if (at) pan = panels(at.brain);
  window.__wb = { live, get S() { return live.S; }, get renderer() { return renderer; }, get brain() { return at && at.brain; }, get stats() { return stats; } };
}

boot().catch((e) => screen("error", "SOMETHING BROKE", e.message));
