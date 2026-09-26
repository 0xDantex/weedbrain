// Edge cases: bad data, numeric extremes, tampered snapshots, the RNG sign
// trap and the chain decoding against real captured logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256 as vKeccak, toHex, encodeAbiParameters, parseAbiParameters } from "viem";
import { genesis, applyEvent, simStep, runTo, simHash, snapshot, restore, srnd, dlog2, seedFromString, SIM } from "../src/engine.js";
import { parseCsv } from "../src/feed.js";
import { keccakText, keccak256 } from "../src/keccak.js";
import { poolIdFor, decodeTrades, ADDR, TOPIC, isAddress } from "../src/chain.js";
import { fixture, walk, ev } from "./_util.js";

const finite = (S) => [S.px, S.pxAth, S.flow, S.melt, S.mood, S.debt, S.high].every(Number.isFinite);

test("garbage events are ignored or clamped, never NaN", () => {
  const S = genesis(1);
  for (const bad of [
    { side: 0, eth: 1, px: 1 }, { side: 1, eth: NaN, px: 1 }, { side: -1, eth: -5, px: 1 },
    { side: 1, eth: 1, px: NaN }, { side: 1, eth: Infinity, px: 0 }, { side: 2, eth: 1, px: 1 },
    { side: 1, eth: 1e12, px: 1e-12 }, { side: -1, eth: 1e-12, px: 1e12 },
  ]) {
    applyEvent(S, { step: S.step, tok: 1, blk: 1, li: 0, tx: "0x" + "1".repeat(64), ...bad });
    for (let i = 0; i < 50; i++) simStep(S);
    assert.ok(finite(S), JSON.stringify(bad));
  }
});

test("empty log: he settles at EYES HEAVY, mug full and nothing moves", () => {
  const S = walk([], 1, 5000);
  assert.equal(S.stage, 1);
  assert.equal(S.spilled, 0);
  assert.equal(S.joints.length + S.kills.length, 0);
});

test("prices from 1e-12 to 1e12 keep the state finite", () => {
  const events = [];
  let px = 1e-12;
  for (let s = 0; s < 4000; s += 10) { px *= 1.15; events.push(ev(s, s % 20 ? 1 : -1, 0.01, px)); }
  assert.ok(finite(walk(events, 1, 4000)));
});

test("300,000 steps run and stay finite", () => {
  const events = [];
  for (let s = 0; s < 300000; s += 97) events.push(ev(s, (s / 97) % 3 ? 1 : -1, 0.003 + (s % 7) * 0.004, 1e-8 * (1 + (s % 1000) / 1000)));
  const S = genesis(3);
  runTo(S, events, 0, 300000);
  assert.ok(finite(S));
  assert.equal(S.step, 300000);
});

test("a late event (step already played) is skipped, not applied out of order", () => {
  const S = genesis(1);
  runTo(S, [], 0, 100);
  const idx = runTo(S, [ev(50, 1, 1)], 0, 200);
  assert.equal(idx, 1);
  assert.equal(S.evCount, 0);
});

test("a tampered snapshot is refused", () => {
  const S = walk([ev(3, 1, 0.1), ev(9, -1, 0.1)], 1, 400);
  const snap = snapshot(S);
  assert.equal(simHash(restore(JSON.parse(JSON.stringify(snap)))), snap.hash);
  assert.throws(() => restore({ ...snap, melt: snap.melt + 1e-9 }));
  assert.throws(() => restore({ ...snap, mood: NaN }));
});

test("srnd stays in [0, 1) with no sign bias (the XOR trap)", () => {
  let lo = 0, min = 1, max = 0;
  for (let i = 0; i < 100000; i++) {
    const r = srnd(0xdeadbeef, i, 11);
    min = Math.min(min, r); max = Math.max(max, r);
    if (r < 0.5) lo++;
  }
  assert.ok(min >= 0 && max < 1);
  assert.ok(Math.abs(lo / 100000 - 0.5) < 0.01, `share below 0.5: ${lo / 100000}`);
  // a large seed (sign bit set) must behave the same
  assert.ok(srnd(0xffffffff, 1, 1) >= 0);
  assert.equal(seedFromString("x") >>> 0, seedFromString("x"));
});

test("dlog2 matches Math.log2 to 1e-12 across the range trades live in", () => {
  for (let x = 1e-9; x < 1e9; x *= 1.37) assert.ok(Math.abs(dlog2(x) - Math.log2(x)) < 1e-12, String(x));
});

test("parseCsv skips malformed rows and counts them", () => {
  const good = "12,1,0.1,1000,0.0001,99,0," + "0x" + "a".repeat(64);
  const { events, bad } = parseCsv(["step,side,eth,tok,px,blk,li,tx", good, "x,1,2", "5,0,1,1,1,1,1,0xab", "", good.replace("12,", "-1,")].join("\n"));
  assert.equal(events.length, 1);
  assert.equal(bad, 3);
});

test("keccak and pool id agree with viem", () => {
  for (const s of ["", "abc", "CurveBuy(address,address,uint256,uint256,uint256,uint256)", "x".repeat(136), "y".repeat(500)]) {
    assert.equal(keccakText(s), vKeccak(toHex(s)));
  }
  const h = "0x" + "ab".repeat(300);
  assert.equal(keccak256(h), vKeccak(h));
  const t = "0xf3f7dc25cad40e4d88e6876895a7606089a71d16", z = "0x0000000000000000000000000000000000000000";
  const want = vKeccak(encodeAbiParameters(parseAbiParameters("address, address, uint24, int24, address"), [z, t, 0, -200, ADDR.hook]));
  assert.equal(poolIdFor(t, z, 0, -200), want);
});

test("real logs decode to the side their token Transfer shows", () => {
  for (const name of ["sniffr", "fomofied"]) {
    const fx = fixture(name);
    const trades = decodeTrades(fx.meta, fx.rawLogs);
    assert.equal(trades.length, fx.rawLogs.length, name);
    for (const l of fx.rawLogs) {
      const t = trades.find((x) => x.tx === l.transactionHash.toLowerCase() && x.li === Number(BigInt(l.logIndex)));
      assert.ok(l.expectSide !== 0, "fixture has an expected side");
      assert.equal(t.side, l.expectSide, `${name} ${l.transactionHash}`);
      assert.ok(t.quote > 0 && t.tok > 0 && t.px > 0);
    }
  }
});

test("curve trades carry the trader from the event, not the relayer", () => {
  const fx = fixture("sniffr");
  for (const t of decodeTrades(fx.meta, fx.rawLogs)) assert.ok(isAddress(t.trader));
  assert.ok(TOPIC.buy.startsWith("0xec36bf57"));
});

test("stage names are ten, the mug splits them and the blast is last", async () => {
  const { STAGES, STAGE_NOTES, MUG } = await import("../src/engine.js");
  assert.equal(STAGES.length, 10);
  assert.equal(STAGE_NOTES.length, 10);
  assert.equal(STAGES[MUG], "THE MUG");
  assert.equal(STAGES[MUG + 1], "SPILLED");
  assert.equal(STAGES[9], "BLAST");
  assert.ok(SIM.STEP_MS === 50);
});
