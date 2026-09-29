// Feed layer: turns chain trades into sim events and keeps the log.
// Three sources share one shape: direct (this browser reads the RPC),
// collector (a process writes hourly CSV shards, everyone reads them) and
// demo (a seeded generator, clearly marked as not real).

import { SIM, srnd, seedFromString } from "./engine.js";
import { makeRpc, resolveToken, readTrades, headBlock, isGraduated, CHAIN } from "./chain.js";

export const LOG_HEADER = "step,side,eth,tok,px,blk,li,tx";

/** Blocks of the grid a watch window starts on, so viewers in the same hour share a genesis. */
export const GENESIS_GRID = 36000;

/**
 * Blocks behind the reported head that a poll stops at. A node can report a
 * new head a moment before its logs are queryable; reading up to the head
 * and marking it done would lose those trades for good.
 */
export const SAFE_MARGIN = 5;

export const stepOfBlock = (blk, genesisBlk) => (blk - genesisBlk) * SIM.STEPS_PER_BLOCK;

/**
 * rate turns the quote amount into ETH for tokens paired with something
 * else (a stock token, a stablecoin). It is a fixed number from the config,
 * not a live price, so the log and the hash stay reproducible.
 */
export function tradeToEvent(t, genesisBlk, rate = 1) {
  return {
    step: stepOfBlock(t.blk, genesisBlk),
    side: t.side,
    eth: t.quote * rate,
    tok: t.tok,
    px: t.px * rate,
    blk: t.blk,
    li: t.li,
    tx: t.tx,
    trader: t.trader || "",
  };
}

/** Canonical order: step, block, log index, tx hash. */
export function eventOrder(a, b) {
  return a.step - b.step || a.blk - b.blk || a.li - b.li || (a.tx < b.tx ? -1 : a.tx > b.tx ? 1 : 0);
}

export const eventKey = (e) => `${e.tx}:${e.li}`;

export function toCsvRow(e) {
  return [e.step, e.side, e.eth, e.tok, e.px, e.blk, e.li, e.tx].join(",");
}

/** Parse a CSV shard. Bad rows are skipped and counted, never thrown. */
export function parseCsv(text) {
  const events = [];
  let bad = 0;
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("step")) continue;
    const p = line.split(",");
    if (p.length < 8) { bad++; continue; }
    const e = {
      step: Number(p[0]), side: Number(p[1]), eth: Number(p[2]), tok: Number(p[3]),
      px: Number(p[4]), blk: Number(p[5]), li: Number(p[6]), tx: p[7].trim(),
    };
    if (!Number.isInteger(e.step) || e.step < 0 || (e.side !== 1 && e.side !== -1) || !/^0x[0-9a-f]{64}$/.test(e.tx)) {
      bad++;
      continue;
    }
    events.push(e);
  }
  return { events, bad };
}

/** Merge new events into a sorted, deduped list in place. Returns how many were new. */
export function mergeEvents(list, seen, incoming) {
  let added = 0;
  for (const e of incoming) {
    const k = eventKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    list.push(e);
    added++;
  }
  if (added) list.sort(eventOrder);
  return added;
}

/**
 * Pick the genesis block. Our own token starts at its launch block. A
 * foreign token watched for tests starts lookbackMin back, rounded down to
 * an hour grid so viewers who open the page in the same hour agree.
 */
export function pickGenesis(meta, head, { genesisBlock = 0, lookbackMin = 0 } = {}) {
  if (genesisBlock > 0) return genesisBlock;
  if (lookbackMin > 0) {
    const back = Math.round((lookbackMin * 60000) / CHAIN.blockMs);
    const g = Math.floor((head - back) / GENESIS_GRID) * GENESIS_GRID;
    if (!meta.launchBlock || g > meta.launchBlock) return g;
  }
  return meta.launchBlock || head;
}

// ---- direct source -------------------------------------------------------

/**
 * Reads the RPC itself. safeBlk is the last block fully read: the sim never
 * steps past it, so an event can never arrive for a step already played.
 */
export class DirectFeed {
  constructor(cfg) {
    this.cfg = cfg;
    this.rpc = makeRpc(cfg.rpc || CHAIN.rpc);
    this.events = [];
    this.seen = new Set();
    this.meta = null;
    this.genesisBlk = 0;
    this.headBlk = 0;
    this.headAt = 0;
    this.safeBlk = 0;
    this.lastOk = 0;
    this.error = null;
    this.polls = 0;
    this.pollMs = cfg.pollMs || 1500;
    this.rate = Number(cfg.quoteToEth) > 0 ? Number(cfg.quoteToEth) : 1;
  }

  async init(onProgress = () => {}) {
    onProgress("resolve", 0);
    this.meta = await resolveToken(this.rpc, this.cfg.token);
    const head = (await headBlock(this.rpc)) - SAFE_MARGIN;
    this.genesisBlk = pickGenesis(this.meta, head, this.cfg);
    this.seed = seedFromString(this.meta.token + ":" + this.genesisBlk);
    const trades = await readTrades(this.rpc, this.meta, this.genesisBlk, head, {
      curve: true,
      pool: true,
      onProgress: (p) => onProgress("history", p),
    });
    mergeEvents(this.events, this.seen, trades.map((t) => tradeToEvent(t, this.genesisBlk, this.rate)));
    this.headBlk = head;
    this.headAt = Date.now();
    this.safeBlk = head;
    this.lastOk = Date.now();
    return this;
  }

  /** One poll. Returns the new events (possibly none). Errors are kept, not thrown. */
  async poll() {
    try {
      const head = (await headBlock(this.rpc)) - SAFE_MARGIN;
      this.polls++;
      let fresh = [];
      if (head > this.safeBlk) {
        // One log leg per poll. The v4 pool only exists after graduation, and
        // the graduated flag is read at this same head block, so "not
        // graduated at head" proves there is no swap to miss in the range.
        // On the poll where it flips, both legs are read.
        if (!this.meta.graduated) this.meta.graduated = await isGraduated(this.rpc, this.meta, head);
        const trades = await readTrades(this.rpc, this.meta, this.safeBlk + 1, head, {
          curve: !this.curveDone,
          pool: this.meta.graduated,
        });
        if (this.meta.graduated) this.curveDone = this.curveDone || this.curveSeenGraduated;
        this.curveSeenGraduated = this.meta.graduated;
        fresh = trades.map((t) => tradeToEvent(t, this.genesisBlk, this.rate));
        mergeEvents(this.events, this.seen, fresh);
        this.safeBlk = head;
      }
      this.headBlk = head;
      this.headAt = Date.now();
      this.lastOk = Date.now();
      this.error = null;
      return fresh;
    } catch (e) {
      this.error = e;
      return [];
    }
  }

  /** Highest step the sim may reach: the first step of the first unread block. */
  safeStep() {
    return stepOfBlock(this.safeBlk + 1, this.genesisBlk);
  }

  /** Where the chain is now, extrapolated from the last head at ~101 ms a block. */
  liveStep(now = Date.now()) {
    return stepOfBlock(this.headBlk, this.genesisBlk) + Math.floor((now - this.headAt) / SIM.STEP_MS);
  }
}

// ---- demo source ---------------------------------------------------------

export const DEMO_EPOCH_MS = 3600 * 1000;

/**
 * Seeded trade generator for the demo mode. Each wall-clock hour is its own
 * epoch starting from genesis, so every viewer in that hour sees the same
 * thing. Regimes (pump, dump, chop, quiet) switch every two minutes so all
 * ten stages show up within an epoch.
 */
export class DemoFeed {
  constructor(now = Date.now()) {
    this.epoch = Math.floor(now / DEMO_EPOCH_MS);
    this.genesisTs = this.epoch * DEMO_EPOCH_MS;
    this.seed = seedFromString("weedbrain-demo:" + this.epoch);
    this.events = [];
    this.genStep = 0;
    this.px = 1e-8;
    this.meta = { token: "", symbol: "DEMO", pairSymbol: "ETH", decimals: 18 };
    this.genesisBlk = 0;
  }

  regime(step) {
    const r = srnd(this.seed, Math.floor(step / 2400), 2);
    return r < 0.35 ? "pump" : r < 0.55 ? "dump" : r < 0.85 ? "chop" : "quiet";
  }

  /** Generate events up to (not including) step. */
  generate(toStep) {
    const out = [];
    for (let s = this.genStep; s < toStep; s++) {
      const reg = this.regime(s);
      const rate = reg === "quiet" ? 0.004 : reg === "chop" ? 0.02 : 0.03;
      if (srnd(this.seed, s, 1) >= rate) continue;
      const buyBias = reg === "pump" ? 0.75 : reg === "dump" ? 0.25 : 0.56;
      const side = srnd(this.seed, s, 3) < buyBias ? 1 : -1;
      const u = srnd(this.seed, s, 4);
      const eth = SIM.SIZE_REF * (0.03 + u * u * u * 14);
      const a = 0.0035 * Math.min(3, eth / SIM.SIZE_REF);
      // symmetric in log terms, so a balanced flow does not drift down
      this.px = side > 0 ? this.px * (1 + a) : this.px / (1 + a);
      if (this.px < 1e-10) this.px = 1e-10;
      const hx = (n) => (srnd(this.seed, s, n) * 4294967296 >>> 0).toString(16).padStart(8, "0");
      const tx = "0x" + hx(10) + hx(11) + hx(12) + hx(13) + hx(14) + hx(15) + hx(16) + hx(17);
      const e = { step: s, side, eth, tok: eth / this.px, px: this.px, blk: s, li: 0, tx };
      out.push(e);
      this.events.push(e);
    }
    this.genStep = Math.max(this.genStep, toStep);
    return out;
  }

  liveStep(now = Date.now()) {
    return Math.floor((now - this.genesisTs) / SIM.STEP_MS);
  }
}

// ---- collector source ----------------------------------------------------

/**
 * Reads what ingest/ingest.js writes: meta.json, state.json (a snapshot)
 * and hourly CSV shards. The tail shard is re-read with a Range request.
 */
export class CsvFeed {
  constructor(cfg, fetchImpl) {
    this.base = (cfg.dataUrl || "/data/").replace(/\/?$/, "/");
    this.f = fetchImpl || globalThis.fetch.bind(globalThis);
    this.events = [];
    this.seen = new Set();
    this.offsets = new Map();
    this.meta = null;
    this.snap = null;
    this.error = null;
    this.lastOk = 0;
    this.bad = 0;
    this.pollMs = 2000;
  }

  async json(path) {
    const r = await this.f(this.base + path + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  async init(onProgress = () => {}) {
    onProgress("snapshot", 0);
    this.m = await this.json("meta.json");
    this.meta = this.m.token;
    this.genesisBlk = this.m.genesisBlk;
    this.seed = this.m.seed;
    try {
      this.snap = await this.json("state.json");
    } catch {
      this.snap = null;
    }
    onProgress("snapshot", 1);
    const shards = this.m.shards || [];
    const from = this.snap ? this.snap.step : 0;
    const need = this.snap ? shards.filter((s) => s.lastStep >= from) : shards;
    let i = 0;
    for (const s of need) {
      await this.readShard(s.file, true);
      onProgress("history", ++i / need.length);
    }
    this.lastOk = Date.now();
    return this;
  }

  async readShard(file, full) {
    const off = full ? 0 : this.offsets.get(file) || 0;
    const r = await this.f(this.base + file, { cache: "no-store", headers: off ? { Range: `bytes=${off}-` } : {} });
    if (r.status === 416) return [];
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    let text = await r.text();
    if (off && r.status === 200) text = text.slice(off);
    const nl = text.lastIndexOf("\n");
    const complete = nl >= 0 ? text.slice(0, nl + 1) : "";
    this.offsets.set(file, off + new TextEncoder().encode(complete).length);
    const { events, bad } = parseCsv(complete);
    this.bad += bad;
    const fresh = events.filter((e) => !this.seen.has(eventKey(e)));
    mergeEvents(this.events, this.seen, events);
    return fresh;
  }

  async poll() {
    try {
      this.m = await this.json("meta.json");
      let fresh = [];
      for (const s of this.m.shards || []) {
        if (!this.offsets.has(s.file)) fresh = fresh.concat(await this.readShard(s.file, true));
      }
      const tail = (this.m.shards || []).at(-1);
      if (tail && !(tail.bytes <= (this.offsets.get(tail.file) || 0))) fresh = fresh.concat(await this.readShard(tail.file, false));
      this.lastOk = Date.now();
      this.error = null;
      return fresh;
    } catch (e) {
      this.error = e;
      return [];
    }
  }

  safeStep() {
    return this.m ? this.m.safeStep : 0;
  }

  get headBlk() {
    return this.m ? this.m.safeBlk : 0;
  }

  get headAt() {
    return this.m ? this.m.updated : 0;
  }

  liveStep(now = Date.now()) {
    return this.m ? this.m.safeStep + Math.floor((now - this.m.updated) / SIM.STEP_MS) : 0;
  }
}
