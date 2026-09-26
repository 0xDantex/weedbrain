// WEEDBRAIN simulation. Everything that decides the joint's fate lives
// here and nothing here draws. The state is a pure function of
// (genesis seed, ordered event log, step number): no Math.random, no clock,
// no frame rate. Side effects for the renderer go into S.out as plain
// records; the renderer drains them and may be as random as it likes.
//
// Transcendental Math functions (log, exp, pow) are not required by the
// ECMAScript spec to round the same way in every engine, so the sim only
// uses + - * / and comparisons, which IEEE 754 fixes exactly. dlog2 below is
// built from those.

export const SIM = {
  STEP_MS: 50,
  STEPS_PER_BLOCK: 2, // a block is ~101.4 ms, two 50 ms steps
  SIZE_REF: 0.01, // ETH, reference point of the log size mapping
  SIZE_K: 0.72,
  DUST: 0.0003, // ETH; below this a trade moves the price but spawns nothing
  SPAWN_STEPS: 24, // flow steps one entity stands for on a busy token
  SPAWN_MAX: 6, // entities one event may spawn
  FLOW_EMA: 0.02,
  JOINT_CAP: 8, // beyond this new length feeds the shortest joint
  JOINT_MAX: 4,
  BURN: 1 / 900, // joint length per step; a size-1 joint burns 45 s
  KILL_CAP: 10, // beyond this a sell makes the biggest buzzkill bigger
  KILL_SPD: 1,
  PUSH: 0.32, // how far a lighter flash of size 1 pushes a buzzkill back
  HIT: 1.4,
  BIG_KILL: 1.6, // a buzzkill this size douses two joints
  DOUSE_DEBT: 0.05,
  DEBT_HEAL: 0.99955,
  HIGH_REF: 1.5, // burning length at which the high is half way
  NUDGE_MIN: 0.1, // every trade moves the mood at least one stage (a stage is 0.1)
  NUDGE_MAX: 0.3, // and the biggest (size 3) three stages
  DRIFT: 1 / 2400, // between trades the mood drifts toward its baseline with a time constant of 2 minutes
  SPILL_ETH: 0.1, // a sell at least this big (and SPILL_FLOW entities' worth) knocks the mug over
  SPILL_FLOW: 5,
  SPILL_BOIL: 600, // or the mood wanting past THE MUG for 30 s straight
  REFILL_MOOD: 0.3, // spilled, wanting back above SPILLED for REFILL_STEPS brings a fresh mug
  REFILL_STEPS: 200,
  MUG_SAFE: 200, // a fresh mug cannot be knocked over by a sell for 10 s
  SPILL_HOLD: 40, // steps SPILLED stays on screen after the mug goes, so the spill always plays
  STAGE_HYST: 0.015,
  BAR_STEPS: 1200, // ATH is taken from closed one-minute bars
  ATH_MAX_STEP: 4,
  ATH_RUN_BOOST: 3,
  DD_CAP: 0.88,
  BIRTH_GRACE: 18000, // steps (15 min) over which drawdown ramps to full weight
  OUT_CAP: 400,
};

export const STAGES = [
  "SHADES OFF", "EYES HEAVY", "THE MUG", "SPILLED", "SOAKED",
  "FISTS", "SUIT ON", "AIMING", "FIRING", "BLAST",
];

export const STAGE_NOTES = [
  "flat out in the pile", "smoking, going nowhere", "reaching for a drink", "it goes all over him", "no drink, no patience",
  "teeth grinding, first tremors", "cold and done talking", "steadies it at the camera", "muzzle flash, shells", "the whole frame goes",
];

/** THE MUG is the last stage before the spill, SPILLED the first after it. */
export const MUG = 2;

export const KILL_VARIANTS = ["COP", "MOM", "FED", "PRIEST"];

export const cl = (v, a, b) => (v < a ? a : v > b ? b : v);

/** FNV-1a over a string, finished with a murmur-style avalanche. */
export function seedFromString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Stateless hash random in [0, 1). The purpose goes into the key so a new
 * roll in one subsystem never shifts another. In JS `^` returns a signed
 * 32-bit int, so every XOR is closed with >>>0; without it the value can go
 * negative and every roll below 0.5 (say, a side pick) comes out the same.
 */
export function srnd(a, b, c) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** log2 from exact IEEE operations only (see the header note). */
export function dlog2(x) {
  if (!(x > 0)) return -Infinity;
  let e = 0;
  while (x >= 2) { x /= 2; e++; }
  while (x < 1) { x *= 2; e--; }
  // ln(x) = 2 atanh(z), z = (x-1)/(x+1), |z| <= 1/3 on [1, 2)
  const z = (x - 1) / (x + 1);
  const z2 = z * z;
  let term = z, sum = 0;
  for (let k = 1; k < 40; k += 2) {
    sum += term / k;
    term *= z2;
  }
  return e + (2 * sum) / 0.6931471805599453;
}

/** Trade size in quote units to entity size, logarithmic because real trades span five orders. */
export function sizeOf(q) {
  if (!(q > 0) || q < SIM.DUST) return 0;
  return cl(dlog2(1 + q / SIM.SIZE_REF) * SIM.SIZE_K + 0.22, 0.2, 3.0);
}

export function genesis(seed) {
  return {
    seed: seed >>> 0,
    step: 0,
    px: 0, pxAth: 0, bar: -1, barHi: 0, barClose: 0, athRun: 0,
    flow: 0, vol: 0, buyAcc: 0, sellAcc: 0,
    debt: 0, melt: 0, mood: 0.25, high: 0, stage: MUG, spilled: 0, boil: 0, dry: 0, mugAge: SIM.MUG_SAFE, hold: 0,
    joints: [], kills: [],
    nextId: 1,
    buys: 0, sells: 0, repelled: 0, arrived: 0, doused: 0, evCount: 0,
    out: [], outDrop: 0,
  };
}

// Out records are for the renderer. If nobody drains them for a while (a
// long catch-up) the oldest go first, so the feed still ends on the latest.
function emit(S, rec) {
  if (S.out.length >= SIM.OUT_CAP) { S.out.shift(); S.outDrop++; }
  S.out.push(rec);
}

function txSeed(tx) {
  return typeof tx === "string" && tx.length >= 10 ? parseInt(tx.slice(2, 10), 16) >>> 0 : 0;
}

function addJoint(S, size, ev, k) {
  if (S.joints.length >= SIM.JOINT_CAP) {
    let j = S.joints[0];
    for (const o of S.joints) if (o.len < j.len) j = o;
    j.len = Math.min(SIM.JOINT_MAX, j.len + size);
    emit(S, { t: "joint", id: j.id, size, merged: true, tx: ev.tx, k });
    return j;
  }
  const j = { id: S.nextId++, len: size, full: size, born: S.step };
  S.joints.push(j);
  emit(S, { t: "joint", id: j.id, size, merged: false, tx: ev.tx, k });
  return j;
}

function flash(S, size, ev, k) {
  let target = null;
  for (const o of S.kills) if (!target || o.x < target.x || (o.x === target.x && o.id < target.id)) target = o;
  if (!target) {
    emit(S, { t: "flash", target: 0, size, tx: ev.tx, k });
    return;
  }
  target.x = Math.min(1.1, target.x + SIM.PUSH * size);
  target.hp -= size * SIM.HIT;
  emit(S, { t: "flash", target: target.id, size, tx: ev.tx, k });
  if (target.hp <= 0) {
    S.kills.splice(S.kills.indexOf(target), 1);
    S.repelled++;
    emit(S, { t: "repel", id: target.id, variant: target.variant, side: target.side });
  }
}

function addKill(S, size, ev, k) {
  if (S.kills.length >= SIM.KILL_CAP) {
    let b = S.kills[0];
    for (const o of S.kills) if (o.size > b.size) b = o;
    b.size = Math.min(3, b.size + size * 0.4);
    b.hp = Math.min(b.size * 2.2, b.hp + size * 0.4);
    emit(S, { t: "grow", id: b.id, size: b.size, tx: ev.tx, k });
    return;
  }
  const side = srnd(S.seed, S.step * 7 + k, 11) < 0.5 ? -1 : 1;
  const variant = (txSeed(ev.tx) + k) % KILL_VARIANTS.length;
  const kill = {
    id: S.nextId++,
    side,
    variant,
    x: 1,
    size,
    hp: size * 2.2,
    sp: (0.0009 + 0.0012 / Math.max(0.6, size)) * SIM.KILL_SPD,
    born: S.step,
  };
  S.kills.push(kill);
  emit(S, { t: "kill", id: kill.id, side, variant, size, tx: ev.tx, k });
}

/**
 * Apply one trade. ev: { step, side (+1 buy / -1 sell), eth (quote amount),
 * tok, px, blk, tx }. Must be called in canonical order for events at
 * S.step, before simStep for that step.
 */
export function applyEvent(S, ev) {
  const side = ev.side === 1 ? 1 : ev.side === -1 ? -1 : 0;
  if (!side) return;
  const q = Number.isFinite(ev.eth) && ev.eth > 0 ? ev.eth : 0;
  const px = Number.isFinite(ev.px) && ev.px > 0 ? ev.px : 0;
  S.evCount++;
  if (side > 0) S.buys++; else S.sells++;

  if (px > 0) {
    S.px = px;
    if (S.pxAth <= 0) {
      S.pxAth = px;
      S.barClose = px;
    }
    const bar = Math.floor(S.step / SIM.BAR_STEPS);
    if (bar !== S.bar) {
      if (S.bar >= 0) closeBar(S);
      S.bar = bar;
      S.barHi = px;
    }
    S.barClose = px;
    if (px > S.barHi) S.barHi = px;
  }

  S.vol += q;
  const spawned = [];
  emit(S, { t: "trade", side, eth: q, tok: ev.tok || 0, tx: ev.tx || "", blk: ev.blk || 0, trader: ev.trader || "", step: S.step, spawned });
  nudge(S, side, q, ev);
  if (q >= SIM.DUST) {
    const thr = Math.max(SIM.SIZE_REF, S.flow * SIM.SPAWN_STEPS);
    const evVol = Math.max(thr, q);
    let k = 0;
    if (side > 0) {
      S.buyAcc += q;
      while (S.buyAcc >= thr && k < SIM.SPAWN_MAX) {
        const take = Math.min(S.buyAcc, evVol);
        S.buyAcc -= take;
        const size = sizeOf(take);
        addJoint(S, size, ev, k);
        flash(S, size, ev, k);
        spawned.push("joint");
        k++;
      }
      // a quiet token spawns one joint per buy even under the threshold
      if (k === 0 && S.flow * SIM.SPAWN_STEPS < SIM.SIZE_REF * 1.5) {
        const size = sizeOf(q);
        S.buyAcc = Math.max(0, S.buyAcc - q);
        addJoint(S, size, ev, 0);
        flash(S, size, ev, 0);
        spawned.push("joint");
      }
      if (S.buyAcc > thr * (SIM.SPAWN_MAX + 1)) S.buyAcc = thr;
    } else {
      // one big sell knocks the mug over: the event the whole story turns on
      if (!S.spilled && S.mugAge >= SIM.MUG_SAFE && q >= Math.max(SIM.SPILL_ETH, S.flow * SIM.SPAWN_STEPS * SIM.SPILL_FLOW)) spill(S, "sell", ev.tx, q);
      S.sellAcc += q;
      while (S.sellAcc >= thr && k < SIM.SPAWN_MAX) {
        const take = Math.min(S.sellAcc, evVol);
        S.sellAcc -= take;
        addKill(S, sizeOf(take), ev, k);
        spawned.push("kill");
        k++;
      }
      if (k === 0 && S.flow * SIM.SPAWN_STEPS < SIM.SIZE_REF * 1.5) {
        S.sellAcc = Math.max(0, S.sellAcc - q);
        addKill(S, sizeOf(q), ev, 0);
        spawned.push("kill");
      }
      if (S.sellAcc > thr * (SIM.SPAWN_MAX + 1)) S.sellAcc = thr;
    }
  }
}

function spill(S, cause, tx, eth = 0, drop = 2) {
  S.spilled = 1;
  S.boil = 0;
  S.dry = 0;
  // the spill always plays first, then he lands `drop` stages below where he was
  const to = Math.min(9, Math.max(MUG + 1, S.stage + drop));
  S.mood = Math.max(S.mood, to / 10 + 0.03);
  emit(S, { t: "spill", cause, tx: tx || "", eth, from: S.stage, to });
  if (S.stage !== MUG + 1) {
    emit(S, { t: "stage", from: S.stage, to: MUG + 1 });
    S.stage = MUG + 1;
  }
  S.hold = SIM.SPILL_HOLD;
}

/** Where the mood settles when nothing trades. */
function baseline(S) {
  return cl(0.12 + cl(S.melt, 0, 1) * 0.5 - S.high * 0.12, 0, 1);
}

// The mug splits the ladder at THE MUG / SPILLED.
function clampToMug(S) {
  const edge = (MUG + 1) / 10;
  if (!S.spilled && S.mood >= edge) S.mood = edge - 0.0001;
  if (S.spilled && S.mood < edge) S.mood = edge;
}

function refill(S) {
  S.spilled = 0;
  S.dry = 0;
  S.mugAge = 0;
  emit(S, { t: "refill" });
}

/**
 * One trade moves his mood right away: a buy toward SHADES OFF, a sell
 * toward BLAST, one stage for the smallest trade and up to three for the
 * biggest, on the log size scale. A sell
 * that pushes him past THE MUG knocks it over (unless the mug is fresh); a
 * buy that pulls him back above SPILLED brings a fresh one.
 */
function nudge(S, side, q, ev) {
  const size = sizeOf(q);
  if (!size) return;
  const edge = (MUG + 1) / 10;
  const step = SIM.NUDGE_MIN + ((SIM.NUDGE_MAX - SIM.NUDGE_MIN) * (size - 0.2)) / 2.8;
  const next = cl(S.mood - side * step, 0, 1);
  if (side < 0 && !S.spilled && next >= edge && S.mugAge >= SIM.MUG_SAFE) {
    S.mood = next;
    spill(S, "tip", ev.tx, q, 1);
    return;
  }
  if (side > 0 && S.spilled && next < edge) {
    refill(S);
  }
  S.mood = next;
  clampToMug(S);
}

function closeBar(S) {
  const c = S.barClose;
  if (c > S.pxAth) {
    S.athRun = Math.min(6, S.athRun + 1);
    let cap = S.pxAth * SIM.ATH_MAX_STEP;
    for (let i = 1; i < S.athRun; i++) cap *= SIM.ATH_RUN_BOOST;
    S.pxAth = Math.min(c, cap);
  } else {
    S.athRun = 0;
  }
}

/** Advance one 50 ms step. */
export function simStep(S) {
  S.step++;
  S.flow = S.flow + (S.vol - S.flow) * SIM.FLOW_EMA;
  S.vol = 0;
  S.debt *= SIM.DEBT_HEAL;

  // joints burn down
  let burning = 0;
  for (let i = S.joints.length - 1; i >= 0; i--) {
    const j = S.joints[i];
    j.len -= SIM.BURN;
    if (j.len <= 0) {
      S.joints.splice(i, 1);
      emit(S, { t: "burnout", id: j.id });
    } else {
      burning += j.len;
    }
  }

  // buzzkills walk in; arrival douses the longest joint (two for a big one)
  for (let i = S.kills.length - 1; i >= 0; i--) {
    const k = S.kills[i];
    k.x -= k.sp;
    if (k.x <= 0) {
      S.kills.splice(i, 1);
      S.arrived++;
      const n = k.size >= SIM.BIG_KILL ? 2 : 1;
      const out = [];
      for (let d = 0; d < n && S.joints.length; d++) {
        let j = S.joints[0];
        for (const o of S.joints) if (o.len > j.len || (o.len === j.len && o.id < j.id)) j = o;
        S.joints.splice(S.joints.indexOf(j), 1);
        burning -= j.len;
        out.push(j.id);
        S.doused++;
      }
      S.debt += SIM.DOUSE_DEBT * (0.55 + (0.45 * Math.min(3, k.size)) / 3);
      emit(S, { t: "arrive", id: k.id, variant: k.variant, side: k.side, doused: out });
    }
  }
  if (burning < 0) burning = 0;

  // melt: how much of the bud pile is gone. The drawdown from the high plus
  // the debt of buzzkills that got through.
  let drop = S.pxAth > 0 && S.px > 0 ? cl(1 - S.px / S.pxAth, 0, 1) : 0;
  const ramp = SIM.BIRTH_GRACE > 0 ? cl(S.step / SIM.BIRTH_GRACE, 0, 1) : 1;
  drop = Math.min(drop, SIM.DD_CAP) * (0.25 + 0.75 * ramp);
  const meltT = cl(drop + S.debt, 0, 1.05);
  S.melt += (meltT - S.melt) * 0.06;

  // mood: 0 is SHADES OFF, 1 is BLAST. Every trade moves it at once (see
  // nudge). Between trades it drifts toward a baseline set by the pile and
  // the joints still burning, so a quiet chart settles where the price is.
  S.high = burning / (burning + SIM.HIGH_REF);
  const base = baseline(S);
  const edge = (MUG + 1) / 10;
  if (!S.spilled) {
    S.mugAge++;
    S.boil = base >= edge && S.mood >= edge - 0.01 ? S.boil + 1 : 0;
    if (S.boil >= SIM.SPILL_BOIL) spill(S, "boil", "");
  } else {
    S.dry = base < edge && S.mood <= edge + 0.01 ? S.dry + 1 : 0;
    if (S.dry >= SIM.REFILL_STEPS) refill(S);
  }
  S.mood = cl(S.mood + (base - S.mood) * SIM.DRIFT, 0, 1);
  clampToMug(S);

  // the named stage has hysteresis so it does not flicker on a boundary
  const raw = Math.min(9, Math.floor(S.mood * 10));
  if (S.hold > 0) S.hold--;
  else if (raw !== S.stage) {
    const edge = raw > S.stage ? raw / 10 : (raw + 1) / 10;
    if (Math.abs(S.mood - edge) >= SIM.STAGE_HYST || Math.abs(raw - S.stage) > 1) {
      emit(S, { t: "stage", from: S.stage, to: raw });
      S.stage = raw;
    }
  }
}

export const stageOf = (S) => S.stage;
export const burningLen = (S) => S.joints.reduce((a, j) => a + j.len, 0);

// ---- hash, snapshot --------------------------------------------------------

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);

/** FNV-1a over the exact bits of every number in the state. */
export function simHash(S) {
  let h = 2166136261 >>> 0;
  const i32 = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
  const f = (v) => { F64[0] = v; i32(U32[0]); i32(U32[1]); };
  i32(S.seed); i32(S.step);
  f(S.px); f(S.pxAth); i32(S.bar); f(S.barHi); f(S.barClose); i32(S.athRun);
  f(S.flow); f(S.vol); f(S.buyAcc); f(S.sellAcc);
  f(S.debt); f(S.melt); f(S.mood); f(S.high); i32(S.stage); i32(S.spilled); i32(S.boil); i32(S.dry); i32(S.mugAge); i32(S.hold);
  i32(S.nextId); i32(S.buys); i32(S.sells); i32(S.repelled); i32(S.arrived); i32(S.doused); i32(S.evCount);
  i32(S.joints.length);
  for (const j of S.joints) { i32(j.id); f(j.len); }
  i32(S.kills.length);
  for (const k of S.kills) { i32(k.id); i32(k.side); i32(k.variant); f(k.x); f(k.size); f(k.hp); }
  return h.toString(16).padStart(8, "0");
}

const FIELDS = [
  "seed", "step", "px", "pxAth", "bar", "barHi", "barClose", "athRun",
  "flow", "vol", "buyAcc", "sellAcc", "debt", "melt", "mood", "high", "stage", "spilled", "boil", "dry", "mugAge", "hold",
  "nextId", "buys", "sells", "repelled", "arrived", "doused", "evCount",
];

/** Snapshot at full precision; rounding here makes restored clients drift. */
export function snapshot(S) {
  const o = {};
  for (const k of FIELDS) o[k] = S[k];
  o.joints = S.joints.map((j) => [j.id, j.len, j.full, j.born]);
  o.kills = S.kills.map((k) => [k.id, k.side, k.variant, k.x, k.size, k.hp, k.sp, k.born]);
  o.hash = simHash(S);
  return o;
}

export function restore(o) {
  const S = genesis(o.seed);
  for (const k of FIELDS) {
    if (typeof o[k] !== "number" || !Number.isFinite(o[k])) throw new Error(`snapshot field ${k} is not a finite number`);
    S[k] = o[k];
  }
  S.joints = (o.joints || []).map(([id, len, full, born]) => ({ id, len, full, born }));
  S.kills = (o.kills || []).map(([id, side, variant, x, size, hp, sp, born]) => ({ id, side, variant, x, size, hp, sp, born }));
  if (o.hash && simHash(S) !== o.hash) throw new Error("snapshot hash does not match its contents");
  return S;
}

/**
 * Run the sim over a sorted event list up to targetStep. Returns the index
 * of the first event not applied. With budgetMs it stops early (checked
 * every 256 steps) so a page can catch up across frames.
 */
export function runTo(S, events, idx, targetStep, { budgetMs = 0, now = null } = {}) {
  const t0 = budgetMs && now ? now() : 0;
  while (S.step < targetStep) {
    while (idx < events.length && events[idx].step <= S.step) {
      if (events[idx].step === S.step) applyEvent(S, events[idx]);
      idx++;
    }
    simStep(S);
    if (budgetMs && now && (S.step & 255) === 0 && now() - t0 > budgetMs) break;
  }
  return idx;
}
