// Economy on real trades (fixtures captured from live Pons v2 tokens) and on
// synthetic extremes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIM, STAGES, sizeOf } from "../src/engine.js";
import { fixture, walk, ev } from "./_util.js";

function stageShare(events, seed, steps) {
  const h = new Array(10).fill(0);
  let maxJ = 0, maxK = 0;
  walk(events, seed, steps, (S) => {
    h[S.stage]++;
    maxJ = Math.max(maxJ, S.joints.length);
    maxK = Math.max(maxK, S.kills.length);
  });
  return { share: h.map((v) => v / steps), maxJ, maxK };
}

for (const name of ["sniffr", "fomofied"]) {
  test(`${name}: real flow moves him through the stages, none owns the screen`, () => {
    const fx = fixture(name);
    const { share, maxJ, maxK } = stageShare(fx.events, fx.meta.seed, fx.meta.safeStep);
    const report = STAGES.map((s, i) => `${s} ${(share[i] * 100).toFixed(1)}%`).join(", ");
    const visited = share.filter((v) => v > 0).length;
    assert.ok(visited >= 6, `only ${visited} stages visited: ${report}`);
    assert.ok(Math.max(...share) < 0.6, `one stage dominates: ${report}`);
    assert.ok(maxJ <= SIM.JOINT_CAP && maxK <= SIM.KILL_CAP);
  });
}

test("size mapping is logarithmic and bounded", () => {
  assert.equal(sizeOf(SIM.DUST / 2), 0);
  assert.ok(sizeOf(0.001) < sizeOf(0.01) && sizeOf(0.01) < sizeOf(0.1) && sizeOf(0.1) < sizeOf(1));
  assert.equal(sizeOf(1e9), 3);
  // ten times the size is far less than ten times the entity
  assert.ok(sizeOf(0.1) / sizeOf(0.01) < 3);
});

test("a hot token aggregates: 9,600 trades a minute do not make 9,600 entities", () => {
  const events = [];
  for (let s = 0; s < 1200; s++) for (let k = 0; k < 8; k++) events.push(ev(s, k % 2 ? 1 : -1, 0.004 + (k % 3) * 0.002));
  let peakK = 0, peakJ = 0;
  walk(events, 1, 1200, (S) => {
    peakK = Math.max(peakK, S.kills.length);
    peakJ = Math.max(peakJ, S.joints.length);
  });
  assert.ok(peakK <= SIM.KILL_CAP && peakJ <= SIM.JOINT_CAP);
});

test("a quiet token: one buy is one joint of its own size", () => {
  const S = walk([ev(10, 1, 0.02)], 1, 20);
  assert.equal(S.joints.length, 1);
  assert.ok(Math.abs(S.joints[0].full - sizeOf(0.02)) < 1e-12);
});

test("fresh launch: a 1,000x-plus first minute and a 47% retrace on two-sided flow keeps him off the gun for 3 minutes", () => {
  // the drawdown alone must not do it: the ATH comes from one-minute closes,
  // grows at most 4x a bar and the drawdown weight ramps in over 15 minutes
  const events = [];
  let px = 1e-9;
  for (let s = 0; s < 1200; s += 5) { px *= 1.036; events.push(ev(s, 1, 0.05, px)); }
  for (let s = 1200; s < 3600; s += 10) {
    const sell = (s / 10) % 2 === 0;
    px *= sell ? 0.9937 : 1.001;
    events.push(ev(s, sell ? -1 : 1, sell ? 0.025 : 0.02, px));
  }
  let worst = 0;
  const S = walk(events, 7, 3600, (S) => (worst = Math.max(worst, S.stage)));
  assert.ok(px / 1e-9 > 1000, "the fixture pumps past 1000x");
  assert.ok(worst < 9, `reached ${STAGES[worst]} inside three minutes of launch (haze ${S.haze.toFixed(2)})`);
});

test("only sells end at the gun; only buys end in the candy", () => {
  const sells = [], buys = [];
  let p1 = 1e-8, p2 = 1e-8;
  for (let s = 0; s < 40000; s += 40) {
    p1 *= 0.995; sells.push(ev(s, -1, 0.05, p1));
    p2 *= 1.001; buys.push(ev(s, 1, 0.05, p2));
  }
  sells.unshift(ev(0, 1, 0.01, 1e-8));
  assert.equal(walk(sells, 3, 40000).stage, 9);
  assert.equal(walk(buys, 3, 40000).stage, 0);
});

test("lighter flashes stop buzzkills: steady buys against steady sells repel some", () => {
  const events = [];
  for (let s = 0; s < 20000; s += 50) { events.push(ev(s, -1, 0.02)); events.push(ev(s + 25, 1, 0.03)); }
  const S = walk(events, 5, 20000);
  assert.ok(S.repelled > 0 && S.arrived >= 0);
  assert.ok(S.repelled + S.arrived + S.kills.length > 0);
});
