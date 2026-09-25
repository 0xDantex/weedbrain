// Shared bits for the command-line tools.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STAGES, stageOf, burningLen, simHash, KILL_VARIANTS } from "../src/engine.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig() {
  return JSON.parse(readFileSync(join(ROOT, "src/weedbrain.config.json"), "utf8"));
}

/** --key value and --flag; the first bare 0x... argument is the token. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) out[k] = true;
      else { out[k] = v; i++; }
    } else out._.push(a);
  }
  if (!out.token && out._[0] && out._[0].startsWith("0x")) out.token = out._[0];
  return out;
}

/** 1234567 -> 1.23M */
export function fmtAmount(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  if (a >= 1) return n.toFixed(1);
  return n.toPrecision(2);
}

export function stateLine(S) {
  const st = STAGES[stageOf(S)];
  return [
    st.padEnd(11),
    `mood ${S.mood.toFixed(3)}`,
    `joints ${S.joints.length} (${burningLen(S).toFixed(2)})`,
    `buzzkills ${S.kills.length}`,
    `haze ${(Math.min(1, S.haze) * 100).toFixed(1)}%`,
    `repelled ${S.repelled}/${S.repelled + S.arrived}`,
    `hash ${simHash(S)} @${S.step}`,
  ].join("  ");
}

export function spawnText(rec) {
  return rec.spawned.length
    ? rec.spawned.map((s) => (s === "joint" ? "joint + flash" : "buzzkill")).join(", ")
    : "adds up (under the spawn threshold)";
}

export const variantName = (v) => KILL_VARIANTS[v] || "?";
