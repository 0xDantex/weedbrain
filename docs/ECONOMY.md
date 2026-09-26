# Economy

All constants live in `SIM` at the top of `src/engine.js`. The numbers below come from `tools/economy.js` on two real trade logs captured with `tools/capture-fixture.js` on 2026-09-25:

| log | venue | trades | length | trade size ETH (p10 / median / p90 / max) |
|---|---|---|---|---|
| SNIFFR | bonding curve | 543 (320 buys) | 25.1 min from launch | 0.0017 / 0.0241 / 0.1000 / 0.2767 |
| FOMOFIED | v4 pool after graduation | 554 (353 buys) | 34.7 min | 0.0008 / 0.0064 / 0.0623 / 0.3459 |

## Size

```
size = clamp(log2(1 + q / SIZE_REF) * SIZE_K + 0.22, 0.2, 3)     q >= DUST, else 0
```

| constant | value | why |
|---|---|---|
| `SIZE_REF` | 0.01 ETH | the medians of the two logs are 0.0064 and 0.0241, so a median trade lands near size 1 |
| `SIZE_K` | 0.72 | a 10x bigger trade is less than 3x bigger on screen (tested), so a whale reads as big without swallowing the room |
| `DUST` | 0.0003 ETH | below the p10 of both logs: only true dust moves the price without spawning anything |

The mapping is logarithmic because trade sizes span orders of magnitude: 0.0008 to 0.3459 ETH inside one 35-minute log.

## Spawning: adaptive threshold

A buy or sell adds its quote amount to an accumulator for its side. An entity spawns each time the accumulator crosses

```
threshold = max(SIZE_REF, flow * SPAWN_STEPS)
```

where `flow` is an exponential average of volume per step (`FLOW_EMA` 0.02) and `SPAWN_STEPS` is 24. One event spawns at most `SPAWN_MAX` (6) entities.

On a quiet token `flow * SPAWN_STEPS` stays under `SIZE_REF * 1.5` and then every buy is one joint of its own size and every sell one buzzkill (tested: one 0.02 ETH buy gives exactly one joint of `sizeOf(0.02)`). On a busy token the threshold rises with the flow, small trades pile up and one entity stands for the pile. On SNIFFR that turned 320 buys into 112 joints and 223 sells into 144 buzzkills. A synthetic token with 8 trades every step (about 9,600 a minute) never had more than the caps on screen.

Trades under the threshold show "adds up" in the feed: they are real and counted, they just went into the next entity.

## Joints

| constant | value | meaning |
|---|---|---|
| `JOINT_CAP` | 8 | more than this and the new length goes into the shortest joint |
| `JOINT_MAX` | 4 | the longest a merged joint gets |
| `BURN` | 1/900 per step | a size-1 joint burns 45 s |

Both logs peaked at 8 joints in the pile.

## Buzzkills and the lighter

A buzzkill walks in from a side picked by `srnd` at speed `(0.0009 + 0.0012 / max(0.6, size)) * KILL_SPD`, so a size-0.3 one crosses in about 17 s, a size-1 one in 24 s and a size-3 one in 38 s. `KILL_CAP` is 10; past it a sell grows the biggest one instead of adding one. Both logs peaked at 10.

When one reaches him it puts out his longest joint, two if its size is at least `BIG_KILL` (1.6) and adds `DOUSE_DEBT * (0.55 + 0.45 * min(3, size) / 3)` to the debt.

Every buy that spawns a joint also fires the lighter at the nearest buzzkill: it is pushed back by `PUSH * size` (0.32) and loses `HIT * size` (1.4) of its `2.2 * size` hit points. At zero it runs off. On SNIFFR 67 were stopped and 73 got through; on FOMOFIED 63 and 111.

## The pile

```
drop   = clamp(1 - px / high, 0, 1), capped at DD_CAP (0.88)
drop  *= 0.25 + 0.75 * min(1, step / BIRTH_GRACE)
melt  -> melt + (drop + debt - melt) * 0.06 every step
debt  *= DEBT_HEAL (0.99955) every step, a half-life of about 77 s
pile   = 1 - min(1, melt) / 0.8
```

At the high the pile reaches his waist (250 px of the 720 px scene at the centre, half that at the edges). At 80% melt it is gone and he lies on bare ground.

## Fresh launch

A memecoin in its first minutes can run thousands of times its first price and then give back half. Measured against the first trade, a high like that would melt the pile to nothing minutes after launch for a normal retrace. Three things stop it:

- the high only moves on closed one-minute bars (`BAR_STEPS` 1200), not on single trades
- it grows at most 4x per bar (`ATH_MAX_STEP`) and a run of rising bars loosens that by 3x per bar (`ATH_RUN_BOOST`)
- the drawdown counts at 25% at genesis and ramps to full weight over 15 minutes (`BIRTH_GRACE` 18,000 steps)

`test/economy.test.js` runs a launch that pumps past 1,000x in its first minute and retraces 47% over the next two on two-sided flow: he does not reach BLAST within the first three minutes.

## Mood and the mug

```
high  = burning / (burning + HIGH_REF)          HIGH_REF 1.5
mood -> (1 - high) * 0.25 + melt * 0.75, at most MOOD_RATE (1/600) per step
stage = floor(mood * 10), with 0.015 of hysteresis
```

A full pile with the room full of joints is SHADES OFF (0). Nothing burning and nothing melted is THE MUG (2): sober, reaching for a drink. Nothing burning on bare ground is BLAST (9).

The mug splits that line in two:

| rule | constant |
|---|---|
| while the mug is up the mood cannot reach SPILLED | stage 3 starts at mood 0.3 |
| a sell of at least `max(SPILL_ETH, flow * SPAWN_STEPS * SPILL_FLOW)` knocks it over | 0.1 ETH, 5 |
| a fresh mug cannot be knocked over by a sell for `MUG_SAFE` steps | 3,600 (3 min) |
| the mood wanting past THE MUG for `SPILL_BOIL` steps tips it over too | 600 (30 s) |
| a spill shows SPILLED for `SPILL_HOLD` steps, then he lands two stages below where he was | 40 (2 s) |
| while the mug is down the mood cannot go back above SPILLED | |
| wanting back above SPILLED for `REFILL_STEPS` brings a fresh mug | 200 (10 s) |

The boil rule is there because a token can bleed on nothing but small sells. Without it he would sit at THE MUG through a 90% dump.

I tuned these on the two real logs. The first try (a spill at 0.045 ETH, no grace for a fresh mug, a refill only after a deep high) left him in SPILLED 42% and 46% of the time. The numbers now, from `tools/economy.js`:

| | SNIFFR | FOMOFIED |
|---|---|---|
| spills | 4 (2 by a big sell, 2 boiled over) | 8 (3 by a big sell, 5 boiled over) |
| fresh mugs | 3 | 7 |
| SHADES OFF | 12.9% | 8.6% |
| EYES HEAVY | 3.6% | 12.8% |
| THE MUG | 27.0% | 36.8% |
| SPILLED | 8.1% | 18.0% |
| SOAKED | 19.8% | 9.1% |
| FISTS | 9.4% | 7.7% |
| SUIT ON | 3.3% | 5.0% |
| AIMING | 1.7% | 1.9% |
| FIRING | 7.2% | 0.0% |
| BLAST | 7.1% | 0.0% |

FOMOFIED never hit the bottom in its 35 minutes. SNIFFR launched, pumped and dumped inside its 25 and went through all ten.
