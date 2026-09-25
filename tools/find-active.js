// List the busiest Pons v2 tokens of the last few minutes and the stage the
// reaper would be in on each, for picking a foreign token to test with.
//   node tools/find-active.js [--minutes 10] [--top 8]
import { makeRpc, headBlock, TOPIC, CHAIN, resolveToken } from "../src/chain.js";
import { genesis, runTo, STAGES } from "../src/engine.js";
import { DirectFeed } from "../src/feed.js";
import { parseArgs } from "./common.js";

const args = parseArgs();
const rpc = makeRpc();
const head = await headBlock(rpc);
const span = Math.round((Number(args.minutes || 10) * 60000) / CHAIN.blockMs);
const hex = (n) => "0x" + n.toString(16);
const logs = await rpc.call("eth_getLogs", [{ fromBlock: hex(head - span), toBlock: hex(head), topics: [[TOPIC.buy, TOPIC.sell]] }]);
const count = new Map();
for (const l of logs) count.set(l.address.toLowerCase(), (count.get(l.address.toLowerCase()) || 0) + 1);
const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(args.top || 8));
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
console.log(`curve trades in the last ${args.minutes || 10} min: ${logs.length}`);
for (const [curve, n] of top) {
  // the token is the ERC20 whose Transfer in a trade tx touches the curve
  const l = logs.find((x) => x.address.toLowerCase() === curve);
  const rc = await rpc.call("eth_getTransactionReceipt", [l.transactionHash]);
  const pad = curve.slice(2);
  const tr = rc.logs.find((x) => x.topics[0] === TRANSFER && x.topics.length === 3 && (x.topics[1].endsWith(pad) || x.topics[2].endsWith(pad)));
  if (!tr) continue;
  try {
    const meta = await resolveToken(rpc, tr.address, { findLaunch: false });
    if (meta.curve !== curve) continue;
    const feed = new DirectFeed({ token: meta.token, lookbackMin: 60 });
    await feed.init();
    const S = genesis(feed.seed);
    runTo(S, feed.events, 0, feed.safeStep());
    console.log(`${meta.token}  ${meta.symbol.padEnd(12)} ${String(n).padStart(4)} trades  ${meta.pairSymbol.padEnd(5)} now ${STAGES[S.stage]}`);
  } catch (e) {
    console.log(`${tr.address}  skipped: ${e.message}`);
  }
}
