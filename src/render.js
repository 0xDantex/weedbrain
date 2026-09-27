// RENDER: cosmetics only. It reads the sim state and the sim's out records
// and never writes back, so Math.random and the wall clock are fine here.
//
// Two stacked canvases. The lower one holds the character: one frame of the
// current stage's clip, drawn with drawImage only when the frame changes.
// The upper one is this file's own Uint32Array buffer, pushed with a single
// putImageData per frame: the bud pile, the joints lying in it, the
// buzzkills, lighter flashes and smoke.

import { KILL_SPRITES } from "./sprites.js";

export const RW = 1280;
export const RH = 720;
const FW = 672;
const FH = 720;
const FX = (RW - FW) / 2;
const CX = RW / 2;
const PILE_MAX = 170; // pile height at the high: up to his waist
const MELT_BARE = 0.8; // at 80% down the pile is gone
const KILL_NEAR = 300; // where a buzzkill stands when it reaches him
const SCALE = 5; // buzzkill pixel scale
const TEX_H = 260;

// frames of each stage's clip and how the clip plays
export const CLIPS = [
  { frames: [1, 2, 3, 4, 5], play: "pingpong" },
  { frames: [6, 7, 8, 9, 10], play: "pingpong" },
  { frames: [11, 12, 13, 14, 15], play: "pingpong" },
  { frames: [16, 17, 18, 19, 20], play: "once" }, // the spill only goes one way
  { frames: [21, 22, 23, 24, 25], play: "pingpong" },
  { frames: [26, 27, 28, 29, 30], play: "pingpong" },
  { frames: [36, 37, 38, 39, 40], play: "pingpong" },
  { frames: [41, 42, 43, 44, 45], play: "pingpong" },
  { frames: [46, 47, 48], play: "loop" },
  { frames: [48, 49, 50], play: "loop" },
];
export const FRAME_NUMBERS = [...new Set(CLIPS.flatMap((c) => c.frames))];
const STEP = 110; // ms per frame, with a longer hold at both ends like the clips
const HOLD = 260;

const abgr = (rgb, a = 255) => ((a << 24) | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >>> 16) & 0xff)) >>> 0;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Which frame of a clip shows t ms after the clip started. */
export function clipFrame(clip, t, reduced) {
  const f = clip.frames;
  if (reduced) return f[clip.play === "once" ? f.length - 1 : Math.floor(f.length / 2)];
  if (clip.play === "once") {
    const i = Math.floor(t / STEP);
    // after the spill, rock between the last two frames
    return i < f.length ? f[i] : f[f.length - 2 + (Math.floor(t / (STEP * 3)) % 2)];
  }
  if (clip.play === "loop") return f[Math.floor(t / STEP) % f.length];
  // forward and back, holding the ends
  const seq = [...f, ...f.slice(1, -1).reverse()];
  const durs = seq.map((_, i) => (i === 0 || i === f.length - 1 ? HOLD : STEP));
  const total = durs.reduce((a, b) => a + b, 0);
  let m = t % total;
  for (let i = 0; i < seq.length; i++) {
    if (m < durs[i]) return seq[i];
    m -= durs[i];
  }
  return seq[0];
}

// Buzzkills are drawn as ink silhouettes, like specimens on a slide: the
// shape (cap, curlers, suit, collar) tells them apart, not the colour.
const INK = 0x2a2620;
const INK_LIT = 0x4a443a;

function buildSprite(def, frame) {
  const rows = def.rows.map((r) => r.padEnd(14, ".").slice(0, 14));
  const h = rows.length + 6;
  const px = new Uint32Array(14 * h);
  // outline pixels stay ink, fills go one step lighter so the shape reads
  rows.forEach((r, y) => {
    for (let x = 0; x < 14; x++) if (r[x] !== ".") px[y * 14 + x] = abgr(r[x] === "k" ? INK : INK_LIT);
  });
  const leg = abgr(INK_LIT), shoe = abgr(INK);
  const out = abgr(INK);
  const legX = frame ? [3, 8] : [4, 7];
  const lift = frame ? [0, 1] : [1, 0];
  for (let i = 0; i < 2; i++) {
    for (let y = 0; y < 6 - lift[i]; y++) {
      for (let x = 0; x < 3; x++) {
        px[(rows.length + y) * 14 + legX[i] + x] = y === 5 - lift[i] ? shoe : x === 0 ? out : leg;
      }
    }
  }
  return { w: 14, h, px };
}

export class Renderer {
  /**
   * art: canvas for the character, fx: canvas for this buffer.
   * frames: Map frame number -> image. buds: ImageData of buds.webp.
   */
  constructor(art, fx, frames, buds, { reducedMotion = false, bg = null } = {}) {
    for (const c of [art, fx, bg].filter(Boolean)) { c.width = RW; c.height = RH; }
    this.bgx = bg ? bg.getContext("2d") : null;
    this.embers = Array.from({ length: 70 }, () => ({ x: Math.random() * RW, y: Math.random() * RH, v: 8 + Math.random() * 22, r: 0.8 + Math.random() * 2.2, ph: Math.random() * 6.28 }));
    this.orbs = Array.from({ length: 9 }, (_, i) => ({ x: Math.random() * RW, y: 80 + Math.random() * 420, r: 60 + Math.random() * 140, v: (Math.random() - 0.5) * 6, ph: i }));
    this.actx = art.getContext("2d");
    this.actx.imageSmoothingQuality = "high";
    this.ctx = fx.getContext("2d");
    this.img = this.ctx.createImageData(RW, RH);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.frames = frames;
    this.tex = new Uint32Array(buds.data.buffer.slice(0));
    for (let i = 0; i < this.tex.length; i++) this.tex[i] = (this.tex[i] | 0xff000000) >>> 0;
    this.pile = new Uint32Array(RW * RH);
    this.top = new Int16Array(RW).fill(RH);
    this.pileLevel = -1;
    // bud bumps along the top of the pile, fixed for the page's life
    this.bumps = [];
    for (let x = -20; x < RW + 40; x += 18 + Math.random() * 16) this.bumps.push({ x, r: 12 + Math.random() * 20 });
    // the bumpy outline, worked out once
    this.bumpAt = new Float32Array(RW);
    for (let x = 0; x < RW; x++) {
      for (const u of this.bumps) {
        const dx = x - u.x;
        if (dx > -u.r && dx < u.r) this.bumpAt[x] = Math.max(this.bumpAt[x], Math.sqrt(u.r * u.r - dx * dx) * 0.55);
      }
    }
    this.sprites = KILL_SPRITES.map((d) => [buildSprite(d, 0), buildSprite(d, 1)]);
    this.reduced = reducedMotion;
    this.jv = new Map();
    this.kv = new Map();
    this.fx = [];
    this.parts = [];
    this.stage = -1;
    this.stageAt = 0;
    this.shownFrame = 0;
    this.timing = {};
    this.lastT = 0;
  }

  handle(rec, live) {
    if (rec.t === "joint" && !rec.merged && live) {
      this.jv.set(rec.id, { drop: 0, slot: Math.random() });
    } else if (rec.t === "flash" && live) {
      // the extra drag on a buy: a puff off his small joint
      for (let i = 0; i < 14; i++) this.parts.push({ x: CX + 150 + Math.random() * 60, y: 240 + Math.random() * 40, vx: 0.4 + Math.random() * 0.8, vy: -0.8 - Math.random() * 0.8, g: 0, life: 70, max: 70, c: 0xc9c6bf, r: 6, smoke: true });
      const x = CX + 150 + (Math.random() - 0.5) * 80;
      const y = Math.min(this.surface(x), RH - 40) - 30;
      this.fx.push({ t: "flash", x, y, age: 0, size: rec.size });
    } else if (rec.t === "repel") {
      const k = this.kv.get(rec.id);
      if (k) k.flee = true;
    } else if (rec.t === "arrive") {
      for (const id of rec.doused) this.jv.delete(id);
    } else if (rec.t === "burnout") {
      this.jv.delete(rec.id);
    } else if (rec.t === "spill" && live) {
      this.splash(CX + 60, RH - 260, 0x5a2e14, 70);
    }
  }

  /**
   * The room behind him: a dark grow-room glow that warms from green to
   * ember as he gets angrier, slow haze orbs and embers drifting up.
   */
  background(S, tm, dt, motion) {
    const x = this.bgx;
    const m = Math.max(0, Math.min(1, S.mood));
    const lerp = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * m));
    const inner = lerp([58, 74, 28], [110, 34, 18]);
    const mid = lerp([22, 30, 14], [38, 14, 10]);
    const g = x.createRadialGradient(CX, 300, 20, CX, 360, 820);
    g.addColorStop(0, `rgb(${inner})`);
    g.addColorStop(0.45, `rgb(${mid})`);
    g.addColorStop(1, "#0b0a08");
    x.fillStyle = g;
    x.fillRect(0, 0, RW, RH);
    // a faint lab grid, like the brain plate
    x.strokeStyle = "rgba(237,233,224,0.045)";
    x.lineWidth = 1;
    x.beginPath();
    for (let gx = 0.5; gx < RW; gx += 40) { x.moveTo(gx, 0); x.lineTo(gx, RH); }
    for (let gy = 0.5; gy < RH; gy += 40) { x.moveTo(0, gy); x.lineTo(RW, gy); }
    x.stroke();
    // haze orbs
    const glow = m > 0.5 ? "232,84,30" : "181,204,106";
    for (const o of this.orbs) {
      if (motion) o.x = (o.x + o.v * dt + RW + 300) % (RW + 300) - 150;
      const a = 0.05 + 0.04 * Math.sin(tm * 0.5 + o.ph);
      const rg = x.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      rg.addColorStop(0, `rgba(${glow},${a})`);
      rg.addColorStop(1, `rgba(${glow},0)`);
      x.fillStyle = rg;
      x.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
    }
    // embers rising, more and hotter when he is angry
    const n = Math.round(20 + 50 * m);
    for (let i = 0; i < n; i++) {
      const e = this.embers[i];
      if (motion) {
        e.y -= e.v * dt * (0.6 + m);
        e.x += Math.sin(tm + e.ph) * 0.3;
        if (e.y < -10) { e.y = RH + 10; e.x = Math.random() * RW; }
      }
      const tw = 0.5 + 0.5 * Math.sin(tm * 3 + e.ph);
      x.fillStyle = m > 0.5 ? `rgba(245,166,35,${0.35 + 0.5 * tw})` : `rgba(214,232,150,${0.2 + 0.4 * tw})`;
      x.beginPath();
      x.arc(e.x, e.y, e.r, 0, 6.283);
      x.fill();
    }
    // vignette
    const v = x.createRadialGradient(CX, RH / 2, RH * 0.45, CX, RH / 2, RW * 0.72);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    x.fillStyle = v;
    x.fillRect(0, 0, RW, RH);
  }

  splash(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      this.parts.push({ x: x + (Math.random() - 0.5) * 60, y: y + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 5, vy: -2 - Math.random() * 3, g: 0.25, life: 40, max: 40, c: color, r: 3 });
    }
  }

  /** y of the pile's top at x (RH where there is no pile). */
  surface(x) {
    const i = Math.max(0, Math.min(RW - 1, Math.round(x)));
    return this.top[i];
  }

  /** Rebuild the pile layer when its height moved by a pixel or more. */
  buildPile(level) {
    const h0 = Math.round(level * PILE_MAX);
    if (this.pileLevel >= 0 && h0 === Math.round(this.pileLevel * PILE_MAX) && this.pileW === this.picW) return;
    this.pileLevel = level;
    this.pileW = this.picW;
    const top = this.top;
    const bumpAmp = Math.min(1, level * 5);
    // the sides of the scene are banked up with buds: mounds that rise from
    // the edge of the picture outward, and melt with the rest of the pile
    const half = (this.picW || 700) / 2 - 40;
    const bank = Math.round(110 + 150 * level);
    for (let x = 0; x < RW; x++) {
      const d = (x - CX) / 420;
      const out = Math.max(0, Math.abs(x - CX) - half) / (RW / 2 - half);
      let h = h0 * (0.5 + 0.5 * Math.exp(-d * d)) + bank * Math.sin(Math.min(1, out) * Math.PI / 2) ** 1.3;
      h += this.bumpAt[x] * bumpAmp - (h0 > 0 ? 6 : 0);
      top[x] = h <= 0 ? RH : Math.round(RH - h);
    }
    const p = this.pile;
    let minTop = RH;
    for (let x = 0; x < RW; x++) if (top[x] < minTop) minTop = top[x];
    p.fill(0, 0, RW * minTop);
    for (let x = 0; x < RW; x++) for (let y = minTop; y < top[x]; y++) p[y * RW + x] = 0;
    const edge = abgr(0x1f2410);
    const shade = abgr(0x3a4418);
    for (let x = 0; x < RW; x++) {
      for (let y = top[x]; y < RH; y++) {
        const dy = y - top[x];
        p[y * RW + x] = dy < 3 ? edge : dy < 6 ? shade : this.tex[(dy % TEX_H) * RW + x];
      }
    }
  }

  syncEntities(S) {
    const live = new Set();
    for (const k of S.kills) {
      live.add(k.id);
      const target = CX + k.side * (KILL_NEAR + k.x * (RW / 2 - KILL_NEAR + 60));
      let v = this.kv.get(k.id);
      if (!v) {
        v = { x: CX + k.side * (RW / 2 + 60), side: k.side, variant: k.variant, walk: 0, knock: 0 };
        this.kv.set(k.id, v);
      }
      v.size = k.size;
      v.target = target;
    }
    for (const [id, v] of this.kv) if (!live.has(id) && !v.flee && !v.leave) this.kv.delete(id);
  }

  draw(S, now) {
    const t0 = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;
    const tm = now / 1000;
    const motion = this.reduced ? 0 : 1;

    // the character: the current stage's clip
    if (S.stage !== this.stage) {
      this.stage = S.stage;
      this.stageAt = now;
    }
    const fnum = clipFrame(CLIPS[S.stage], now - this.stageAt, this.reduced);
    if (fnum !== this.shownFrame) {
      const img = this.frames.get(fnum);
      if (img && img.complete && img.naturalWidth) {
        // the frame is the whole scene, nothing is painted behind it
        this.actx.drawImage(img, 0, 0, RW, RH);
        this.shownFrame = fnum;
      }
    }
    const tArt = performance.now();

    // nothing else is drawn into the scene: the frame carries the pile
    const buf = this.buf;
    buf.fill(0);
    const tPile = performance.now();

    // buzzkills live in the sim and the trade cards, not on the scene
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt * 60;
      const a = 1 - f.age / 16;
      if (a <= 0) { this.fx.splice(i, 1); continue; }
      this.burst(Math.round(f.x), Math.round(f.y), (10 + f.age * 3.2) * (0.8 + f.size * 0.4), a);
    }

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.x += p.vx + (p.smoke ? Math.sin(tm * 1.5 + p.y * 0.03) * 0.3 : 0);
      p.y += p.vy;
      p.vy += p.g;
      if (--p.life <= 0 || p.y > RH) { this.parts.splice(i, 1); continue; }
      const a = p.life / p.max;
      this.blob(Math.round(p.x), Math.round(p.y), p.smoke ? p.r + Math.floor((1 - a) * 6) : p.r, p.c, p.smoke ? a * 0.45 : 1);
    }
    if (this.parts.length > 500) this.parts.splice(0, this.parts.length - 500);
    const tSprites = performance.now();

    this.ctx.putImageData(this.img, 0, 0);
    const t1 = performance.now();
    this.timing = { art: tArt - t0, pile: tPile - tArt, sprites: tSprites - tPile, present: t1 - tSprites, total: t1 - t0 };
    return this.timing;
  }

  rect(x, y, w, h, c) {
    const a = Math.max(0, x), b = Math.min(RW, x + w);
    if (b <= a) return;
    for (let yy = Math.max(0, y); yy < Math.min(RH, y + h); yy++) this.buf.fill(c, yy * RW + a, yy * RW + b);
  }

  joint(x0, y, len, tm, id) {
    const s = 4;
    this.rect(x0 - s, y - s, len + 2 * s, 4 * s, abgr(0x2a1d14));
    this.rect(x0, y, len, s, abgr(0xf4f0e6));
    this.rect(x0, y + s, len, s, abgr(0xcfc6b4));
    for (let k = 9; k < len - 6; k += 16) this.rect(x0 + k, y, s, 2 * s, abgr(0xd8d0c0));
    const glow = 0.6 + 0.4 * Math.sin(tm * 9 + id) * (this.reduced ? 0 : 1);
    this.rect(x0 + len, y, s, 2 * s, abgr(0x8a8580));
    this.rect(x0 + len + s, y, s, 2 * s, glow > 0.7 ? abgr(0xffd23f) : abgr(0xff5a1e));
    this.rect(x0 + len + 2 * s, y, s, s, abgr(0xc23b10));
  }

  blitSprite(sp, ox, oy, sc, flip) {
    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) {
        const c = sp.px[y * sp.w + (flip ? sp.w - 1 - x : x)];
        if (c) this.rect(ox + x * sc, oy + y * sc, sc, sc, c);
      }
    }
  }

  blob(cx, cy, r, rgb, a) {
    const c = abgr(rgb, Math.round(255 * Math.min(1, a)));
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const px = cx + x, py = cy + y;
        if (px < 0 || py < 0 || px >= RW || py >= RH) continue;
        this.buf[py * RW + px] = c;
      }
    }
  }

  burst(cx, cy, r, a) {
    const core = abgr(0xfffbe0), ray = abgr(0xffd23f), edge = abgr(0xff8a1e);
    const ri = Math.ceil(r);
    for (let y = -ri; y <= ri; y++) {
      for (let x = -ri; x <= ri; x++) {
        const d = Math.sqrt(x * x + y * y);
        if (d > r) continue;
        const px = cx + x, py = cy + y;
        if (px < 0 || py < 0 || px >= RW || py >= RH) continue;
        const onRay = Math.abs(x) < 2 || Math.abs(y) < 2 || Math.abs(Math.abs(x) - Math.abs(y)) < 2;
        if (d < r * 0.3 * a + 3) this.buf[py * RW + px] = core;
        else if (onRay && a > BAYER[(py & 3) * 4 + (px & 3)] * 0.8) this.buf[py * RW + px] = d > r * 0.7 ? edge : ray;
      }
    }
  }

  bang(x, y) {
    const c = abgr(0xe4572e);
    this.rect(x - 4, y, 8, 22, c);
    this.rect(x - 4, y + 28, 8, 8, c);
  }
}

export const SCENE = { RW, RH, FX, FW, FH, CX };
