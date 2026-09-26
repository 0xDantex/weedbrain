// THE BRAIN OF A JOINT. A made-up anatomy drawn like an atlas plate: a
// brain built out of the bud texture, a mesh of neurons over it, pulses
// running along the mesh. Six regions answer to the chain: a buy fires the
// CB1 LOBE, a sell heats the EMBER NUCLEUS, a buzzkill wakes the PARANOIA
// TRACT, the spill jolts the MUG CORTEX, the pile sets the BUD GANGLION and
// the MUNCHIE NERVE never stops. Display only: nothing here feeds the sim.

export const REGIONS = [
  { key: "cb1", name: "CB1 LOBE", sub: "receptor cluster, 4 511 nodes", neurons: 4511, at: [0.25, 0.3], side: -1, joke: "fires on every buy. has never once said no." },
  { key: "mug", name: "MUG CORTEX", sub: "fine motor, unreliable", neurons: 38900, at: [0.21, 0.56], side: -1, joke: "fine motor control. drops the mug anyway." },
  { key: "bud", name: "BUD GANGLION", sub: "dense, chronically saturated", neurons: 61200, at: [0.52, 0.2], side: -1, joke: "keeps count of the buds left. rounds up." },
  { key: "paranoia", name: "PARANOIA TRACT", sub: "inhibitory, overactive", neurons: 27300, at: [0.8, 0.34], side: 1, joke: "sees buzzkills before they exist. sometimes after." },
  { key: "ember", name: "EMBER NUCLEUS", sub: "thermal core, 420 K", neurons: 420, at: [0.52, 0.48], side: 1, joke: "runs hotter with every sell. 420 K, obviously." },
  { key: "munchie", name: "MUNCHIE NERVE", sub: "afferent, always firing", neurons: 34369, at: [0.63, 0.86], side: 1, joke: "the only one that never sleeps. asking about snacks." },
];
export const TOTAL_NEURONS = REGIONS.reduce((a, r) => a + r.neurons, 0);

const W = 1100;
const H = 660;
const BX = 110; // brain box inside the canvas
const BY = 40;
const BW = 880;
const BH = 560;
const P = (x, y) => [BX + x * BW, BY + y * BH];

function brainParts() {
  const p = new Path2D();
  const m = (x, y) => p.moveTo(...P(x, y));
  const c = (a, b, cc, d, e, f) => p.bezierCurveTo(...P(a, b), ...P(cc, d), ...P(e, f));
  m(0.1, 0.62);
  c(0.02, 0.45, 0.07, 0.2, 0.25, 0.11);
  c(0.4, 0.03, 0.63, 0.03, 0.77, 0.11);
  c(0.93, 0.2, 0.99, 0.4, 0.93, 0.56);
  c(0.89, 0.66, 0.8, 0.69, 0.72, 0.69);
  c(0.6, 0.69, 0.53, 0.72, 0.46, 0.7);
  c(0.34, 0.77, 0.2, 0.75, 0.1, 0.62);
  p.closePath();
  const cb = new Path2D();
  cb.ellipse(...P(0.77, 0.75), 0.13 * BW, 0.085 * BH, -0.12, 0, Math.PI * 2);
  const s = new Path2D();
  s.moveTo(...P(0.585, 0.66));
  s.bezierCurveTo(...P(0.6, 0.8), ...P(0.6, 0.9), ...P(0.605, 1.0));
  s.lineTo(...P(0.675, 1.0));
  s.bezierCurveTo(...P(0.67, 0.9), ...P(0.68, 0.78), ...P(0.7, 0.66));
  s.closePath();
  // stem first, then the cerebellum, then the cortex on top
  return [s, cb, p];
}

// folds, as polylines in brain coordinates
const SULCI = [
  [[0.18, 0.2], [0.24, 0.26], [0.22, 0.34], [0.3, 0.4]],
  [[0.34, 0.1], [0.36, 0.2], [0.33, 0.3], [0.38, 0.38], [0.36, 0.5]],
  [[0.46, 0.06], [0.47, 0.16], [0.43, 0.24], [0.48, 0.32]],
  [[0.56, 0.07], [0.58, 0.18], [0.63, 0.24], [0.6, 0.34], [0.66, 0.42]],
  [[0.7, 0.12], [0.69, 0.22], [0.76, 0.27], [0.74, 0.36]],
  [[0.83, 0.2], [0.82, 0.3], [0.88, 0.36], [0.86, 0.46]],
  [[0.2, 0.62], [0.3, 0.56], [0.42, 0.58], [0.52, 0.54], [0.62, 0.58], [0.72, 0.56]],
  [[0.12, 0.44], [0.18, 0.46], [0.16, 0.54]],
  [[0.45, 0.4], [0.52, 0.44], [0.58, 0.42], [0.64, 0.48]],
  [[0.28, 0.66], [0.36, 0.66], [0.44, 0.62]],
  [[0.68, 0.72], [0.76, 0.7], [0.86, 0.72]],
  [[0.69, 0.77], [0.78, 0.76], [0.87, 0.79]],
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export class Brain {
  constructor(canvas, buds, { reduced = false } = {}) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d");
    this.reduced = reduced;
    this.parts = brainParts();
    this.act = Object.fromEntries(REGIONS.map((r) => [r.key, 0.15]));
    this.synapses = Object.fromEntries(REGIONS.map((r) => [r.key, Math.round(r.neurons * 7.3)]));
    this.hover = null;
    this.zoom = 1;
    this.rot = 0;
    this.rotT = 0;
    this.visible = true;
    this.buildBase(buds);
    this.buildMesh();
    this.pulses = [];
    this.last = 0;
  }

  buildBase(buds) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d");
    const pat = x.createPattern(buds, "repeat");
    // each part is filled and outlined on its own, so overlaps never cancel
    for (const part of this.parts) {
      x.save();
      x.clip(part);
      x.fillStyle = pat;
      x.fillRect(0, 0, W, H);
      const sh = x.createRadialGradient(BX + BW * 0.4, BY + BH * 0.3, 60, BX + BW * 0.5, BY + BH * 0.45, BW * 0.62);
      sh.addColorStop(0, "rgba(255,248,225,0.18)");
      sh.addColorStop(0.6, "rgba(0,0,0,0)");
      sh.addColorStop(1, "rgba(28,26,23,0.5)");
      x.fillStyle = sh;
      x.fillRect(0, 0, W, H);
      x.restore();
      x.lineWidth = 2;
      x.strokeStyle = "#2a2620";
      x.stroke(part);
    }
    x.save();
    x.clip(this.parts[2]);
    // the folds: an ink groove with a lit edge beside it
    x.lineCap = "round";
    x.lineJoin = "round";
    for (const line of SULCI) {
      const pts = line.map(([a, b]) => P(a, b));
      const stroke = (w, col, dx, dy) => {
        x.beginPath();
        x.moveTo(pts[0][0] + dx, pts[0][1] + dy);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
          x.quadraticCurveTo(pts[i][0] + dx, pts[i][1] + dy, mx + dx, my + dy);
        }
        x.lineTo(pts.at(-1)[0] + dx, pts.at(-1)[1] + dy);
        x.strokeStyle = col;
        x.lineWidth = w;
        x.stroke();
      };
      stroke(9, "rgba(28,26,23,0.45)", 0, 0);
      stroke(3, "rgba(28,26,23,0.8)", 0, 0);
      stroke(2, "rgba(255,244,214,0.35)", 3, -3);
    }
    x.restore();
    this.base = c;
  }

  buildMesh() {
    const r = rng(4663);
    const x = this.ctx;
    const nodes = [];
    let guard = 0;
    while (nodes.length < 260 && guard++ < 20000) {
      const px = BX + r() * BW, py = BY + r() * BH;
      if (!this.inside(px, py)) continue;
      let best = 0, bd = Infinity;
      REGIONS.forEach((g, i) => {
        const [cx, cy] = P(...g.at);
        const d = (cx - px) ** 2 + (cy - py) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      nodes.push({ x: px, y: py, reg: best, ph: r() * 6.28 });
    }
    const edges = [];
    nodes.forEach((n, i) => {
      const near = nodes.map((m, j) => [j, (m.x - n.x) ** 2 + (m.y - n.y) ** 2]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 3);
      for (const [j] of near) if (i < j || !near.find(([k]) => k === i)) edges.push([i, j]);
    });
    // long tracts between region hubs
    const hubs = REGIONS.map((_, ri) => nodes.findIndex((n) => n.reg === ri));
    for (let a = 0; a < hubs.length; a++) for (let b = a + 1; b < hubs.length; b++) if (hubs[a] >= 0 && hubs[b] >= 0 && r() < 0.7) edges.push([hubs[a], hubs[b], true]);
    this.nodes = nodes;
    this.edges = edges;
    // region outlines for the hover highlight: the hull of each region's nodes
    this.hulls = REGIONS.map((_, ri) => hull(nodes.filter((n) => n.reg === ri).map((n) => [n.x, n.y])));
    // connectivity between regions, counted from the mesh
    const m = REGIONS.map(() => REGIONS.map(() => 0));
    for (const [a, b] of edges) {
      const ra = nodes[a].reg, rb = nodes[b].reg;
      m[ra][rb]++;
      if (ra !== rb) m[rb][ra]++;
    }
    // inside a region nearly every edge stays local, so the diagonal and the
    // links between regions are scaled on their own
    const off = Math.max(1, ...m.flatMap((row, i) => row.filter((_, j) => j !== i)));
    this.conn = m.map((row, i) => row.map((v, j) => (i === j ? 1 : v / off)));
  }

  inside(px, py) {
    return this.parts.some((p) => this.ctx.isPointInPath(p, px, py));
  }

  /** Something happened on the chain: excite a region. */
  fire(key, amount) {
    this.act[key] = Math.min(1, this.act[key] + amount);
    this.synapses[key] += Math.round(amount * 97);
    const ri = REGIONS.findIndex((g) => g.key === key);
    if (this.reduced) return;
    const n = Math.round(4 + amount * 14);
    for (let i = 0; i < n; i++) {
      const cand = this.edges.filter(([a, b]) => this.nodes[a].reg === ri || this.nodes[b].reg === ri);
      const e = cand[Math.floor(Math.random() * cand.length)];
      if (e) this.pulses.push({ e, t: 0, v: 0.6 + Math.random() * 0.9, hot: this.act[key] > 0.45 });
    }
  }

  /** Background levels from the sim state, every frame. */
  track(S) {
    const pile = Math.max(0, 1 - Math.min(1, S.melt) / 0.8);
    this.act.bud = this.act.bud * 0.9 + pile * 0.1 * 0.8;
    this.act.ember = Math.max(this.act.ember, S.mood * 0.6);
    this.act.munchie = Math.max(this.act.munchie, 0.5);
    this.act.paranoia = Math.max(this.act.paranoia, Math.min(1, S.kills.length / 8));
  }

  regionAt(cx, cy) {
    const [x, y] = this.toBrain(cx, cy);
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const hit = this.inside(x, y);
    this.ctx.restore();
    if (!hit) return null;
    let best = null, bd = Infinity;
    REGIONS.forEach((g) => {
      const [px, py] = P(...g.at);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) { bd = d; best = g.key; }
    });
    return best;
  }

  /** Canvas pixels to brain space, undoing the zoom and tilt. */
  toBrain(x, y) {
    const cx = W / 2, cy = H / 2;
    const a = -this.rot;
    const dx = (x - cx) / this.zoom, dy = (y - cy) / this.zoom;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  }

  /** Brain space to canvas pixels, for the callout lines. */
  toCanvas(x, y) {
    const cx = W / 2, cy = H / 2;
    const a = this.rot;
    const dx = x - cx, dy = y - cy;
    return [cx + (dx * Math.cos(a) - dy * Math.sin(a)) * this.zoom, cy + (dx * Math.sin(a) + dy * Math.cos(a)) * this.zoom];
  }

  anchor(key) {
    const g = REGIONS.find((r) => r.key === key);
    return this.toCanvas(...P(...g.at));
  }

  draw(now) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.rot += (this.rotT - this.rot) * Math.min(1, dt * 6);
    for (const k in this.act) this.act[k] = Math.max(0.08, this.act[k] - dt * 0.12);
    if (!this.visible) return;
    const x = this.ctx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, W, H);
    x.setTransform(this.zoom, 0, 0, this.zoom, W / 2 - (W / 2) * this.zoom, H / 2 - (H / 2) * this.zoom);
    x.translate(W / 2, H / 2);
    x.rotate(this.rot);
    x.translate(-W / 2, -H / 2);
    x.drawImage(this.base, 0, 0);

    // region glow where activity is high
    REGIONS.forEach((g, ri) => {
      const a = this.act[g.key];
      if (a < 0.35) return;
      const [cx, cy] = P(...g.at);
      const gr = x.createRadialGradient(cx, cy, 4, cx, cy, 120);
      gr.addColorStop(0, `rgba(245,166,35,${(a - 0.3) * 0.5})`);
      gr.addColorStop(1, "rgba(232,84,30,0)");
      x.save();
      x.clip(this.parts[2]);
      x.fillStyle = gr;
      x.fillRect(cx - 130, cy - 130, 260, 260);
      x.restore();
    });

    // the mesh
    const hot = (ri) => this.act[REGIONS[ri].key];
    for (const [a, b, tract] of this.edges) {
      const na = this.nodes[a], nb = this.nodes[b];
      const h = Math.max(hot(na.reg), hot(nb.reg));
      x.strokeStyle = h > 0.55 ? `rgba(245,166,35,${0.35 + h * 0.4})` : `rgba(255,246,222,${tract ? 0.22 : 0.4})`;
      x.lineWidth = tract ? 0.8 : 0.9;
      x.beginPath();
      x.moveTo(na.x, na.y);
      if (tract) x.quadraticCurveTo((na.x + nb.x) / 2, Math.min(na.y, nb.y) - 40, nb.x, nb.y);
      else x.lineTo(nb.x, nb.y);
      x.stroke();
    }
    for (const n of this.nodes) {
      const h = hot(n.reg);
      x.fillStyle = h > 0.55 ? "#f5a623" : "#fff6de";
      const r = 1.6 + (this.reduced ? 0 : Math.sin(now / 400 + n.ph) * 0.5) + h * 1.2;
      x.beginPath();
      x.arc(n.x, n.y, r, 0, 6.283);
      x.fill();
    }

    // pulses running along the mesh; the munchie nerve keeps them coming
    if (!this.reduced) {
      for (const g of REGIONS) if (Math.random() < dt * (0.6 + this.act[g.key] * 5)) this.fire(g.key, 0);
      for (let i = this.pulses.length - 1; i >= 0; i--) {
        const p = this.pulses[i];
        p.t += dt * p.v;
        if (p.t >= 1) { this.pulses.splice(i, 1); continue; }
        const na = this.nodes[p.e[0]], nb = this.nodes[p.e[1]];
        const px = na.x + (nb.x - na.x) * p.t, py = na.y + (nb.y - na.y) * p.t;
        x.fillStyle = p.hot ? "#e8541e" : "#ffffff";
        x.beginPath();
        x.arc(px, py, p.hot ? 3.2 : 2.2, 0, 6.283);
        x.fill();
      }
      if (this.pulses.length > 400) this.pulses.splice(0, this.pulses.length - 400);
    }

    // hover: everything else goes quiet under a paper veil
    if (this.hover) {
      const ri = REGIONS.findIndex((g) => g.key === this.hover);
      const h = this.hulls[ri];
      x.save();
      const veil = new Path2D();
      veil.rect(-W, -H, 3 * W, 3 * H);
      if (h.length) {
        veil.moveTo(h[0][0], h[0][1]);
        for (const [a, b] of h.slice(1)) veil.lineTo(a, b);
        veil.closePath();
      }
      x.fillStyle = "rgba(244,241,234,0.72)";
      x.fill(veil, "evenodd");
      if (h.length) {
        x.beginPath();
        x.moveTo(h[0][0], h[0][1]);
        for (const [a, b] of h.slice(1)) x.lineTo(a, b);
        x.closePath();
        x.setLineDash([5, 4]);
        x.strokeStyle = "#e8541e";
        x.lineWidth = 1.5;
        x.stroke();
      }
      x.restore();
    }
  }

  stats(key) {
    const g = REGIONS.find((r) => r.key === key);
    const a = this.act[key];
    return {
      ...g,
      activity: a,
      synapses: this.synapses[key],
      hz: 4 + a * 38 + (key === "munchie" ? 12 : 0),
    };
  }
}

function hull(points) {
  if (points.length < 3) return points;
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  // pad the hull outward a little so its border does not cut through nodes
  const cx = h.reduce((s, q) => s + q[0], 0) / h.length, cy = h.reduce((s, q) => s + q[1], 0) / h.length;
  return h.map(([a, b]) => [a + (a - cx) * 0.12, b + (b - cy) * 0.12]);
}

export const BRAIN_SIZE = { W, H };
