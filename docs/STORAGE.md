# Storage

Only collector mode stores anything. Direct and demo modes keep everything in the browser's memory.

## Layout

```
data/
  meta.json            what the client reads first
  state.json           the latest snapshot
  checkpoints.jsonl    every snapshot, one per line, newest last
  events/
    2026-09-25T15.csv  one shard per UTC hour of the trades' blocks
```

## meta.json

A real one, from the collector running on SNIFFR (the token record is shortened here):

```
{
  "schema": 1,
  "token": { "token": "0xf46a01a987529aed9f32bc03c553ef1e7ff2c32c", "curve": "0xdee62f6f9565a8117fb3f2d3048fe98b8a59f398", "symbol": "SNIFFR", ... },
  "genesisBlk": 72329678,
  "genesisTs": 1790349650000,
  "seed": 3763791468,
  "stepMs": 50,
  "safeBlk": 72355621,
  "safeStep": 51888,
  "updated": 1790352261760,
  "rows": 663,
  "shards": [
    { "file": "events/2026-09-25T15.csv", "lastStep": 45240, "rows": 652, "bytes": 92548 },
    { "file": "events/2026-09-25T16.csv", "lastStep": 51876, "rows": 11, "bytes": 1629 }
  ],
  "simStep": 51888,
  "simHash": "78ed02dd"
}
```

`safeBlk` is the last block fully read and `safeStep` the step clients must not pass. `simHash` is the collector's own hash at `simStep`.

It is written to a temporary file and renamed, so a reader never sees half of it.

## Shards

A shard is named after the UTC hour of its trades' blocks (estimated from the genesis block's timestamp at 101.4 ms a block). Rows are appended with the canonical order kept inside each append. A shard only ever grows.

## Snapshots

Every 6,000 steps (5 minutes) the collector writes the full sim state to `state.json` and appends it to `checkpoints.jsonl`. A restart replays from genesis and does not append a checkpoint it already has. `checkpoints.jsonl` is trimmed to the last 48 once it holds 96.

## What a client reads at start

1. `meta.json`: the token, genesis, seed, safe step and the shard list.
2. `state.json`: the latest snapshot. If it is missing or fails its own hash check, the client starts from genesis instead.
3. The shards whose `lastStep` is at or after the snapshot's step, in full.
4. It restores the snapshot, skips the events before its step and catches up to the safe step at 10 ms of work per frame.

Then every 2 s it re-reads `meta.json` and fetches only the tail of the last shard with `Range: bytes=<offset>-` and only when `meta.json` says the shard has grown past that offset. A shard it has not seen yet is fetched whole. The offset only moves past complete lines, so a half-written line is read again next time.
