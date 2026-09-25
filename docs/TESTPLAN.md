# Test plan

`npm test` runs every file in `test/` with `node --test`. Nothing needs the network: the real trade data is in `test/fixtures`.

## Fixtures

| file | what | captured |
|---|---|---|
| `sniffr.csv`, `sniffr.json` | 543 trades of SNIFFR on its bonding curve from launch, plus 6 raw curve logs | 2026-09-25 |
| `fomofied.csv`, `fomofied.json` | 554 trades of FOMOFIED after graduation, plus 6 raw v4 `Swap` logs | 2026-09-25 |

Each raw log carries `expectSide`, read independently from the token's `Transfer` event in the same transaction (tokens leaving the curve or the pool manager means a buy). Recapture with `node tools/capture-fixture.js 0xTOKEN name`.

## determinism.test.js

Why: the whole point is that every viewer and `replay.js` agree.

- the same hash at 1, 3, 17, 60 and 1,000 steps per frame
- the same hash with pseudo-random frame lengths of 1 to 400 steps
- the same hash when the catch-up budget runs out every 256 steps
- a restore from a snapshot taken at steps 1, 999, a third of the way and one before the end, then a replay to the end, equals the full replay
- two demo viewers who open the page 25 minutes apart in the same hour agree

## economy.test.js

Why: the scene has to be readable on real flow, not only on my synthetic streams.

- on SNIFFR and FOMOFIED he visits at least six stages, no stage takes 60% or more and the caps hold
- the size mapping is monotonic, zero under dust and 3 at most, and 10x the trade is less than 3x the size
- 8 trades every step never put more than the caps on screen
- one buy on a quiet token is exactly one joint of its own size
- a launch that pumps past 1,000x and retraces 47% on two-sided flow does not reach ARMED in three minutes
- only sells end at ARMED and only buys at CANDY
- steady buys against steady sells stop some buzzkills

## feed.test.js

Why: a lost trade can never be recovered in a shared log, and a late one would split viewers.

A fake node serves generated curve logs and v4 swaps with random latency (0 to 40 ms), advances its head by 1 to 40 blocks per call, hides the logs of its newest blocks and refuses any `eth_getLogs` over a limit.

- with the logs 3 blocks behind the head: every trade arrives and none arrives for a step already played
- control: with the logs 11 blocks behind the head (past the 5-block margin) trades are lost, so the first test can fail
- a graduation halfway through: curve trades, then pool swaps, none missed, the flag flips and pool trades carry no trader
- a refusal limit of 20 logs: the reader shrinks its range and still gets every trade
- sides decode the way the fake chain meant them
- a CSV round trip gives the same hash
- merging the same events twice changes nothing

## edge.test.js

Why: bad input must never produce NaN or a split.

- garbage events (side 0 or 2, NaN, negative, Infinity, 1e12 and 1e-12 amounts) leave the state finite
- an empty log idles in COLD with nothing on screen
- prices from 1e-12 to 1e12 stay finite
- 300,000 steps run and stay finite
- an event for a step already played is skipped
- a snapshot with one field nudged by 1e-9, or a NaN, is refused
- `srnd` stays in [0, 1) with no bias around 0.5 over 100,000 rolls, including seeds with the sign bit set
- `dlog2` matches `Math.log2` to 1e-12 from 1e-9 to 1e9
- `parseCsv` skips and counts malformed rows
- keccak and the v4 pool id match viem
- the real captured logs decode to the side their `Transfer` shows, with positive amounts and price
- curve trades carry a trader address from the event

## Outside `npm test`

- `node tools/profile.js`: render time per phase with 10 buzzkills, 8 joints, full room smoke, cold light and a flash every 20 frames. Fails above 4 ms at p95. Measured: p95 0.76 ms, median 0.62 ms (Node 22, Apple silicon laptop).
- In Chrome at 1440 x 900 the page drew a frame in 1.9 ms median and 2.6 ms max over 30 frames with the haze at 93%.
- At a device pixel ratio of 2 the canvas buffer stays 448 x 336, its CSS box is set explicitly (908 x 681 in a 1280 wide window) and the hash matched the 1x run.
- `node tools/rpc-check.js` measures the chain and the RPC, see [FEED.md](FEED.md).
