// One state for everyone: frame rate, catch-up budget, join time and
// snapshot restore must not change the result.
import { test } from "node:test";
import assert from "node:assert/strict";
import { genesis, runTo, simHash, snapshot, restore } from "../src/engine.js";
import { DemoFeed, DEMO_EPOCH_MS } from "../src/feed.js";
import { fixture } from "./_util.js";

const fx = fixture("sniffr");
const END = fx.meta.safeStep;

function runChunked(chunk) {
  const S = genesis(fx.meta.seed);
  let idx = 0;
  let t = 0;
  let k = 0;
  while (S.step < END) {
    t = Math.min(END, t + (typeof chunk === "function" ? chunk(k++) : chunk));
    idx = runTo(S, fx.events, idx, t);
    S.out.length = 0;
  }
  return simHash(S);
}

test("same hash at 1, 3, 17, 60 and 1000 steps per frame", () => {
  const ref = runChunked(END);
  for (const c of [1, 3, 17, 60, 1000]) assert.equal(runChunked(c), ref, `chunk ${c}`);
});

test("same hash with irregular frames (a janky device)", () => {
  const ref = runChunked(END);
  let s = 12345;
  const jank = () => ((s = (s * 1103515245 + 12345) >>> 0) % 400) + 1;
  assert.equal(runChunked(jank), ref);
});

test("a catch-up budget of 0.01 ms per call still lands on the same hash", () => {
  const ref = runChunked(END);
  const S = genesis(fx.meta.seed);
  let idx = 0;
  let clock = 0;
  while (S.step < END) {
    idx = runTo(S, fx.events, idx, END, { budgetMs: 0.01, now: () => (clock += 1) });
    S.out.length = 0;
  }
  assert.equal(simHash(S), ref);
});

test("joining late from any snapshot equals a full replay", () => {
  const ref = runChunked(END);
  for (const at of [1, 999, Math.floor(END / 3), END - 1]) {
    const S = genesis(fx.meta.seed);
    let idx = runTo(S, fx.events, 0, at);
    const snap = JSON.parse(JSON.stringify(snapshot(S)));
    const R = restore(snap);
    let j = 0;
    while (j < fx.events.length && fx.events[j].step < R.step) j++;
    runTo(R, fx.events, j, END);
    assert.equal(simHash(R), ref, `snapshot at ${at}`);
    assert.ok(idx >= 0);
  }
});

test("two demo viewers opening minutes apart in one epoch agree", () => {
  const epoch = 490123;
  const a = new DemoFeed(epoch * DEMO_EPOCH_MS + 1000);
  const b = new DemoFeed(epoch * DEMO_EPOCH_MS + 25 * 60000);
  a.generate(30000);
  for (let s = 0; s < 30000; s += 777) b.generate(s);
  b.generate(30000);
  const A = genesis(a.seed), B = genesis(b.seed);
  runTo(A, a.events, 0, 30000);
  runTo(B, b.events, 0, 30000);
  assert.equal(simHash(A), simHash(B));
});
