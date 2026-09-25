// Event loss under delays: a fake node with random latency, a head that
// runs ahead of its logs, a 10k-style log limit and a graduation midway.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectFeed, SAFE_MARGIN, parseCsv, toCsvRow, LOG_HEADER, mergeEvents, eventOrder } from "../src/feed.js";
import { makeRpc, TOPIC, poolIdFor, decodeTrades, ZERO } from "../src/chain.js";
import { genesis, runTo, simHash } from "../src/engine.js";

const TOKEN = "0x" + "ab".repeat(20);
const CURVE = "0x" + "cd".repeat(20);
const PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const w = (v) => BigInt.asUintN(256, BigInt(v)).toString(16).padStart(64, "0");
const hex = (n) => "0x" + n.toString(16);

function fakeChain({ trades = 400, gradAt = 0, indexLag = 3, latency = 40, limit = 50, seed = 1 }) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const meta = { token: TOKEN, curve: CURVE, pairToken: ZERO, pairIsEth: true, poolFee: 0, tickSpacing: 200, decimals: 18, pairDecimals: 18, symbol: "T", graduated: false };
  meta.poolId = poolIdFor(TOKEN, ZERO, 0, 200);
  const logs = [];
  let blk = 1000;
  for (let i = 0; i < trades; i++) {
    blk += 1 + Math.floor(rnd() * 6);
    const buy = rnd() < 0.55;
    const pool = gradAt && blk >= gradAt;
    const amt = BigInt(Math.floor(1e15 + rnd() * 5e16));
    const tok = amt * 50000000n;
    let l;
    if (!pool) {
      l = { address: CURVE, topics: [buy ? TOPIC.buy : TOPIC.sell, "0x" + w(7), "0x" + w(8)], data: "0x" + (buy ? w(amt) + w(tok) + w(0) + w(0) : w(tok) + w(amt) + w(0) + w(0)) };
    } else {
      // token is currency1 (ETH is address(0)); swapper delta: + received
      const a0 = buy ? -amt : amt, a1 = buy ? tok : -tok;
      l = { address: PM, topics: [TOPIC.swap, meta.poolId, "0x" + w(9)], data: "0x" + w(a0) + w(a1) + w(1) + w(1) + w(0) + w(0) };
    }
    logs.push({ ...l, blockNumber: hex(blk), logIndex: hex(i % 7), transactionHash: "0x" + w(i + 1) });
  }
  const last = blk + 20;
  let head = 1000;
  const fetchImpl = async (_url, init) => {
    const { method, params, id } = JSON.parse(init.body);
    await new Promise((r) => setTimeout(r, rnd() * latency));
    let result;
    if (method === "eth_blockNumber") {
      head = Math.min(last, head + 1 + Math.floor(rnd() * 40));
      result = hex(head);
    } else if (method === "eth_call") {
      const at = params[1] === "latest" ? head : Number(params[1]);
      result = "0x" + w(gradAt && at >= gradAt ? 1 : 0);
    } else if (method === "eth_getLogs") {
      const f = params[0];
      const from = Number(f.fromBlock), to = Number(f.toBlock);
      // logs of the newest blocks are not queryable yet
      const visible = head - indexLag;
      const out = logs.filter((l) => {
        const b = Number(l.blockNumber);
        if (b < from || b > to || b > visible) return false;
        if (l.address !== f.address) return false;
        const t0 = Array.isArray(f.topics[0]) ? f.topics[0] : [f.topics[0]];
        if (!t0.includes(l.topics[0])) return false;
        if (f.topics[1] && l.topics[1] !== f.topics[1]) return false;
        return true;
      });
      if (out.length > limit) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "logs matched by query exceeds limit of 10000" } }) };
      }
      result = out;
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id, result }) };
  };
  return { meta, logs, fetchImpl, last: () => last, head: () => head };
}

async function drive(chain) {
  const feed = new DirectFeed({ token: TOKEN });
  feed.rpc = makeRpc("mock", { fetchImpl: chain.fetchImpl, logsSpacingMs: 0 });
  feed.meta = { ...chain.meta };
  feed.genesisBlk = 1000;
  feed.seed = 1;
  feed.safeBlk = 1000;
  const S = genesis(1);
  let idx = 0;
  let late = 0;
  for (let i = 0; i < 2000 && feed.safeBlk < chain.last() - SAFE_MARGIN; i++) {
    const before = S.step;
    const fresh = await feed.poll();
    for (const e of fresh) if (e.step < before) late++;
    idx = runTo(S, feed.events, idx, feed.safeStep());
  }
  return { feed, late, S };
}

test("no trade is lost or late when the head runs ahead of the logs", async () => {
  const chain = fakeChain({ indexLag: 3, seed: 3 });
  const { feed, late } = await drive(chain);
  assert.equal(late, 0, "an event arrived for a step already played");
  assert.equal(feed.events.length, chain.logs.length);
});

test("control: a node lagging past the margin does lose trades, so the test above can fail", async () => {
  const chain = fakeChain({ indexLag: SAFE_MARGIN + 6, seed: 3 });
  const { feed } = await drive(chain);
  assert.ok(feed.events.length < chain.logs.length);
});

test("graduation midway: curve trades then pool swaps, none missed", async () => {
  const chain = fakeChain({ gradAt: 1800, indexLag: 2, seed: 9 });
  const { feed, late } = await drive(chain);
  assert.equal(late, 0);
  assert.equal(feed.events.length, chain.logs.length);
  assert.ok(feed.meta.graduated);
  const pool = feed.events.filter((e) => e.blk >= 1800);
  assert.ok(pool.length > 0 && pool.every((e) => !e.trader));
});

test("the 10k-log refusal shrinks the range instead of failing", async () => {
  const chain = fakeChain({ trades: 600, limit: 20, seed: 4 });
  const { feed } = await drive(chain);
  assert.equal(feed.events.length, chain.logs.length);
});

test("decoded sides match the fake chain's intent", () => {
  const chain = fakeChain({ trades: 50, gradAt: 1100, seed: 5 });
  const t = decodeTrades(chain.meta, chain.logs);
  for (let i = 0; i < chain.logs.length; i++) {
    const l = chain.logs[i];
    const want = l.topics[0] === TOPIC.buy ? 1 : l.topics[0] === TOPIC.sell ? -1 : BigInt.asIntN(256, BigInt("0x" + l.data.slice(66, 130))) > 0n ? 1 : -1;
    assert.equal(t.find((x) => x.tx === l.transactionHash).side, want);
  }
});

test("csv round trip keeps every bit that feeds the hash", () => {
  const chain = fakeChain({ trades: 200, seed: 6 });
  const events = decodeTrades(chain.meta, chain.logs).map((t) => ({ step: (t.blk - 1000) * 2, side: t.side, eth: t.quote, tok: t.tok, px: t.px, blk: t.blk, li: t.li, tx: t.tx }));
  events.sort(eventOrder);
  const back = parseCsv(LOG_HEADER + "\n" + events.map(toCsvRow).join("\n") + "\n").events;
  const A = genesis(2), B = genesis(2);
  runTo(A, events, 0, 20000);
  runTo(B, back, 0, 20000);
  assert.equal(simHash(A), simHash(B));
});

test("merging the same events twice changes nothing", () => {
  const chain = fakeChain({ trades: 30, seed: 8 });
  const events = decodeTrades(chain.meta, chain.logs).map((t) => ({ ...t, step: t.blk - 1000 }));
  const list = [], seen = new Set();
  assert.equal(mergeEvents(list, seen, events), 30);
  assert.equal(mergeEvents(list, seen, events.slice().reverse()), 0);
  assert.equal(list.length, 30);
});
