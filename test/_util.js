import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../src/feed.js";
import { genesis, applyEvent, simStep } from "../src/engine.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function fixture(name) {
  const { events } = parseCsv(readFileSync(join(DIR, `${name}.csv`), "utf8"));
  const extra = JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8"));
  return { events, ...extra };
}

/** Step-by-step run that calls fn(S) after every step. */
export function walk(events, seed, steps, fn) {
  const S = genesis(seed);
  let i = 0;
  for (let s = 0; s < steps; s++) {
    while (i < events.length && events[i].step <= S.step) {
      if (events[i].step === S.step) applyEvent(S, events[i]);
      i++;
    }
    simStep(S);
    S.out.length = 0;
    if (fn) fn(S);
  }
  return S;
}

/** A synthetic event at a step. */
let n = 0;
export function ev(step, side, eth, px = 1e-8) {
  n++;
  return { step, side, eth, tok: eth / px, px, blk: step >> 1, li: n, tx: "0x" + n.toString(16).padStart(64, "0") };
}
