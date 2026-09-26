// THE BRAIN OF A JOINT, as a point cloud: every dot a neuron, the brain
// built out of bud-shaped lumps of them, soft shells where the lobes end.
// Neurons flash when the chain does something: a buy lights the CB1 LOBE,
// a sell the EMBER NUCLEUS and so on. It turns slowly on its own and can be
// dragged. Display only: nothing here feeds the sim. Needs the global THREE
// (three.js r158 from cdnjs).
import { REGIONS } from "./brain.js";

const VW = 1100;
const VH = 660;

// region centres, mirrored across both hemispheres
const CENTERS = {
  cb1: [-1.05, 0.55, 0.62],
  mug: [-1.15, -0.35, 0.62],
  bud: [0.0, 1.0, 0.62],
  paranoia: [1.15, 0.35, 0.62],
  ember: [0.05, -0.1, 0.0],
  munchie: [0.86, -1.2, 0.0],
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// the volume: two hemispheres, a cerebellum, a stem
const PARTS = [
  { c: [0, 0.1, -0.62], r: [1.65, 1.12, 0.78], cortex: true },
  { c: [0, 0.1, 0.62], r: [1.65, 1.12, 0.78], cortex: true },
  { c: [1.2, -0.78, 0], r: [0.78, 0.46, 1.05] },
  { stem: true, a: [0.72, -0.45, 0], b: [0.9, -1.55, 0], rad: 0.2 },
];

// folds: the surface of each lobe is pushed in and out along a few waves,
// which reads as gyri once the shell points sit on it
function fold(dx, dy, dz) {
  return 1 + 0.07 * Math.sin(8 * dx + 2) * Math.sin(6 * dy + 1) + 0.05 * Math.sin(11 * dz + 5 * dx) + 0.04 * Math.sin(13 * dy - 7 * dx);
}

// the cortex is a little flatter underneath and smaller at the front
function radii(p, dx, dy) {
  if (!p.cortex) return p.r;
  return [p.r[0] * (dx < 0 ? 0.94 : 1.04), p.r[1] * (dy < 0 ? 0.82 : 1), p.r[2]];
}

function inside(x, y, z) {
  for (const p of PARTS) {
    if (p.stem) {
      const [ax, ay] = p.a, [bx, by] = p.b;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      if ((x - px) ** 2 + (y - py) ** 2 + z * z < p.rad * p.rad) return true;
    } else {
      const [rx, ry, rz] = radii(p, x - p.c[0], y - p.c[1]);
      const dx = (x - p.c[0]) / rx, dy = (y - p.c[1]) / ry, dz = (z - p.c[2]) / rz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < fold(dx / (d || 1), dy / (d || 1), dz / (d || 1))) return true;
    }
  }
  return false;
}

export class Brain3D {
  constructor(canvas, { reduced = false, mobile = false } = {}) {
    const THREE = window.THREE;
    this.THREE = THREE;
    this.canvas = canvas;
    this.reduced = reduced;
    this.act = Object.fromEntries(REGIONS.map((r) => [r.key, 0.15]));
    this.synapses = Object.fromEntries(REGIONS.map((r) => [r.key, Math.round(r.neurons * 7.3)]));
    this.hover = null;
    this.zoom = 1;
    this.rot = 0;
    this.rotT = 0;
    this.visible = true;
    this.spin = 0;
    this.tilt = -0.12;
    this.last = 0;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x0e0d0b, 1);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, VW / VH, 0.1, 100);
    this.camera.position.set(0, 0, 7.2);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.build(mobile ? 26000 : 64000);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.bindDrag();
  }

  build(budget) {
    const THREE = this.THREE;
    const r = rng(4663);
    const pos = [], col = [], size = [], reg = [], base = [];
    const regionIdx = REGIONS.map(() => []);
    const keys = REGIONS.map((g) => g.key);
    const nearest = (x, y, z) => {
      let best = 0, bd = Infinity;
      keys.forEach((k, i) => {
        const c = CENTERS[k];
        for (const sz of c[2] ? [c[2], -c[2]] : [0]) {
          const d = (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - sz) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      });
      return best;
    };
    const bud = [0.55, 0.8, 0.25], budLight = [0.85, 0.95, 0.45], shell = [0.6, 0.95, 0.55];
    const push = (x, y, z, c, s, b) => {
      const ri = nearest(x, y, z);
      regionIdx[ri].push(pos.length / 3);
      pos.push(x, y, z);
      col.push(...c);
      size.push(s);
      reg.push(ri);
      base.push(b);
    };
    // bud lumps: dense little balls of neurons, packed through the volume
    const lumps = [];
    let guard = 0;
    while (lumps.length < 420 && guard++ < 40000) {
      const x = (r() * 2 - 1) * 2.2, y = r() * 3.4 - 2.1, z = (r() * 2 - 1) * 1.5;
      if (!inside(x, y, z)) continue;
      lumps.push([x, y, z, 0.1 + r() * 0.16]);
    }
    const perLump = Math.floor((budget * 0.6) / lumps.length);
    for (const [cx, cy, cz, rad] of lumps) {
      for (let i = 0; i < perLump; i++) {
        // points bunch toward the lump's skin, like the bracts of a bud
        const u = r() * 2 - 1, th = r() * 6.283, rr = rad * Math.cbrt(0.35 + r() * 0.65);
        const s = Math.sqrt(1 - u * u);
        const x = cx + rr * s * Math.cos(th), y = cy + rr * u * 0.85, z = cz + rr * s * Math.sin(th);
        if (!inside(x, y, z)) continue;
        const t = r();
        push(x, y, z, [bud[0] + (budLight[0] - bud[0]) * t, bud[1] + (budLight[1] - bud[1]) * t, bud[2] + (budLight[2] - bud[2]) * t], 1.8 + r() * 1.6, 0.5);
      }
    }
    // shells: a thin skin on each part, like the membranes on the fly
    const shellN = Math.floor(budget * 0.4);
    for (let i = 0; i < shellN; i++) {
      const p = PARTS[i % PARTS.length];
      let x, y, z;
      if (p.stem) {
        // a tapered tube around the stem's axis
        const t = r(), a = r() * 6.283;
        const ax = p.b[0] - p.a[0], ay = p.b[1] - p.a[1], L = Math.hypot(ax, ay);
        const nx = -ay / L, ny = ax / L;
        const rad = p.rad * (1 - 0.35 * t);
        x = p.a[0] + ax * t + nx * Math.cos(a) * rad;
        y = p.a[1] + ay * t + ny * Math.cos(a) * rad;
        z = Math.sin(a) * rad;
      } else {
        const u = r() * 2 - 1, th = r() * 6.283, s = Math.sqrt(1 - u * u);
        const dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
        const [rx, ry, rz] = radii(p, dx, dy);
        const f = fold(dx, dy, dz);
        x = p.c[0] + rx * dx * f;
        y = p.c[1] + ry * dy * f;
        z = p.c[2] + rz * dz * f;
        // the inner faces of the two hemispheres stay open
        if (p.cortex && Math.abs(z) < 0.14) continue;
      }
      push(x, y, z, shell, 1.5 + r() * 1.0, 0.42);
    }
    const n = pos.length / 3;
    this.n = n;
    this.regionIdx = regionIdx;
    this.flash = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute("region", new THREE.Float32BufferAttribute(reg, 1));
    g.setAttribute("base", new THREE.Float32BufferAttribute(base, 1));
    this.flashAttr = new THREE.BufferAttribute(this.flash, 1);
    this.flashAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("flash", this.flashAttr);
    this.dim = new Float32Array(6).fill(1);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uDim: { value: this.dim }, uScale: { value: 9 }, uPR: { value: 1 } },
      vertexShader: `
        attribute float size; attribute float region; attribute float base; attribute float flash;
        uniform float uDim[6]; uniform float uScale; uniform float uPR;
        varying vec3 vCol; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          int ri = int(region + 0.5);
          float d = 1.0;
          for (int i = 0; i < 6; i++) { if (i == ri) d = uDim[i]; }
          vec3 ember = mix(vec3(0.91, 0.33, 0.12), vec3(1.0, 0.86, 0.45), flash * flash);
          vCol = mix(color, ember, clamp(flash * 1.4, 0.0, 1.0));
          vA = (base + flash * 1.1) * d;
          gl_PointSize = size * (1.0 + flash * 1.6) * uPR * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c);
          if (r > 0.5) discard;
          float a = vA * (r < 0.22 ? 1.0 : smoothstep(0.5, 0.22, r));
          gl_FragColor = vec4(vCol * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.position.set(-0.1, 0.35, 0);
    this.group.add(this.points);
    // connectivity between regions, from how close their neurons sit
    const m = REGIONS.map(() => REGIONS.map(() => 0));
    const cs = REGIONS.map((g) => CENTERS[g.key]);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const a = cs[i], b = cs[j];
      m[i][j] = i === j ? 1 : 1 / (1 + Math.hypot(a[0] - b[0], a[1] - b[1]) ** 2);
    }
    const off = Math.max(...m.flatMap((row, i) => row.filter((_, j) => j !== i)));
    this.conn = m.map((row, i) => row.map((v, j) => (i === j ? 1 : v / off)));
  }

  resize() {
    const w = this.canvas.clientWidth || VW, h = this.canvas.clientHeight || VH;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uPR.value = this.renderer.getPixelRatio() * (h / VH);
  }

  bindDrag() {
    let drag = null;
    this.canvas.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY, this.spin, this.tilt]; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      this.spin = drag[2] + (e.clientX - drag[0]) * 0.008;
      this.tilt = Math.max(-0.9, Math.min(0.9, drag[3] + (e.clientY - drag[1]) * 0.006));
    });
    const end = () => (drag = null);
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    this.dragging = () => !!drag;
  }

  fire(key, amount) {
    this.act[key] = Math.min(1, this.act[key] + amount);
    this.synapses[key] += Math.round(amount * 97);
    const ri = REGIONS.findIndex((g) => g.key === key);
    const idx = this.regionIdx[ri];
    const k = Math.round(40 + amount * 900);
    for (let i = 0; i < k; i++) this.flash[idx[Math.floor(Math.random() * idx.length)]] = 0.6 + Math.random() * 0.4;
  }

  track(S) {
    const pile = Math.max(0, 1 - Math.min(1, S.melt) / 0.8);
    this.act.bud = this.act.bud * 0.9 + pile * 0.08;
    this.act.ember = Math.max(this.act.ember, S.mood * 0.6);
    this.act.munchie = Math.max(this.act.munchie, 0.5);
    this.act.paranoia = Math.max(this.act.paranoia, Math.min(1, S.kills.length / 8));
  }

  project(v) {
    const THREE = this.THREE;
    const p = new THREE.Vector3(...v).add(this.points.position);
    p.applyMatrix4(this.group.matrixWorld).project(this.camera);
    return [((p.x + 1) / 2) * VW, ((1 - p.y) / 2) * VH, p.z];
  }

  /** The side of a mirrored region that faces the camera, in viewBox pixels. */
  anchor(key) {
    const c = CENTERS[key];
    if (!c[2]) return this.project(c);
    const a = this.project([c[0], c[1], c[2]]), b = this.project([c[0], c[1], -c[2]]);
    return a[2] < b[2] ? a : b;
  }

  regionAt(x, y) {
    let best = null, bd = 150 * 150;
    for (const g of REGIONS) {
      const [ax, ay] = this.anchor(g.key);
      const d = (ax - x) ** 2 + (ay - y) ** 2;
      if (d < bd) { bd = d; best = g.key; }
    }
    return best;
  }

  draw(now) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.016;
    this.last = now;
    for (const k in this.act) this.act[k] = Math.max(0.08, this.act[k] - dt * 0.12);
    if (!this.visible) return;
    // idle firing: every region ticks over, the munchie nerve never stops
    if (!this.reduced) {
      for (const g of REGIONS) {
        const ri = REGIONS.indexOf(g);
        const idx = this.regionIdx[ri];
        const k = Math.round(dt * (40 + this.act[g.key] * 900));
        for (let i = 0; i < k; i++) this.flash[idx[Math.floor(Math.random() * idx.length)]] = 0.35 + Math.random() * 0.5 * this.act[g.key];
      }
      const decay = Math.exp(-dt * 3.2);
      const f = this.flash;
      for (let i = 0; i < this.n; i++) if (f[i] > 0.002) f[i] *= decay; else f[i] = 0;
      this.flashAttr.needsUpdate = true;
      if (!this.dragging()) this.spin += dt * 0.12;
    }
    for (let i = 0; i < 6; i++) {
      const want = !this.hover || REGIONS[i].key === this.hover ? 1 : 0.18;
      this.dim[i] += (want - this.dim[i]) * Math.min(1, dt * 8);
    }
    this.rot += (this.rotT - this.rot) * Math.min(1, dt * 6);
    this.group.rotation.set(this.tilt + this.rot, this.spin, 0);
    this.camera.position.z = 7.2 / this.zoom;
    this.group.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  stats(key) {
    const g = REGIONS.find((r) => r.key === key);
    const a = this.act[key];
    return { ...g, activity: a, synapses: this.synapses[key], hz: 4 + a * 38 + (key === "munchie" ? 12 : 0) };
  }
}
