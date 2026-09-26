// Page glue: boot sequence, the frame loop, HUD, trade feed and popups.
import { genesis, runTo, simHash, STAGES, STAGE_NOTES, restore } from "./engine.js";
import { DirectFeed, DemoFeed, CsvFeed } from "./feed.js";
import { txUrl, CHAIN } from "./chain.js";
import { Renderer, SCENE, FRAME_NUMBERS } from "./render.js";

const $ = (id) => document.getElementById(id);
const LAG_STEPS = 60; // the scene runs 3 s behind the chain head so the feed can land first
const RESYNC = 200; // fall this far behind and the page goes back to catching up
const BUDGET_SYNC = 10;
const BUDGET_LIVE = 6;

let clockOffset = 0;
let holdAt = 0;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function fmtAmount(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  if (a >= 1) return n.toFixed(1);
  return n.toPrecision(2);
}
// under the spawn threshold a trade adds to the pool the next entity is made of
function spawnedText(sp) {
  if (!sp.length) return "adds up";
  const j = sp.filter((s) => s === "joint").length;
  const k = sp.length - j;
  return j ? (j > 1 ? `${j} joints` : "joint") : k > 1 ? `${k} buzzkills` : "buzzkill";
}
const clock = (ms) => new Date(ms).toTimeString().slice(0, 8);
const short = (a) => a.slice(0, 6) + "..." + a.slice(-4);

function screen(kind, title, body, pct) {
  const el = $("screen");
  el.hidden = !kind;
  el.dataset.kind = kind || "";
  if (!kind) return;
  $("screen-title").textContent = title;
  $("screen-body").textContent = body || "";
  const bar = $("screen-bar");
  bar.hidden = pct == null;
  if (pct != null) bar.firstElementChild.style.width = `${Math.round(pct * 100)}%`;
}

async function loadConfig() {
  const r = await fetch("weedbrain.config.json", { cache: "no-store" });
  return r.json();
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("could not load " + src));
    i.src = src;
  });
}

async function boot() {
  const cfg = await loadConfig();
  document.querySelectorAll("[data-ticker]").forEach((e) => (e.textContent = "$" + cfg.ticker));
  const mode = !cfg.token ? "demo" : cfg.mode === "collector" ? "collector" : "direct";
  const badge = { demo: "DEMO", direct: "LOCAL", collector: "SYNC" }[mode];
  $("badge").textContent = badge;
  $("badge").dataset.mode = mode;
  document.body.dataset.mode = mode;

  screen("load", "LOADING", "reading the frames", 0);
  // every frame of every clip, plus the bud texture the pile is cut from
  const framesP = Promise.all(FRAME_NUMBERS.map((n) => loadImage(`frames/${String(n).padStart(2, "0")}.webp`).then((img) => [n, img]))).then((l) => new Map(l));
  const budsP = loadImage("frames/buds.webp").then((img) => {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    return x.getImageData(0, 0, img.width, img.height);
  });

  let feed;
  try {
    if (mode === "demo") {
      // ?at=<ms or ISO time> shows that moment of the demo; it is deterministic
      const at = new URLSearchParams(location.search).get("at");
      if (at) {
        const atMs = /^\d+$/.test(at) ? Number(at) : Date.parse(at);
        clockOffset = atMs - Date.now();
        // &hold stops the clock at that moment: a permalink to one state
        if (new URLSearchParams(location.search).has("hold")) holdAt = atMs;
      }
      feed = new DemoFeed(Date.now() + clockOffset);
    } else if (mode === "collector") {
      feed = new CsvFeed(cfg);
      await feed.init((phase, p) => screen("load", "LOADING", phase === "snapshot" ? "reading the state snapshot" : "reading the log tail", p));
    } else {
      feed = new DirectFeed(cfg);
      await feed.init((phase, p) =>
        screen("load", "LOADING", phase === "resolve" ? "finding the token on Pons v2" : "reading trades from Robinhood Chain", phase === "resolve" ? 0.05 : 0.05 + p * 0.95),
      );
    }
  } catch (e) {
    if (e.code === "bad-address" || e.code === "not-pons") {
      screen("error", e.code === "bad-address" ? "NOT AN ADDRESS" : "NOT A PONS TOKEN", `${e.message} Check the "token" field in weedbrain.config.json.`);
    } else {
      screen("error", "CANNOT REACH THE CHAIN", `${e.message}. The page retries in 10 seconds.`);
      setTimeout(() => location.reload(), 10000);
    }
    return;
  }
  const [frames, buds] = await Promise.all([framesP, budsP]);

  const meta = feed.meta;
  const symbol = mode === "demo" ? "DEMO" : meta.symbol;
  if (mode !== "demo") {
    $("token").textContent = short(meta.token);
    $("token").href = `${CHAIN.blockscout}/token/${meta.token}`;
    $("token").title = meta.token;
    // the buy button only points at our own contract, never at a token
    // borrowed for testing
    if (cfg.ca && cfg.ca.toLowerCase() === meta.token) $("buy").href = cfg.buyUrl.replace("{token}", meta.token);
    else $("buy").hidden = true;
    $("watching").textContent = `${meta.symbol}${meta.name ? " / " + meta.name : ""}`;
  }

  // start the sim: from a snapshot when the collector has one, else from genesis
  let S;
  if (feed.snap) {
    try { S = restore(feed.snap); } catch { S = genesis(feed.seed); }
  } else {
    S = genesis(feed.seed);
  }
  let idx = 0;
  while (idx < feed.events.length && feed.events[idx].step < S.step) idx++;

  const popups = $("popups");
  const renderer = new Renderer($("art"), $("scene"), frames, buds, {
    reducedMotion: reduced,
    onPopup: (p) => {
      const el = document.createElement("div");
      el.className = "pop " + (p.side > 0 ? "buy" : "sell");
      el.textContent = `${p.side > 0 ? "BUY" : "SELL"} ${fmtAmount(p.tok)} $${symbol}`;
      // from scene pixels to the frame box, which on a phone crops the scene
      const cr = $("scene").getBoundingClientRect();
      const fr = $("frame").getBoundingClientRect();
      const px = cr.left + (p.x / SCENE.RW) * cr.width - fr.left;
      const py = cr.top + (p.y / SCENE.RH) * cr.height - fr.top;
      el.style.left = `${Math.max(12, Math.min(88, (px / fr.width) * 100))}%`;
      el.style.top = `${(py / fr.height) * 100}%`;
      popups.appendChild(el);
      setTimeout(() => el.remove(), 2400);
    },
  });

  const feedList = $("feed-list");
  const rows = [];
  function addRow(r) {
    const when = mode === "demo" ? feed.genesisTs + r.step * 50 : feed.headAt - (feed.headBlk - r.blk) * CHAIN.blockMs;
    const li = document.createElement(mode === "demo" ? "div" : "a");
    li.className = "row " + (r.side > 0 ? "buy" : "sell");
    if (mode !== "demo") { li.href = txUrl(r.tx); li.target = "_blank"; li.rel = "noopener"; }
    const what = spawnedText(r.spawned);
    li.innerHTML = `<span class="t">${clock(when)}</span><span class="s">${r.side > 0 ? "BUY" : "SELL"}</span><span class="a">${fmtAmount(r.tok)}</span><span class="w">${what}</span>`;
    feedList.prepend(li);
    rows.unshift(li);
    while (rows.length > 20) rows.pop().remove();
    $("empty").hidden = true;
  }

  let syncing = true;
  let lastHud = 0;
  let polling = false;

  function target(now) {
    if (mode === "demo") {
      const t = feed.liveStep(now) - 20;
      feed.generate(t + 1);
      return t;
    }
    return Math.min(feed.safeStep(), feed.liveStep(now) - LAG_STEPS);
  }

  async function pollLoop() {
    if (mode === "demo" || polling) return;
    polling = true;
    await feed.poll();
    polling = false;
    const stale = feed.error && Date.now() - feed.lastOk > 8000;
    $("stale").hidden = !stale;
    if (stale) $("stale").textContent = `RPC not answering. Showing the last known state from ${clock(feed.lastOk)}.`;
  }
  if (mode !== "demo") setInterval(pollLoop, feed.pollMs || cfg.pollMs || 1500);

  function drain(live) {
    for (const r of S.out) {
      renderer.handle(r, live);
      if (r.t === "trade") addRow(r);
    }
    S.out.length = 0;
  }

  function hud() {
    $("stage").textContent = STAGES[S.stage];
    $("note").textContent = STAGE_NOTES[S.stage];
    const lvl = Math.max(0, 1 - S.mood);
    $("levelbar").style.width = `${Math.round(lvl * 100)}%`;
    $("levelbar").classList.toggle("low", lvl <= 0.5);
    const n = S.joints.length;
    $("joints").textContent = n === 0 ? "nothing" : `${n} joint${n === 1 ? "" : "s"}`;
    $("pile").textContent = `${Math.round(Math.max(0, 1 - Math.min(1, S.melt) / 0.8) * 100)}%`;
    $("mug").textContent = S.spilled ? "spilled" : "full";
    $("repelled").textContent = String(S.repelled);
    $("total").textContent = String(S.repelled + S.arrived);
    $("arrived").textContent = String(S.arrived);
    $("walking").textContent = String(S.kills.length);
    $("hash").textContent = `${simHash(S)} @${S.step}`;
  }

  screen("sync", "REPLAYING", "catching up with the log", 0);
  const startStep = S.step;

  function frame(now) {
    const wall = holdAt || Date.now() + clockOffset;
    const tgt = target(wall);
    const behind = tgt - S.step;
    if (!syncing && behind > RESYNC) syncing = true;
    if (syncing) {
      idx = runTo(S, feed.events, idx, tgt, { budgetMs: BUDGET_SYNC, now: () => performance.now() });
      // during catch-up the feed still fills, but nothing flies across the scene
      drain(false);
      const span = Math.max(1, tgt - startStep);
      screen("sync", "REPLAYING", `${S.step.toLocaleString()} of ${tgt.toLocaleString()} steps`, Math.min(1, (S.step - startStep) / span));
      if (tgt - S.step <= 4) {
        syncing = false;
        screen(null);
        renderer.syncEntities(S);
      }
    } else if (behind > 0) {
      idx = runTo(S, feed.events, idx, tgt, { budgetMs: BUDGET_LIVE, now: () => performance.now() });
      drain(true);
    }
    if (!syncing) {
      renderer.syncEntities(S);
      renderer.draw(S, now);
      if (wall - lastHud > 100) { hud(); lastHud = wall; }
      $("empty").hidden = S.evCount > 0 || rows.length > 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // mobile: the feed hides under a button
  $("feed-toggle").addEventListener("click", () => document.body.classList.toggle("feed-open"));
  window.__wb = { get S() { return S; }, feed, renderer };
}

boot().catch((e) => screen("error", "SOMETHING BROKE", e.message));
