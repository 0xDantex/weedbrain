# Deploy

## What to fill in

`src/weedbrain.config.json`:

| field | value |
|---|---|
| `name`, `ticker` | shown on the pages |
| `ca` | the token's contract address. Empty until launch: the landing page then says "not launched yet" and hides every buy link |
| `token` | the token the scene watches. At launch, the same address as `ca` |
| `mode` | `direct` or `collector`. An empty `token` is demo whatever this says |
| `quoteToEth` | for a token paired with something other than ETH (a stock token such as AMZN, a stablecoin): how much ETH one unit of the pair is worth. A fixed number, so the log and the hash stay reproducible. 1 for ETH pairs |
| `genesisBlock` | leave 0: the launch block is found on chain |
| `lookbackMin` | 0 for your own token. Only for watching a foreign token that has traded for a long time |
| `buyUrl` | `{token}` is replaced with the address |
| `dataUrl` | where `data/` is served, for collector mode |

The buy button on the live page only appears when `token` equals `ca`, so a token borrowed for testing never gets a buy link.

## Direct mode

Static hosting of `src/`, nothing else. Every viewer's browser reads the chain. Badge `LOCAL`.

```
tools/deploy.sh
```

It copies `src/` to a temporary folder and deploys that to the Vercel project linked in `.vercel/project.json`. Deploying the repository folder directly was blocked by Vercel because the commit author is not a member of the Vercel team. `vercel.json` marks the config as `no-cache`, so a config change shows up on the next page load.

Live now: https://weedbrain.lol (also https://weedbrain.vercel.app), watching COON (0x27a0d77264b4bb4bc46f435c63b1f8068cc833d3, paired with AMZN) from its launch.

## Collector mode

A machine that is on all the time runs `node ingest/ingest.js --token 0x...` (see [docs/RUNBOOK.md](docs/RUNBOOK.md)) and a web server serves `src/` and `data/` from the same origin, `data/` with `Cache-Control: no-cache` and `Range` support. Set `mode` to `collector`. Badge `SYNC`.

**Start the collector before the first trade of the token.** It can read the history back to genesis on its own, but the moment the site switches to collector mode every viewer reads only what the collector has written and the first trades set the high everything after them is measured against. Starting first is the simple way to be sure nothing depends on a catch-up.

## Launch order

1. Launch the token on Pons.
2. Put its address in `ca` and `token`.
3. If using the collector: start it, wait for its first `wrote ... rows` line.
4. Deploy.
5. Open `/weedbrain.html`, check the address in the header and that the first trades appear in the feed.
