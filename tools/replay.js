// Independent run of the log: prints the final state and its hash. The hash
// must match what the page shows at the same step.
//
//   node tools/replay.js --token 0xABC [--lookback 60] [--genesis N]
//   node tools/replay.js --log data/events --seed N [--to STEP]
//   node tools/replay.js --demo [--epoch N] [--to STEP]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { genesis, runTo, simHash, snapshot } from "../src/engine.js";
import { DirectFeed, DemoFeed, parseCsv, eventOrder, eventKey, DEMO_EPOCH_MS } from "../src/feed.js";
import { parseArgs, loadConfig, stateLine } from "./common.js";

const args = parseArgs();
const cfg = loadConfig();
let events, seed, target, label;
const t0 = performance.now();

if (args.log) {
  const files = [];
  const walk = (p) => (statSync(p).isDirectory() ? readdirSync(p).sort().forEach((f) => walk(join(p, f))) : p.endsWith(".csv") && files.push(p));
  walk(args.log);
  const seen = new Set();
  events = [];
  for (const f of files) for (const e of parseCsv(readFileSync(f, "utf8")).events) if (!seen.has(eventKey(e))) { seen.add(eventKey(e)); events.push(e); }
  events.sort(eventOrder);
  seed = Number(args.seed ?? JSON.parse(readFileSync(join(args.log, "..", "meta.json"), "utf8")).seed);
  target = Number(args.to ?? (events.length ? events.at(-1).step + 1 : 0));
  label = `log ${args.log} (${files.length} shards)`;
} else if (args.demo) {
  const epoch = Number(args.epoch ?? Math.floor(Date.now() / DEMO_EPOCH_MS));
  const feed = new DemoFeed(epoch * DEMO_EPOCH_MS);
  target = Number(args.to ?? 72000);
  feed.generate(target);
  events = feed.events;
  seed = feed.seed;
  label = `demo epoch ${epoch}`;
} else {
  const token = args.token || cfg.token;
  if (!token) { console.error("usage: node tools/replay.js --token 0x... | --log DIR --seed N | --demo"); process.exit(2); }
  const feed = new DirectFeed({
    ...cfg,
    token,
    genesisBlock: Number(args.genesis ?? cfg.genesisBlock ?? 0),
    lookbackMin: Number(args.lookback ?? cfg.lookbackMin ?? 0),
  });
  await feed.init();
  events = feed.events;
  seed = feed.seed;
  target = Number(args.to ?? feed.safeStep());
  label = `${feed.meta.symbol} ${feed.meta.token} genesis block ${feed.genesisBlk} head ${feed.safeBlk}`;
}

const tRead = performance.now();
const S = genesis(seed);
runTo(S, events, 0, target);
const tRun = performance.now();

console.log(`source   ${label}`);
console.log(`events   ${events.length}  steps ${target}  seed ${seed}`);
console.log(`time     read ${(tRead - t0).toFixed(0)} ms  sim ${(tRun - tRead).toFixed(0)} ms`);
console.log(`state    ${stateLine(S)}`);
console.log(`trades   ${S.buys} buys  ${S.sells} sells  doused ${S.doused}`);
console.log(`STATE HASH ${simHash(S)} @${S.step}`);
if (args.json) console.log(JSON.stringify(snapshot(S)));
