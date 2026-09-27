// A neuroscan of the joint's brain, read off the chain. It replays the
// token's trades, counts what each region of the (made-up) brain answered
// to and prints a scan report with the brain drawn in text, the busier a
// region the denser its glyphs. The anatomy is a joke; every number in the
// readings comes from real trades.
//
//   node tools/scan.js [0xTOKEN] [--window MIN]
import { genesis, applyEvent, simStep, simHash, STAGES, SIM } from "../src/engine.js";
import { DirectFeed } from "../src/feed.js";
import { REGIONS } from "../src/brain.js";
import { parseArgs, loadConfig } from "./common.js";

const args = parseArgs();
const cfg = loadConfig();
const token = args.token || cfg.token;
const windowMin = Number(args.window || 30);

const feed = new DirectFeed({ ...cfg, token, lookbackMin: 0 });
await feed.init();
const S = genesis(feed.seed);
const end = feed.safeStep();
const from = end - windowMin * 1200;
const hits = { cb1: 0, ember: 0, paranoia: 0, mug: 0, bud: 0, munchie: 0 };
let buys = 0, sells = 0, i = 0, peak = 0;
for (let st = 0; st < end; st++) {
  while (i < feed.events.length && feed.events[i].step <= S.step) {
    if (feed.events[i].step === S.step) applyEvent(S, feed.events[i]);
    i++;
  }
  simStep(S);
  if (S.step >= from) {
    for (const r of S.out) {
      if (r.t === "trade" && r.eth >= SIM.DUST) {
        hits.munchie++;
        if (r.side > 0) { hits.cb1++; buys++; } else { hits.ember++; sells++; }
      }
      if (r.t === "kill") hits.paranoia++;
      if (r.t === "spill" || r.t === "refill") hits.mug++;
    }
    peak = Math.max(peak, S.mood);
  }
  S.out.length = 0;
}
const pile = Math.max(0, 1 - Math.min(1, S.melt) / 0.8);
hits.bud = Math.round(pile * 100);
const max = Math.max(1, ...Object.values(hits));

// the brain, as a text plate: each cell belongs to the nearest region
const W = 58, H = 17;
const at = { cb1: [0.25, 0.3], mug: [0.21, 0.62], bud: [0.52, 0.18], paranoia: [0.8, 0.34], ember: [0.52, 0.5], munchie: [0.66, 0.9] };
const ramp = " .:-=+*#%@";
const lines = [];
for (let y = 0; y < H; y++) {
  let row = "";
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1), v = y / (H - 1);
    const cortex = ((u - 0.5) / 0.47) ** 2 + ((v - 0.4) / 0.37) ** 2 < 1;
    const cereb = ((u - 0.76) / 0.15) ** 2 + ((v - 0.76) / 0.12) ** 2 < 1;
    const stem = Math.abs(u - (0.62 + (v - 0.7) * 0.2)) < 0.035 && v > 0.66;
    if (!cortex && !cereb && !stem) { row += " "; continue; }
    let best = "cb1", bd = Infinity;
    for (const k in at) {
      const d = (u - at[k][0]) ** 2 + (v - at[k][1]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    const level = hits[best] / max;
    const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    const idx = Math.min(9, Math.max(1, Math.round(level * 8 + Math.abs(n) * 2)));
    row += ramp[idx];
  }
  lines.push(row);
}

const pad = (s, n) => String(s).padEnd(n);
const bar = (f) => "█".repeat(Math.round(f * 20)).padEnd(20, "·");
console.log(`WEEDBRAIN NEUROSCAN v0.4    subject ${feed.meta.symbol} ${feed.meta.token.slice(0, 10)}…    window ${windowMin} min`);
console.log(`chain 4663 · block ${feed.safeBlk.toLocaleString("en-US")} · state ${simHash(S)} @${S.step}`);
console.log("");
for (const l of lines) console.log("    " + l);
console.log("");
console.log("REGION            READING               HITS   WHAT FIRED IT");
const why = { cb1: "buys", ember: "sells", paranoia: "buzzkills sent", mug: "spills and refills", bud: "% of pile left", munchie: "every trade" };
for (const r of REGIONS) console.log(`${pad(r.name, 17)} ${bar(hits[r.key] / max)}  ${String(hits[r.key]).padStart(4)}   ${why[r.key]}`);
console.log("");
console.log(`buys ${buys} · sells ${sells} · peak mood ${STAGES[Math.min(9, Math.floor(peak * 10))]} · now ${STAGES[S.stage]}`);
console.log(`DIAGNOSIS  ${S.stage <= 2 ? "high, stable, asking for snacks" : S.stage <= 5 ? "soaked and irritable, mug down" : "armed. do not approach"}`);
