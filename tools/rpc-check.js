// Measure the chain and the public RPC the way the docs quote them.
//   node tools/rpc-check.js
import { makeRpc, headBlock, TOPIC, ADDR } from "../src/chain.js";

const rpc = makeRpc(undefined, { logsSpacingMs: 400 });
const hex = (n) => "0x" + n.toString(16);
const ts = async (n) => Number(BigInt((await rpc.call("eth_getBlockByNumber", [hex(n), false])).timestamp));

const head = await headBlock(rpc);
const span = 1_000_000;
const dt = (await ts(head)) - (await ts(head - span));
const perDay = 86400 / (dt / span);
console.log(`block time      ${(dt / span).toFixed(4)} s over the last ${span.toLocaleString()} blocks (${Math.round(perDay).toLocaleString()} blocks a day)`);

const lat = [];
for (let i = 0; i < 8; i++) {
  const t0 = performance.now();
  await rpc.call("eth_getLogs", [{ fromBlock: hex(head - 600), toBlock: hex(head), topics: [[TOPIC.buy, TOPIC.sell]] }]);
  lat.push(performance.now() - t0);
}
lat.sort((a, b) => a - b);
console.log(`getLogs latency ${lat[0].toFixed(0)}-${lat.at(-1).toFixed(0)} ms (8 calls, 600 blocks of chain-wide curve events)`);

const t0 = performance.now();
const one = await rpc.call("eth_getLogs", [{ fromBlock: hex(head - 6000), toBlock: hex(head), topics: [[TOPIC.buy, TOPIC.sell]] }]);
console.log(`curve trades    ${one.length} chain-wide in 6,000 blocks (${Math.round((one.length / 6000) * perDay).toLocaleString()} a day at this rate), read in ${(performance.now() - t0).toFixed(0)} ms`);
try {
  await rpc.call("eth_getLogs", [{ address: ADDR.poolManager, fromBlock: hex(head - 6000), toBlock: hex(head), topics: [TOPIC.swap] }]);
  console.log("v4 swaps        under the limit in 6,000 blocks");
} catch (e) {
  console.log(`v4 swaps        refused over 6,000 blocks: "${e.message}"`);
}
