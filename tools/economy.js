// Economy report on real trade logs: how long he spends in each stage,
// how busy the scene gets, how many buzzkills the lighter stops.
//   node tools/economy.js                 the fixtures in test/fixtures
//   node tools/economy.js --token 0x...   a live token (last --lookback minutes)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { genesis, applyEvent, simStep, STAGES, SIM } from "../src/engine.js";
import { parseCsv, DirectFeed } from "../src/feed.js";
import { parseArgs, ROOT } from "./common.js";

const args = parseArgs();

function report(name, events, seed, steps) {
  const S = genesis(seed);
  const h = new Array(10).fill(0);
  let i = 0, peakJ = 0, peakK = 0, spawnedJ = 0, spawnedK = 0;
  for (let s = 0; s < steps; s++) {
    while (i < events.length && events[i].step <= S.step) {
      if (events[i].step === S.step) applyEvent(S, events[i]);
      i++;
    }
    simStep(S);
    for (const r of S.out) { if (r.t === "joint" && !r.merged) spawnedJ++; if (r.t === "kill") spawnedK++; }
    S.out.length = 0;
    h[S.stage]++;
    peakJ = Math.max(peakJ, S.joints.length);
    peakK = Math.max(peakK, S.kills.length);
  }
  const buys = events.filter((e) => e.side > 0).length;
  const eth = events.map((e) => e.eth).sort((a, b) => a - b);
  const q = (p) => eth[Math.floor(p * (eth.length - 1))];
  console.log(`\n${name}: ${events.length} trades (${buys} buys) over ${(steps * SIM.STEP_MS / 60000).toFixed(1)} min`);
  console.log(`  trade size ETH  p10 ${q(0.1).toFixed(4)}  median ${q(0.5).toFixed(4)}  p90 ${q(0.9).toFixed(4)}  max ${eth.at(-1).toFixed(4)}`);
  console.log(`  spawned         ${spawnedJ} joints from ${buys} buys, ${spawnedK} buzzkills from ${events.length - buys} sells`);
  console.log(`  peak on screen  ${peakJ} joints, ${peakK} buzzkills`);
  console.log(`  buzzkills       ${S.repelled} stopped, ${S.arrived} got through`);
  console.log("  time per stage  " + STAGES.map((n, k) => `${n} ${((h[k] / steps) * 100).toFixed(1)}%`).join(", "));
}

if (args.token) {
  const feed = new DirectFeed({ token: args.token, lookbackMin: Number(args.lookback ?? 60) });
  await feed.init();
  report(`${feed.meta.symbol} ${feed.meta.token}`, feed.events, feed.seed, feed.safeStep());
} else {
  const dir = join(ROOT, "test/fixtures");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".csv"))) {
    const name = f.replace(".csv", "");
    const meta = JSON.parse(readFileSync(join(dir, name + ".json"), "utf8")).meta;
    report(`${name} (${meta.symbol}, ${meta.graduated ? "v4 pool" : "curve"})`, parseCsv(readFileSync(join(dir, f), "utf8")).events, meta.seed, meta.safeStep);
  }
}
