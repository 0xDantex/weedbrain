// RENDER: cosmetics only. It reads the sim state and the sim's out records
// and never writes back, so Math.random and the wall clock are fine here.
// Everything is drawn into one Uint32Array and pushed with a single
// putImageData per frame.

import { KILL_SPRITES, PAL } from "./sprites.js";

export const RW = 448;
export const RH = 336;
const FW = 252;
const FH = 316;
const FX = 98; // frame placement in the room
const FY = 4;
const CX = FX + FW / 2;
const FLOOR_Y = 300;
const WALL = 0xeb6c25;
const ASH_X = CX;
const ASH_Y = 320;
const KILL_NEAR = 64; // where a buzzkill stands when it reaches him

const abgr = (rgb) => (0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >>> 16) & 0xff)) >>> 0;
const R = (c) => c & 0xff;
const G = (c) => (c >>> 8) & 0xff;
const B = (c) => (c >>> 16) & 0xff;
const pack = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
const mix = (a, b, t) => pack(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, B(a) + (B(b) - B(a)) * t);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Decode the frame atlas (10 x 5 frames) into 50 pixel arrays with edges feathered into the wall. */
export function decodeAtlas(image) {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(image.width, image.height) : Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
  const x = c.getContext("2d");
  x.drawImage(image, 0, 0);
  const data = new Uint32Array(x.getImageData(0, 0, image.width, image.height).data.buffer);
  const wall = abgr(WALL);
  const frames = [];
  for (let i = 0; i < 50; i++) {
    const ox = (i % 10) * FW;
    const oy = Math.floor(i / 10) * FH;
    const f = new Uint32Array(FW * FH);
    for (let y = 0; y < FH; y++) {
      for (let xx = 0; xx < FW; xx++) {
        let p = data[(oy + y) * image.width + ox + xx];
        const edge = Math.min(xx, FW - 1 - xx, y);
        if (edge < 8) p = mix(wall, p, edge / 8);
        f[y * FW + xx] = p;
      }
    }
    frames.push(f);
  }
  return frames;
}

function buildRoom() {
  const bg = new Uint32Array(RW * RH);
  const wall = abgr(WALL);
  const shade = abgr(0x8c3a12);
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      // vignette toward the room edges, kept off the frame so no seam shows
      const dx = x < FX ? (FX - x) / FX : x >= FX + FW ? (x - FX - FW + 1) / (RW - FX - FW) : 0;
      const t = Math.min(1, dx * dx * 0.55 + (y < 20 ? (20 - y) / 60 : 0));
      bg[y * RW + x] = t > BAYER[(y & 3) * 4 + (x & 3)] * 0.9 + 0.05 ? mix(wall, shade, Math.min(1, t * 0.9)) : wall;
    }
  }
  // window on the left wall: night sky and a moon
  const wx = 14, wy = 46, ww = 62, wh = 82;
  const sky = abgr(0x18203a), frame = abgr(0x3a2012), star = abgr(0xdfe6ff), moon = abgr(0xf2ecc8);
  for (let y = wy; y < wy + wh; y++) {
    for (let x = wx; x < wx + ww; x++) {
      const border = x < wx + 4 || x >= wx + ww - 4 || y < wy + 4 || y >= wy + wh - 4 || Math.abs(x - (wx + ww / 2)) < 2 || Math.abs(y - (wy + wh / 2)) < 2;
      let c = border ? frame : sky;
      if (!border) {
        const mdx = x - (wx + ww - 18), mdy = y - (wy + 18);
        if (mdx * mdx + mdy * mdy < 64) c = moon;
        else if ((x * 7919 + y * 104729) % 97 === 0) c = star;
      }
      bg[y * RW + x] = c;
    }
  }
  // wooden floor
  const wood = abgr(0x3b2417), seam = abgr(0x24150c), lite = abgr(0x4a2e1d);
  for (let y = FLOOR_Y; y < RH; y++) {
    const row = Math.floor((y - FLOOR_Y) / 9);
    for (let x = 0; x < RW; x++) {
      let c = y === FLOOR_Y ? seam : y === FLOOR_Y + 1 ? lite : wood;
      if ((y - FLOOR_Y) % 9 === 0 && y > FLOOR_Y) c = seam;
      if ((x + row * 53) % 97 === 0) c = seam;
      bg[y * RW + x] = c;
    }
  }
  return bg;
}

function valueNoise(w, h, cell, seed) {
  const gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const g = new Float32Array(gw * gh).map(() => rnd());
  // wrap horizontally so the texture scrolls without a seam
  for (let y = 0; y < gh; y++) g[y * gw + gw - 1] = g[y * gw];
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / cell, gy = y / cell;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = gx - x0, ty = gy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function buildSprite(def, frame) {
  const rows = def.rows.map((r) => r.padEnd(14, ".").slice(0, 14));
  const h = rows.length + 6;
  const px = new Uint32Array(14 * h);
  rows.forEach((r, y) => {
    for (let x = 0; x < 14; x++) if (r[x] !== ".") px[y * 14 + x] = abgr(PAL[r[x]]);
  });
  // legs: two 3-pixel legs with a two-frame walk
  const [leg, shoe] = def.legs.map(abgr);
  const out = abgr(PAL.k);
  const legX = frame ? [3, 8] : [4, 7];
  const lift = frame ? [0, 1] : [1, 0];
  for (let i = 0; i < 2; i++) {
    for (let y = 0; y < 6 - lift[i]; y++) {
      for (let x = 0; x < 3; x++) {
        const yy = rows.length + y;
        const c = y === 5 - lift[i] ? shoe : x === 0 ? out : leg;
        px[yy * 14 + legX[i] + x] = c;
      }
    }
  }
  return { w: 14, h, px };
}

export class Renderer {
  constructor(canvas, frames, { reducedMotion = false, onPopup = () => {} } = {}) {
    this.canvas = canvas;
    canvas.width = RW;
    canvas.height = RH;
    this.ctx = canvas.getContext("2d");
    this.img = this.ctx.createImageData(RW, RH);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.frames = frames;
    this.room = buildRoom();
    this.cloud = valueNoise(RW * 2, RH, 40, 7);
    this.cloud2 = valueNoise(RW * 2, RH, 17, 11);
    this.sprites = KILL_SPRITES.map((d) => [buildSprite(d, 0), buildSprite(d, 1)]);
    this.reduced = reducedMotion;
    this.onPopup = onPopup;
    this.jv = new Map(); // joint id -> visual
    this.kv = new Map(); // buzzkill id -> visual
    this.fx = []; // transient effects
    this.parts = [];
    this.flashAmt = 0;
    this.puff = 0;
    this.lut = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    this.timing = {};
    this.lastT = 0;
  }

  /** Feed one sim out record. live=false during catch-up: no popups, no bursts. */
  handle(rec, live, symbol) {
    if (rec.t === "joint" && !rec.merged && live) {
      this.jv.set(rec.id, { drop: 0 });
    } else if (rec.t === "flash" && live) {
      const k = rec.target && this.kv.get(rec.target);
      const x = k ? k.x - k.side * 14 : ASH_X + 20;
      const y = k ? FLOOR_Y - 18 : ASH_Y - 16;
      this.fx.push({ t: "flash", x, y, age: 0, size: rec.size });
      this.flashAmt = Math.min(1, this.flashAmt + 0.35 + rec.size * 0.15);
      this.puff = 1;
      if (k) k.knock = 1;
    } else if (rec.t === "repel") {
      const k = this.kv.get(rec.id);
      if (k) { k.flee = true; k.gone = false; }
    } else if (rec.t === "arrive") {
      const k = this.kv.get(rec.id);
      if (k) k.leave = true;
      if (live) {
        for (let i = 0; i < 18; i++) {
          this.parts.push({ x: ASH_X + (Math.random() - 0.5) * 40, y: ASH_Y - 30 - Math.random() * 20, vx: (Math.random() - 0.5) * 0.6, vy: 1 + Math.random(), life: 30, max: 30, c: 0x6fa8ff, drip: true });
        }
      }
      for (const id of rec.doused) this.jv.delete(id);
    } else if (rec.t === "burnout") {
      this.jv.delete(rec.id);
    } else if (rec.t === "trade" && live && rec.eth > 0) {
      this.onPopup({ side: rec.side, tok: rec.tok, spawned: rec.spawned, x: rec.side > 0 ? ASH_X : CX, y: rec.side > 0 ? ASH_Y - 40 : FLOOR_Y - 60 });
    }
  }

  /** Sync visuals with sim entities. Returns nothing; positions ease toward the sim. */
  syncEntities(S) {
    const live = new Set();
    for (const k of S.kills) {
      live.add(k.id);
      const target = CX + k.side * (KILL_NEAR + k.x * (RW / 2 - KILL_NEAR + 24));
      let v = this.kv.get(k.id);
      if (!v) {
        v = { x: CX + k.side * (RW / 2 + 24), side: k.side, variant: k.variant, walk: 0, knock: 0 };
        this.kv.set(k.id, v);
      }
      v.size = k.size;
      v.target = target;
    }
    for (const [id, v] of this.kv) if (!live.has(id) && !v.flee && !v.leave) this.kv.delete(id);
  }

  draw(S, now, opts = {}) {
    const t0 = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;
    const tm = now / 1000;
    const buf = this.buf;
    const high = S.high;
    const haze = Math.min(1, S.haze);
    const motion = this.reduced ? 0 : 1;

    // room
    buf.set(this.room);
    const tRoom = performance.now();

    // string of pumpkin lights across the top, dimmer as the haze rises
    for (let i = 0; i < 18; i++) {
      const x = 12 + i * 25;
      const y = 14 + Math.round(Math.sin(i * 0.9) * 3);
      const on = 0.5 + 0.5 * (1 - haze) * (0.75 + 0.25 * Math.sin(tm * 2 + i * 1.7) * motion);
      const base = [0xffb23f, 0xb26bff, 0x7dff6b][i % 3];
      const c = abgr(mixRgb(0x3a1d0a, base, on));
      for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) + Math.abs(dy - 0.5) < 2.2) this.put(x + dx, y + dy, c);
      this.put(x, y - 2, abgr(0x1a1a1a));
    }

    // the reaper: continuous frame from the mood, a small idle drift, a puff on buys
    const sway = Math.round(Math.sin(tm * 0.9) * 3 * high * motion);
    const bob = Math.round(Math.sin(tm * 1.7) * 1.2 * high * motion);
    // each stage owns five frames, 5k..5k+4 and the first ones are the
    // move into it; the clip plays through by the middle of the stage's band
    // so the stage reads as itself for most of its time
    const sub = Math.max(0, Math.min(1, (S.mood * 10 - S.stage) * 2));
    let fi = S.stage * 5 + sub * 4 + Math.sin(tm * 1.3) * 0.7 * motion - this.puff * 2.5;
    // the idle drift stays inside the current stage's clip; a puff may dip one clip back
    const lo = S.stage * 5 - (this.puff > 0.05 ? 3 : 0);
    fi = Math.max(0, lo, Math.min(49, S.stage * 5 + 4, Math.round(fi)));
    this.blitFrame(this.frames[fi], FX + sway, FY + bob);
    this.puff = Math.max(0, this.puff - dt * 1.6);
    const tFrame = performance.now();

    // floor again over the robe hem, then the ashtray
    buf.set(this.room.subarray(FLOOR_Y * RW), FLOOR_Y * RW);
    this.ellipse(ASH_X, ASH_Y, 40, 9, abgr(0x1c1c20));
    this.ellipse(ASH_X, ASH_Y - 1, 37, 7, abgr(0x5c5c63));
    this.ellipse(ASH_X, ASH_Y - 1, 31, 5, abgr(0x2c2c31));

    // joints in the ashtray, longest first, each burning at its tip
    const joints = [...S.joints].sort((a, b) => b.len - a.len || a.id - b.id);
    joints.forEach((j, i) => {
      const v = this.jv.get(j.id) || { drop: 1 };
      if (!this.jv.has(j.id)) this.jv.set(j.id, v);
      v.drop = Math.min(1, v.drop + dt * 2.2);
      const len = Math.round(8 + Math.min(40, j.len * 11));
      const row = i % 4, col = Math.floor(i / 4);
      const x0 = ASH_X - 34 + col * 10 + (row % 2) * 5;
      const yEnd = ASH_Y - 6 - row * 3;
      const e = v.drop < 1 ? 1 - (1 - v.drop) * (1 - v.drop) : 1;
      const y = Math.round(-20 + (yEnd + 20) * e);
      // a rolled joint: outline, paper, a shaded underside, twisted end
      for (let k = -1; k <= len; k++) { this.put(x0 + k, y - 1, abgr(0x2a1d14)); this.put(x0 + k, y + 2, abgr(0x2a1d14)); }
      for (let k = 0; k < len; k++) {
        this.put(x0 + k, y, abgr(k % 6 === 3 ? 0xd8d0c0 : 0xf4f0e6));
        this.put(x0 + k, y + 1, abgr(k % 6 === 3 ? 0xb0a592 : 0xcfc6b4));
      }
      this.put(x0 - 1, y, abgr(0xe9e2d2));
      this.put(x0 - 2, y, abgr(0x2a1d14));
      const glow = 0.6 + 0.4 * Math.sin(tm * 9 + j.id) * motion;
      this.put(x0 + len, y, abgr(0x8a8580));
      this.put(x0 + len, y + 1, abgr(0x6f6a66));
      this.put(x0 + len + 1, y, abgr(mixRgb(0xc23b10, 0xffd23f, glow)));
      this.put(x0 + len + 1, y + 1, abgr(0xff5a1e));
      this.put(x0 + len + 2, y, abgr(mixRgb(0x8a2a0c, 0xff8a1e, glow)));
      if (motion && Math.random() < 0.35 * (1 - haze * 0.8)) {
        this.parts.push({ x: x0 + len + 1, y: y - 1, vx: (Math.random() - 0.5) * 0.25, vy: -0.35 - Math.random() * 0.3, life: 90, max: 90, c: 0xe8e2da, smoke: true });
      }
    });

    // buzzkills
    const order = [...this.kv.entries()].sort((a, b) => a[1].x - b[1].x);
    for (const [id, v] of order) {
      if (v.flee || v.leave) {
        v.x += v.side * (v.flee ? 180 : 90) * dt;
        if (v.x < -60 || v.x > RW + 60) { this.kv.delete(id); continue; }
      } else {
        v.x += (v.target - v.x) * Math.min(1, dt * 3);
        if (v.knock) v.x += v.side * 30 * v.knock * dt;
      }
      v.knock = Math.max(0, (v.knock || 0) - dt * 2);
      v.walk += dt * (v.flee ? 14 : 6);
      const scale = v.size >= 1.6 ? 3 : 2;
      const spr = this.sprites[v.variant][Math.floor(v.walk) & 1];
      const facingLeft = v.flee || v.leave ? v.side < 0 : v.side > 0;
      this.blitSprite(spr, Math.round(v.x - (spr.w * scale) / 2), FLOOR_Y + 14 - spr.h * scale, scale, facingLeft);
      if (v.flee) this.text3("!", Math.round(v.x) - 1, FLOOR_Y + 8 - spr.h * scale, abgr(0xffe45c));
    }

    // effects
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt * 60;
      if (f.t === "flash") {
        const r = 4 + f.age * 1.4 * (0.8 + f.size * 0.4);
        const a = 1 - f.age / 16;
        if (a <= 0) { this.fx.splice(i, 1); continue; }
        this.burst(Math.round(f.x), Math.round(f.y), r, a);
      }
    }

    // particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.x += p.vx + (p.smoke ? Math.sin(tm * 1.5 + p.y * 0.07) * 0.15 : 0);
      p.y += p.vy;
      if (p.drip) p.vy += 0.1;
      if (--p.life <= 0 || p.y > RH) { this.parts.splice(i, 1); continue; }
      const a = p.life / p.max;
      if (p.smoke) {
        const r = 1 + Math.floor((1 - a) * 3);
        this.blob(Math.round(p.x), Math.round(p.y), r, p.c, a * 0.55);
      } else {
        this.put(Math.round(p.x), Math.round(p.y), abgr(p.c));
      }
    }
    if (this.parts.length > 600) this.parts.splice(0, this.parts.length - 600);
    const tSprites = performance.now();

    // room smoke and colour temperature in one pass. Smoke is the high left
    // in the room: burning joints raise it, the drawdown haze takes it away.
    const smoke = motion ? high * (1 - haze) * 0.55 : 0;
    const warm = high * (1 - haze);
    const cold = haze;
    this.flashAmt = Math.max(0, this.flashAmt - dt * 2.5);
    const boost = 1 + this.flashAmt * 0.45;
    const [LR, LG, LB] = this.lut;
    // cold light desaturates toward a moonlit grey-blue instead of tinting
    // everything blue, so the reaper stays readable at the bottom
    const desat = 0.45 * cold;
    for (let v = 0; v < 256; v++) {
      LR[v] = clamp8(v * (1 + 0.06 * warm - 0.16 * cold) * boost);
      LG[v] = clamp8(v * (1 - 0.02 * warm - 0.04 * cold) * boost);
      LB[v] = clamp8((v * (1 - 0.1 * warm + 0.1 * cold) + 10 * cold) * boost);
    }
    const off = Math.floor(tm * 6) % RW;
    const off2 = Math.floor(tm * 11) % RW;
    const sr = 226, sg = 220, sb = 214;
    for (let y = 0; y < RH; y++) {
      const fall = y < 150 ? 1 : Math.max(0, 1 - (y - 150) / 150);
      const row = y * RW;
      for (let x = 0; x < RW; x++) {
        const c = buf[row + x];
        let r = LR[c & 0xff], g = LG[(c >>> 8) & 0xff], b = LB[(c >>> 16) & 0xff];
        if (desat > 0.01) {
          const l = r * 0.3 + g * 0.55 + b * 0.15;
          r += (l - r) * desat; g += (l - g) * desat; b += (l - b) * desat;
        }
        if (smoke > 0.01 && fall > 0) {
          const n = this.cloud[y * RW * 2 + x + off] * 0.65 + this.cloud2[y * RW * 2 + x + off2] * 0.35;
          const a = Math.max(0, n - 0.42) * 1.7 * smoke * fall;
          if (a > 0) { r += (sr - r) * a; g += (sg - g) * a; b += (sb - b) * a; }
        }
        buf[row + x] = pack(r, g, b);
      }
    }
    const tGrade = performance.now();

    this.ctx.putImageData(this.img, 0, 0);
    const t1 = performance.now();
    this.timing = { room: tRoom - t0, reaper: tFrame - tRoom, sprites: tSprites - tFrame, grade: tGrade - tSprites, present: t1 - tGrade, total: t1 - t0 };
    return this.timing;
  }

  put(x, y, c) {
    if (x >= 0 && y >= 0 && x < RW && y < RH) this.buf[y * RW + x] = c;
  }

  blitFrame(f, ox, oy) {
    for (let y = 0; y < FH; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= RH) continue;
      let sx0 = 0, sx1 = FW;
      if (ox < 0) sx0 = -ox;
      if (ox + FW > RW) sx1 = RW - ox;
      this.buf.set(f.subarray(y * FW + sx0, y * FW + sx1), dy * RW + ox + sx0);
    }
  }

  blitSprite(s, ox, oy, scale, flip) {
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const c = s.px[y * s.w + (flip ? s.w - 1 - x : x)];
        if (!c) continue;
        for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) this.put(ox + x * scale + xx, oy + y * scale + yy, c);
      }
    }
  }

  ellipse(cx, cy, rx, ry, c) {
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
      const yy = cy + y;
      if (yy < 0 || yy >= RH) continue;
      const a = Math.max(0, cx - w), b = Math.min(RW, cx + w + 1);
      this.buf.fill(c, yy * RW + a, yy * RW + b);
    }
  }

  blob(cx, cy, r, rgb, a) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r + 1) continue;
        const px = cx + x, py = cy + y;
        if (px < 0 || py < 0 || px >= RW || py >= RH) continue;
        if (a < BAYER[(py & 3) * 4 + (px & 3)]) continue;
        const i = py * RW + px;
        this.buf[i] = mix(this.buf[i], abgr(rgb), 0.6);
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
        const onRay = Math.abs(x) <= 0 || Math.abs(y) <= 0 || Math.abs(Math.abs(x) - Math.abs(y)) <= 0;
        const px = cx + x, py = cy + y;
        if (px < 0 || py < 0 || px >= RW || py >= RH) continue;
        if (d < r * 0.35 * a + 1) this.buf[py * RW + px] = core;
        else if (onRay && a > BAYER[(py & 3) * 4 + (px & 3)] * 0.8) this.buf[py * RW + px] = d > r * 0.7 ? edge : ray;
      }
    }
  }

  text3(ch, x, y, c) {
    if (ch === "!") for (let i = 0; i < 7; i++) if (i !== 5) { this.put(x, y + i, c); this.put(x + 1, y + i, c); }
  }
}

function clamp8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function mixRgb(a, b, t) {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return ((r & 255) << 16) | ((g & 255) << 8) | (bl & 255);
}

export const SCENE = { RW, RH, FX, FY, FW, FH, CX, FLOOR_Y, ASH_X, ASH_Y };
