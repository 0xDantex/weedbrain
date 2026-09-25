// Collector: reads the token's trades and writes the shared log that every
// viewer in collector mode reads, so all of them see one state.
//
//   node ingest/ingest.js --token 0xABC [--lookback MIN] [--genesis BLOCK] [--out data]
//
// Layout (see docs/STORAGE.md):
//   data/meta.json            token, genesis, seed, safe block, shard list
//   data/state.json           latest snapshot of the sim
//   data/checkpoints.jsonl    every snapshot, newest last
//   data/events/<UTC hour>.csv
//
// Only blocks at or below the last fully read block are ever written, so a
// client can never receive an event for a step it already played.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { genesis, runTo, simHash, snapshot } from "../src/engine.js";
import { LOG_HEADER, toCsvRow, parseCsv, eventOrder, eventKey } from "../src/feed.js";
import { RpcSource } from "./rpc-source.js";
import { parseArgs, loadConfig, ROOT, stateLine } from "../tools/common.js";

const args = parseArgs();
const site = loadConfig();
const ic = JSON.parse(readFileSync(join(ROOT, "ingest/config.json"), "utf8"));
const OUT = join(ROOT, args.out || ic.out);
const EV = join(OUT, "events");
mkdirSync(EV, { recursive: true });

const token = args.token || site.token;
if (!token) {
  console.error("usage: node ingest/ingest.js --token 0x... [--lookback MIN] [--genesis BLOCK]");
  process.exit(2);
}

function writeAtomic(path, text) {
  writeFileSync(path + ".tmp", text);
  renameSync(path + ".tmp", path);
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// resume only onto a log of the same token and genesis
let prev = null;
if (existsSync(join(OUT, "meta.json"))) {
  prev = JSON.parse(readFileSync(join(OUT, "meta.json"), "utf8"));
  if (prev.token.token !== token.toLowerCase()) {
    console.error(`data/ holds the log of ${prev.token.token}; move it away before collecting ${token}`);
    process.exit(1);
  }
}

const src = new RpcSource({
  ...site,
  token,
  pollMs: ic.pollMs,
  genesisBlock: prev ? prev.genesisBlk : Number(args.genesis ?? 0),
  lookbackMin: Number(args.lookback ?? site.lookbackMin ?? 0),
});
log(`reading ${token} ...`);
await src.init((p, x) => process.stdout.write(`\r${p} ${(x * 100).toFixed(0)}%   `));
process.stdout.write("\r");
log(`${src.meta.symbol} genesis block ${src.genesisBlk}, ${src.events.length} trades in history`);

// what is already on disk
const shards = new Map(); // file -> { file, lastStep, rows }
const onDisk = new Set();
for (const f of readdirSync(EV).filter((f) => f.endsWith(".csv")).sort()) {
  const { events } = parseCsv(readFileSync(join(EV, f), "utf8"));
  for (const e of events) onDisk.add(eventKey(e));
  shards.set(`events/${f}`, { file: `events/${f}`, lastStep: events.length ? events.at(-1).step : 0, rows: events.length, bytes: statSync(join(EV, f)).size });
}

function shardFor(e) {
  return "events/" + new Date(src.blockTime(e.blk)).toISOString().slice(0, 13) + ".csv";
}

function append(events) {
  const byFile = new Map();
  for (const e of events) {
    const k = eventKey(e);
    if (onDisk.has(k)) continue;
    onDisk.add(k);
    const f = shardFor(e);
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(e);
  }
  for (const [f, list] of byFile) {
    list.sort(eventOrder);
    const path = join(OUT, f);
    if (!existsSync(path)) writeFileSync(path, LOG_HEADER + "\n");
    appendFileSync(path, list.map(toCsvRow).join("\n") + "\n");
    const s = shards.get(f) || { file: f, lastStep: 0, rows: 0 };
    s.lastStep = Math.max(s.lastStep, list.at(-1).step);
    s.rows += list.length;
    s.bytes = statSync(path).size;
    shards.set(f, s);
  }
  return [...byFile.values()].reduce((a, l) => a + l.length, 0);
}

const S = genesis(src.seed);
let idx = 0;
let nextSnap = ic.snapshotSteps;
const CK = join(OUT, "checkpoints.jsonl");
let ckLines = existsSync(CK) ? readFileSync(CK, "utf8").split("\n").filter(Boolean) : [];
let lastCk = ckLines.length ? JSON.parse(ckLines.at(-1)).step : -1;

function writeMeta() {
  const m = {
    schema: 1,
    token: src.meta,
    genesisBlk: src.genesisBlk,
    genesisTs: src.genesisTs,
    seed: src.seed,
    stepMs: 50,
    safeBlk: src.safeBlk,
    safeStep: src.safeStep(),
    updated: Date.now(),
    rows: onDisk.size,
    shards: [...shards.values()].sort((a, b) => (a.file < b.file ? -1 : 1)),
    simStep: S.step,
    simHash: simHash(S),
  };
  writeAtomic(join(OUT, "meta.json"), JSON.stringify(m, null, 1));
}

function advance() {
  const target = src.safeStep();
  while (S.step < target) {
    const stop = Math.min(target, nextSnap);
    idx = runTo(S, src.events, idx, stop);
    S.out.length = 0;
    if (S.step === nextSnap) {
      const snap = JSON.stringify(snapshot(S));
      writeAtomic(join(OUT, "state.json"), snap);
      // a restart replays from genesis; checkpoints already on disk are not written twice
      if (S.step > lastCk) {
        ckLines.push(snap);
        if (ckLines.length > ic.keepCheckpoints * 2) {
          ckLines = ckLines.slice(-ic.keepCheckpoints);
          writeAtomic(CK, ckLines.join("\n") + "\n");
        } else {
          appendFileSync(CK, snap + "\n");
        }
        lastCk = S.step;
      }
      nextSnap += ic.snapshotSteps;
    }
  }
}

const added = append(src.events);
advance();
writeMeta();
log(`wrote ${added} new rows, ${shards.size} shards. ${stateLine(S)}`);

let last = 0;
for (;;) {
  const t0 = Date.now();
  const fresh = await src.poll();
  if (src.error) log(`poll failed: ${src.error.message}`);
  if (fresh.length) append(fresh);
  advance();
  writeMeta();
  if (fresh.length || Date.now() - last > 30000) {
    log(`+${fresh.length}  ${stateLine(S)}`);
    last = Date.now();
  }
  const wait = ic.pollMs - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
