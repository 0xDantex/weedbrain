// Watch any Pons v2 token in the terminal: trades as they land and what
// each one did to the reaper.
//
//   node tools/watch.js 0xABC... [--lookback 60] [--genesis N] [--poll 1500] [--for SECONDS]
import { genesis, runTo, STAGES } from "../src/engine.js";
import { DirectFeed } from "../src/feed.js";
import { CHAIN } from "../src/chain.js";
import { parseArgs, loadConfig, stateLine, fmtAmount, spawnText, variantName } from "./common.js";

const args = parseArgs();
const cfg = loadConfig();
const token = args.token || cfg.token;
if (!token) {
  console.error("usage: node tools/watch.js 0xTOKEN [--lookback MIN] [--genesis BLOCK] [--for SECONDS]");
  process.exit(2);
}
const feed = new DirectFeed({
  ...cfg,
  token,
  genesisBlock: Number(args.genesis ?? 0),
  lookbackMin: Number(args.lookback ?? cfg.lookbackMin ?? 0),
  pollMs: Number(args.poll ?? cfg.pollMs ?? 1500),
});

const clock = (ms) => new Date(ms).toISOString().slice(11, 19);
const t0 = Date.now();
try {
  await feed.init((phase, p) => process.stderr.write(`\r${phase} ${(p * 100).toFixed(0)}%   `));
} catch (e) {
  console.error(`\n${e.code || "error"}: ${e.message}`);
  process.exit(1);
}
process.stderr.write("\r");
const m = feed.meta;
console.log(`token    ${m.symbol} (${m.name}) ${m.token}`);
console.log(`curve    ${m.curve}  pair ${m.pairSymbol}  ${m.graduated ? "graduated, v4 pool " + m.poolId.slice(0, 10) : "on the curve"}`);
console.log(`genesis  block ${feed.genesisBlk} (launch ${m.launchBlock})  history ${feed.events.length} trades read in ${Date.now() - t0} ms`);

const S = genesis(feed.seed);
let idx = runTo(S, feed.events, 0, feed.safeStep());
S.out.length = 0;
console.log(`replayed ${stateLine(S)}`);
console.log("");

const LAG = 60; // steps held back behind the chain head (3 s)
let lastLine = 0;
const until = args.for ? Date.now() + Number(args.for) * 1000 : Infinity;

function drain() {
  for (const r of S.out) {
    if (r.t === "trade") {
      const when = feed.headAt - (feed.headBlk - r.blk) * CHAIN.blockMs;
      console.log(
        `${clock(when)}  ${r.side > 0 ? "BUY " : "SELL"} ${fmtAmount(r.tok).padStart(8)} ${m.symbol.padEnd(8)} ${r.eth.toFixed(5)} ${m.pairSymbol}  -> ${spawnText(r)}   ${r.tx.slice(0, 12)}`,
      );
    } else if (r.t === "kill") {
      console.log(`          buzzkill ${variantName(r.variant)} walks in from the ${r.side < 0 ? "left" : "right"} (size ${r.size.toFixed(2)})`);
    } else if (r.t === "repel") {
      console.log(`          lighter flash sends ${variantName(r.variant)} running`);
    } else if (r.t === "stage") {
      console.log(`          stage ${STAGES[r.from]} -> ${STAGES[r.to]}`);
    } else if (r.t === "arrive") {
      const n = r.doused.length;
      console.log(`          ${variantName(r.variant)} got through, ${n ? `doused ${n} joint${n === 1 ? "" : "s"}` : "nothing was burning"}`);
    }
  }
  S.out.length = 0;
}

while (Date.now() < until) {
  const started = Date.now();
  await feed.poll();
  if (feed.error) console.log(`          RPC error: ${feed.error.message} (last good ${clock(feed.lastOk)})`);
  const target = Math.min(feed.safeStep(), feed.liveStep() - LAG);
  if (target > S.step) idx = runTo(S, feed.events, idx, target);
  drain();
  if (Date.now() - lastLine > 5000) {
    console.log(`  [${clock(Date.now())}] ${stateLine(S)}`);
    lastLine = Date.now();
  }
  const wait = feed.pollMs - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
