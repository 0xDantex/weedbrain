// Economy on real trades (fixtures captured from live Pons v2 tokens) and on
// synthetic extremes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIM, STAGES, sizeOf, genesis, applyEvent, simStep, snapshot, restore } from "../src/engine.js";
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
  assert.ok(worst < 9, `reached ${STAGES[worst]} inside three minutes of launch (melt ${S.melt.toFixed(2)})`);
});

test("only sells end at BLAST; only buys end at SHADES OFF", () => {
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

test("every trade moves him: a buy toward SHADES OFF, a sell toward BLAST, bigger moves further", () => {
  const S = genesis(1);
  S.mood = 0.55; S.spilled = 1; S.stage = 5;
  const at = (side, eth) => {
    const T = restore(snapshot(S));
    applyEvent(T, ev(0, side, eth));
    return T.mood - S.mood;
  };
  const smallBuy = at(1, 0.001), bigBuy = at(1, 1), smallSell = at(-1, 0.001), bigSell = at(-1, 0.05);
  assert.ok(smallBuy <= -0.1 + 1e-9 && bigBuy < smallBuy, `buys ${smallBuy} ${bigBuy}`);
  assert.ok(smallSell >= 0.1 - 1e-9 && bigSell > smallSell, `sells ${smallSell} ${bigSell}`);
  assert.ok(bigBuy >= -0.3 - 1e-9);
});

test("on a real graduated token over 9 in 10 trades move his mood", () => {
  const fx = fixture("fomofied");
  const S = genesis(fx.meta.seed);
  let i = 0, moved = 0, n = 0;
  for (let st = 0; st < fx.meta.safeStep; st++) {
    while (i < fx.events.length && fx.events[i].step <= S.step) {
      const e = fx.events[i++];
      if (e.step !== S.step || e.eth < SIM.DUST) continue;
      const m0 = S.mood, sp0 = S.spilled;
      applyEvent(S, e);
      n++;
      if (S.mood !== m0 || S.spilled !== sp0) moved++;
    }
    simStep(S);
    S.out.length = 0;
  }
  assert.ok(moved / n > 0.9, `${moved} of ${n}`);
});

test("a sell that pushes him past THE MUG tips it: SPILLED shows first", () => {
  const events = [ev(0, 1, 0.001)];
  for (let s = 300; s < 400; s += 20) events.push(ev(s, -1, 0.002));
  let spilledAt = -1, stageAfter = -1;
  walk(events, 3, 500, (S) => {
    if (spilledAt < 0 && S.spilled) { spilledAt = S.step; stageAfter = S.stage; }
  });
  assert.ok(spilledAt > 0, "never tipped");
  assert.equal(stageAfter, 3);
});

test("one big sell knocks the mug over at once: SPILLED plays, then two stages down", () => {
  const events = [ev(0, 1, 0.05, 1e-8), ev(1300, -1, 0.2, 1e-8)];
  let before = -1, after = -1, later = -1;
  walk(events, 9, 1600, (S) => {
    if (S.step === 1300) before = S.stage;
    if (S.step === 1301) after = S.stage;
    if (S.step === 1301 + SIM.SPILL_HOLD + 1) later = S.stage;
  });
  assert.ok(before <= 2, `was at ${STAGES[before]} before the sell`);
  assert.equal(after, 3, "the spill shows first");
  assert.ok(later >= Math.max(3, before + 2), `landed at ${STAGES[later]}`);
});

test("after the spill a long enough high brings a fresh mug and he can come back up", () => {
  const events = [ev(0, 1, 0.02, 1e-8), ev(200, -1, 0.3, 1e-8)];
  for (let s = 400; s < 20000; s += 30) events.push(ev(s, 1, 0.05, 1e-8 * (1 + s / 1e6)));
  let refilled = false;
  const S = walk(events, 2, 20000, (S) => { if (!S.spilled && S.step > 400) refilled = true; });
  assert.ok(refilled, "never refilled");
  assert.ok(S.stage <= 1, `ended at ${STAGES[S.stage]}`);
});

test("lighter flashes stop buzzkills: steady buys against steady sells repel some", () => {
  const events = [];
  for (let s = 0; s < 20000; s += 50) { events.push(ev(s, -1, 0.02)); events.push(ev(s + 25, 1, 0.03)); }
  const S = walk(events, 5, 20000);
  assert.ok(S.repelled > 0 && S.arrived >= 0);
  assert.ok(S.repelled + S.arrived + S.kills.length > 0);
});
