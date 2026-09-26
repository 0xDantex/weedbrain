// Frame budget under the worst scene: a full bud pile, ten buzzkills wading
// in, eight joints smoking, lighter flashes going off. Prints the time of
// each render phase over 600 frames.
//   node tools/profile.js
import { Renderer, RW, RH } from "../src/render.js";
import { genesis, SIM } from "../src/engine.js";

const ctx2d = () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  putImageData() {},
  drawImage() {},
  fillRect() {},
  clearRect() {},
});
const canvas = () => { const c = ctx2d(); return { width: 0, height: 0, getContext: () => c }; };
const frames = new Map(Array.from({ length: 50 }, (_, i) => [i + 1, { complete: true, naturalWidth: 672, naturalHeight: 720 }]));
const buds = { data: new Uint8ClampedArray(RW * 260 * 4).map((_, i) => (i * 2654435761) >>> 24), width: RW, height: 260 };
const r = new Renderer(canvas(), canvas(), frames, buds, { reducedMotion: false });

const S = genesis(1);
S.high = 0.95;
S.melt = 0;
S.mood = 0.05;
S.stage = 0;
for (let i = 0; i < SIM.JOINT_CAP; i++) S.joints.push({ id: 100 + i, len: 3.5, full: 3.5, born: 0 });
for (let i = 0; i < SIM.KILL_CAP; i++) S.kills.push({ id: 200 + i, side: i % 2 ? 1 : -1, variant: i % 4, x: 0.1 + i * 0.08, size: i % 3 ? 1 : 2, hp: 3, sp: 0.001, born: 0 });
r.syncEntities(S);

const keys = ["art", "pile", "sprites", "present", "total"];
const samples = Object.fromEntries(keys.map((k) => [k, []]));
let now = 1000;
for (let f = 0; f < 600; f++) {
  if (f % 20 === 0) r.handle({ t: "flash", target: 200 + ((f / 20) % 10), size: 2 }, true);
  // the pile moves a little every frame, so it is rebuilt every frame: the worst case
  S.melt = (f % 60) / 600;
  now += 16.7;
  const t = r.draw(S, now);
  if (f >= 60) for (const k of keys) samples[k].push(t[k]);
}
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
console.log(`scene ${RW}x${RH}, ${S.kills.length} buzzkills, ${S.joints.length} joints, ${r.parts.length} particles alive, pile rebuilt every frame`);
console.log("phase      median    p95     max   (ms)");
for (const k of keys) console.log(`${k.padEnd(9)} ${q(samples[k], 0.5).toFixed(3).padStart(7)} ${q(samples[k], 0.95).toFixed(3).padStart(7)} ${Math.max(...samples[k]).toFixed(3).padStart(7)}`);
const p95 = q(samples.total, 0.95);
console.log(p95 < 4 ? `within the 4 ms budget (p95 ${p95.toFixed(2)} ms)` : `OVER the 4 ms budget (p95 ${p95.toFixed(2)} ms)`);
process.exit(p95 < 4 ? 0 : 1);
