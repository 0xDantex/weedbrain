// Frame budget under the worst scene: ten buzzkills on the floor, eight
// joints smoking, room smoke at full and cold light mixed in, flashes going
// off. Prints the time of each render phase over 600 frames.
//   node tools/profile.js
import { Renderer, SCENE } from "../src/render.js";
import { genesis, SIM } from "../src/engine.js";

const ctx = {
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  putImageData() {},
};
const canvas = { width: 0, height: 0, getContext: () => ctx };
const frames = Array.from({ length: 50 }, (_, i) => new Uint32Array(252 * 316).map((_, p) => (0xff000000 | (p * 2654435761 + i)) >>> 0));
const r = new Renderer(canvas, frames, { reducedMotion: false });

const S = genesis(1);
S.high = 0.95;
S.haze = 0.3;
S.mood = 0.2;
for (let i = 0; i < SIM.JOINT_CAP; i++) S.joints.push({ id: 100 + i, len: 3.5, full: 3.5, born: 0 });
for (let i = 0; i < SIM.KILL_CAP; i++) S.kills.push({ id: 200 + i, side: i % 2 ? 1 : -1, variant: i % 4, x: 0.1 + i * 0.08, size: i % 3 ? 1 : 2, hp: 3, sp: 0.001, born: 0 });
r.syncEntities(S);

const keys = ["room", "reaper", "sprites", "grade", "present", "total"];
const samples = Object.fromEntries(keys.map((k) => [k, []]));
let now = 1000;
for (let f = 0; f < 600; f++) {
  if (f % 20 === 0) r.handle({ t: "flash", target: 200 + (f / 20) % 10, size: 2 }, true);
  now += 16.7;
  const t = r.draw(S, now);
  if (f >= 60) for (const k of keys) samples[k].push(t[k]);
}
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
console.log(`scene ${SCENE.RW}x${SCENE.RH}, ${S.kills.length} buzzkills, ${S.joints.length} joints, ${r.parts.length} particles alive`);
console.log("phase      median    p95     max   (ms)");
for (const k of keys) console.log(`${k.padEnd(9)} ${q(samples[k], 0.5).toFixed(3).padStart(7)} ${q(samples[k], 0.95).toFixed(3).padStart(7)} ${Math.max(...samples[k]).toFixed(3).padStart(7)}`);
const p95 = q(samples.total, 0.95);
console.log(p95 < 4 ? `within the 4 ms budget (p95 ${p95.toFixed(2)} ms)` : `OVER the 4 ms budget (p95 ${p95.toFixed(2)} ms)`);
process.exit(p95 < 4 ? 0 : 1);
