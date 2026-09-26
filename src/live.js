// The live controller both pages share: config, feed, catch-up and the sim
// loop. It knows nothing about the page's layout. Everything it learns goes
// out through callbacks.
import { genesis, runTo, restore } from "./engine.js";
import { DirectFeed, DemoFeed, CsvFeed } from "./feed.js";

const LAG_STEPS = 60; // the scene runs 3 s behind the chain head so the feed can land first
const RESYNC = 200; // fall this far behind and go back to catching up
const BUDGET_SYNC = 10;
const BUDGET_LIVE = 6;

export async function loadConfig() {
  const r = await fetch("weedbrain.config.json", { cache: "no-store" });
  return r.json();
}

export class Live {
  /**
   * on: {
   *   progress(title, body, pct)   loading and catch-up
   *   error(title, body)           fatal: bad token, unreachable chain
   *   ready(live)                  feed resolved, sim created
   *   record(rec, isLive)          every sim out record, in order
   *   frame(S, now)                every animation frame once live
   *   stale(isStale, lastOk)       the RPC stopped answering, or came back
   * }
   */
  constructor(cfg, on) {
    this.cfg = cfg;
    this.on = on;
    this.mode = !cfg.token ? "demo" : cfg.mode === "collector" ? "collector" : "direct";
    this.clockOffset = 0;
    this.holdAt = 0;
    this.syncing = true;
    this.polling = false;
  }

  async start() {
    const { cfg, mode, on } = this;
    for (let attempt = 0; ; attempt++) {
    try {
      if (mode === "demo") {
        // ?at=<ms or ISO time> shows that moment of the demo, &hold freezes it there
        const q = new URLSearchParams(location.search);
        const at = q.get("at");
        if (at) {
          const atMs = /^\d+$/.test(at) ? Number(at) : Date.parse(at);
          this.clockOffset = atMs - Date.now();
          if (q.has("hold")) this.holdAt = atMs;
        }
        this.feed = new DemoFeed(Date.now() + this.clockOffset);
      } else if (mode === "collector") {
        this.feed = new CsvFeed(cfg);
        await this.feed.init((phase, p) => on.progress("LOADING", phase === "snapshot" ? "reading the state snapshot" : "reading the log tail", p));
      } else {
        this.feed = new DirectFeed(cfg);
        await this.feed.init((phase, p) =>
          on.progress("LOADING", phase === "resolve" ? "finding the token on pons v2" : "reading trades from robinhood chain", phase === "resolve" ? 0.05 : 0.05 + p * 0.95),
        );
      }
    } catch (e) {
      if (e.code === "bad-address" || e.code === "not-pons") on.error(e.code === "bad-address" ? "NOT AN ADDRESS" : "NOT A PONS TOKEN", e.message);
      else {
        // keep trying in place instead of stranding the visitor on an error
        on.progress("LOADING", `the chain node is busy, trying again (${attempt + 1})`, null);
        await new Promise((r) => setTimeout(r, Math.min(15000, 3000 * (attempt + 1))));
        continue;
      }
      return false;
    }
    break;
    }
    const feed = this.feed;
    if (feed.snap) {
      try { this.S = restore(feed.snap); } catch { this.S = genesis(feed.seed); }
    } else {
      this.S = genesis(feed.seed);
    }
    this.idx = 0;
    while (this.idx < feed.events.length && feed.events[this.idx].step < this.S.step) this.idx++;
    this.startStep = this.S.step;
    on.ready(this);
    if (mode !== "demo") setInterval(() => this.poll(), feed.pollMs || cfg.pollMs || 1500);
    requestAnimationFrame((t) => this.frame(t));
    return true;
  }

  now() {
    return this.holdAt || Date.now() + this.clockOffset;
  }

  target(now) {
    const feed = this.feed;
    if (this.mode === "demo") {
      const t = feed.liveStep(now) - 20;
      feed.generate(t + 1);
      return t;
    }
    return Math.min(feed.safeStep(), feed.liveStep(now) - LAG_STEPS);
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    await this.feed.poll();
    this.polling = false;
    const stale = !!this.feed.error && Date.now() - this.feed.lastOk > 8000;
    this.on.stale(stale, this.feed.lastOk);
  }

  drain(isLive) {
    for (const r of this.S.out) this.on.record(r, isLive);
    this.S.out.length = 0;
  }

  frame(t) {
    const S = this.S;
    const tgt = this.target(this.now());
    const behind = tgt - S.step;
    if (!this.syncing && behind > RESYNC) this.syncing = true;
    if (this.syncing) {
      this.idx = runTo(S, this.feed.events, this.idx, tgt, { budgetMs: BUDGET_SYNC, now: () => performance.now() });
      this.drain(false);
      const span = Math.max(1, tgt - this.startStep);
      this.on.progress("REPLAYING", `${S.step.toLocaleString("en-US")} of ${tgt.toLocaleString("en-US")} steps`, Math.min(1, (S.step - this.startStep) / span));
      if (tgt - S.step <= 4) {
        this.syncing = false;
        this.on.progress(null);
      }
    } else if (behind > 0) {
      this.idx = runTo(S, this.feed.events, this.idx, tgt, { budgetMs: BUDGET_LIVE, now: () => performance.now() });
      this.drain(true);
    }
    if (!this.syncing) this.on.frame(S, t);
    requestAnimationFrame((x) => this.frame(x));
  }

  /** Wall time of a block, estimated from the last head (demo: from the step). */
  timeOf(rec) {
    const f = this.feed;
    if (this.mode === "demo") return f.genesisTs + rec.step * 50;
    return f.headAt - (f.headBlk - rec.blk) * 101.4;
  }
}
