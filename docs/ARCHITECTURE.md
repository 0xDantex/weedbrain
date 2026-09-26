# Architecture

## SIM and RENDER never touch

Everything that decides his fate lives in `src/engine.js`: the price and the high, the melt of the bud pile, the burning joints, the walking buzzkills, the mug, the mood and the stage. It does not draw and it does not know a canvas exists. It advances in fixed 50 ms steps and the only inputs are the genesis seed and the ordered event log.

Everything cosmetic lives in `src/render.js`: which frame of the stage's clip is on screen, the bud pile's bumpy outline, the smoke particles, the ember flicker, the lighter burst, the splash when the mug goes, buzzkills easing toward the positions the sim gives them. Randomness and the wall clock are allowed there, because nothing the renderer does flows back.

The scene is two stacked canvases of 1280 x 720. The lower one holds the character: one frame of the current stage's clip, drawn with `drawImage` only when the frame changes (most clips play forward and back with a hold at each end, SPILLED plays once and FIRING and BLAST loop). The upper one is the renderer's own `Uint32Array` pushed with a single `putImageData` per frame: the pile, the joints in it, the buzzkills, flashes and smoke, over a transparent background. The pile layer is rebuilt only when its height moves by a pixel and copied into the buffer with one `set` otherwise.

The sim talks to the renderer through `S.out`, a queue of plain records (`joint`, `flash`, `kill`, `repel`, `arrive`, `burnout`, `spill`, `refill`, `stage`, `trade`). The page drains it every frame. During a long catch-up nobody drains it for a while, so it is capped at 400 records and the oldest go first. An earlier version dropped the newest instead and the trade feed froze on old trades after a catch-up; I caught that on a screenshot and flipped it.

The same `engine.js` file is imported by the page, the collector, the command-line tools and the tests. There is no copy of the sim anywhere.

## The pages

`src/live.js` owns the config, the feed, the catch-up and the sim loop and reports through callbacks: progress, error, ready, every out record and every frame. `src/site.js` hangs everything visible on those callbacks: the scene renderer, the hero clip, the gauges, the tape, the trade cards, the counters from `src/stats.js` and the brain plate. Both HTML pages load the same script; the fullscreen page simply has fewer elements for it to fill.

The brain plate (`src/brain3d.js`) is a three.js point cloud. Its points are generated once from a fixed seed: about 60% of them in 420 bud-shaped lumps packed through the volume of two hemispheres, a cerebellum and a stem, the rest on the folded surface of those parts. Every point belongs to the nearest of six region centres. A chain event sets a burst of that region's points to flash, the flash decays each frame and the shader colours flashing points from ember to yellow. Hover dims every other region through a uniform. It never feeds the sim.

## The step

A step is 50 ms. The step of an event is `(block - genesis block) * 2`, because a block on this chain is about 101 ms (`tools/rpc-check.js` measured 0.1008 s per block over the last 1,000,000 blocks). The sim clock is therefore made of block numbers. No viewer's clock, time zone or frame rate enters it.

The page runs the sim to `min(safe step, live step - 60)`:

- the safe step is the first step of the first block the feed has not read yet. The sim never steps past it, so an event can never arrive for a step that has already been played.
- the live step is the chain head extrapolated at one block per 101.4 ms since the last poll. Holding 60 steps (3 s) behind it gives the feed time to land a trade before the scene reaches it.

If the page falls more than 200 steps behind (a slow device, a background tab) it goes back to the catch-up screen and replays with a budget of 10 ms per frame, then returns to the live scene.

## Hash randomness and the signed XOR trap

Every roll in the sim goes through `srnd(seed, step, purpose)`, a stateless integer hash. The purpose is part of the key, so adding a new roll somewhere never shifts any other roll. In JavaScript `^` returns a signed 32-bit integer; every XOR in the hash is closed with `>>> 0`. Without it the intermediate goes negative for about half the inputs and a check like `srnd(...) < 0.5` comes out the same way far too often. `test/edge.test.js` rolls 100,000 times and checks the share below 0.5 is within 1% of half and that seeds with the sign bit set still give values in [0, 1).

Which buzzkill walks in is taken from the transaction hash (its first 32 bits, plus the index when one sell spawns several), not from `srnd`. So the choice is visibly the chain's, not mine.

## Exact arithmetic only

The ECMAScript spec lets `Math.log`, `Math.exp` and `Math.pow` round differently in different engines. A hash that covers the exact bits of every float would split between Chrome and Safari on the first such difference. The sim therefore only uses `+ - * /` and comparisons, which IEEE 754 fixes. The size mapping needs a logarithm, so `dlog2` builds one from those operations (range reduction by halving, then the atanh series). It matches `Math.log2` to 1e-12 from 1e-9 to 1e9 (tested) and it gives the same bits everywhere because nothing in it is left to the engine.

## Hash and snapshots

`simHash` is FNV-1a over the exact bits of every number in the state (each float is fed as its two 32-bit halves) and every entity in flight. A snapshot stores all of those fields at full precision plus the hash. `restore` refuses a snapshot whose recomputed hash does not match and also any field that is not a finite number.

## Cold start

In direct mode the page resolves the token, reads its whole history from the genesis block and replays it. For GME with an hour of lookback the page went from open to the live scene in 2.8 s, including resolving the token and reading and replaying its trades. In collector mode it reads `state.json` and the shards after it, see [STORAGE.md](STORAGE.md).

## Credits

The SIM/RENDER split, the hash randomness, snapshots, the adaptive spawn threshold and the fresh-launch handling follow the design of savefly (github.com/bored2boar/savefly, MIT). `seedFromString` and `srnd` in `src/engine.js` are adapted from it. See [NOTICE.md](../NOTICE.md).
