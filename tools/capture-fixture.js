// Save a token's trade history as a test fixture: events CSV plus the raw
// logs of a few trades, so tests run offline on real data.
//   node tools/capture-fixture.js 0xTOKEN name [--lookback MIN]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DirectFeed, LOG_HEADER, toCsvRow } from "../src/feed.js";
import { TOPIC, ADDR } from "../src/chain.js";
import { parseArgs, ROOT } from "./common.js";

const args = parseArgs();
const name = args._[1];
if (!args.token || !name) { console.error("usage: node tools/capture-fixture.js 0xTOKEN name"); process.exit(2); }
const feed = new DirectFeed({ token: args.token, lookbackMin: Number(args.lookback ?? 0) });
await feed.init();
const dir = join(ROOT, "test/fixtures");
writeFileSync(join(dir, `${name}.csv`), LOG_HEADER + "\n" + feed.events.map(toCsvRow).join("\n") + "\n");
// raw logs: the first 6 curve events and, if graduated, 6 pool swaps
const h = feed.safeBlk;
const hex = (n) => "0x" + n.toString(16);
const curve = await feed.rpc.call("eth_getLogs", [{ address: feed.meta.curve, topics: [[TOPIC.buy, TOPIC.sell]], fromBlock: hex(feed.genesisBlk), toBlock: hex(h) }]);
let pool = [];
if (feed.meta.graduated) {
  pool = await feed.rpc.call("eth_getLogs", [{ address: ADDR.poolManager, topics: [TOPIC.swap, feed.meta.poolId], fromBlock: hex(Math.max(feed.genesisBlk, h - 20000)), toBlock: hex(h) }]);
}
// the expected side of each raw log, read independently from the token's
// Transfer events in the same transaction (tokens leaving the pool manager
// or the curve means a buy)
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const raw = [...curve.slice(0, 6), ...pool.slice(0, 6)];
for (const l of raw) {
  const rc = await feed.rpc.call("eth_getTransactionReceipt", [l.transactionHash]);
  const venue = l.address.toLowerCase() === feed.meta.curve ? feed.meta.curve : ADDR.poolManager;
  const tr = rc.logs.find((x) => x.address.toLowerCase() === feed.meta.token && x.topics[0] === TRANSFER && ("0x" + x.topics[1].slice(26) === venue || "0x" + x.topics[2].slice(26) === venue));
  l.expectSide = tr ? ("0x" + tr.topics[1].slice(26) === venue ? 1 : -1) : 0;
}
const meta = { ...feed.meta, genesisBlk: feed.genesisBlk, seed: feed.seed, safeBlk: feed.safeBlk, safeStep: feed.safeStep(), captured: new Date().toISOString() };
writeFileSync(join(dir, `${name}.json`), JSON.stringify({ meta, rawLogs: raw }, null, 1));
console.log(`${name}: ${feed.events.length} events, ${curve.slice(0, 6).length} curve + ${pool.slice(0, 6).length} pool raw logs`);
