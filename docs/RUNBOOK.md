# Runbook

## Start the collector

```
node ingest/ingest.js --token 0xTOKEN
```

It resolves the token, reads its history from the genesis block (the launch block, or `--lookback MIN` / `--genesis BLOCK` for a foreign token), writes `data/` and then polls every 2 s. It logs one line per poll with new trades and a state line every 30 s:

```
15:43:04 +1  SUIT ON     mood 0.605  joints 8 (17.53)  buzzkills 9  pile 2%  mug spilled  repelled 28/60  hash e7b273bb @12268
```

To keep it running on a Mac, a launchd agent with `KeepAlive` pointing at `node ingest/ingest.js --token 0x...` in the repository folder is enough. On Linux, a systemd service with `Restart=always`.

By design the collector for one token makes one `eth_blockNumber`, one `eth_call` and one `eth_getLogs` every 2 s. Restarted onto an existing `data/` holding 538 rows, it read the history once and wrote 0 new rows, as it should. Left running across 16:00 UTC it opened the next hourly shard on its own.

## Serve collector data

`npm run serve -- --mode collector` serves `src/` and `data/` together. Any static host works as long as it serves `data/` with `Cache-Control: no-cache` and honours `Range` requests.

## When something breaks

| symptom | cause | fix |
|---|---|---|
| the page shows "RPC not answering" | the public RPC is refusing or down | nothing to do, the page retries every poll and keeps the last state on screen |
| `poll failed: RPC answered HTTP 429` in the collector log | too many calls from this IP | it backs off on its own. If it keeps going, stop other scripts hitting the same RPC from that machine |
| `data/ holds the log of 0x...` and the collector exits | `data/` belongs to another token | move `data/` away, then start again |
| a client's hash differs from `replay.js` at the same step | a bug, or a client reading a different log | run `node tools/replay.js --log data/events --to STEP` and compare with `simHash` in `meta.json` |
| the collector was down for a while | nothing is lost | on restart it reads everything from the last block it wrote. RPC history is complete back to genesis |
| "NOT A PONS TOKEN" on the page | the configured address is not a Pons v2 token | fix `token` in `src/weedbrain.config.json` |
