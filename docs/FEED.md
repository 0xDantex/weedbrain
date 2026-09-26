# Feed

## Event

```
step,side,eth,tok,px,blk,li,tx
```

| field | meaning |
|---|---|
| `step` | `(blk - genesis block) * 2` |
| `side` | +1 buy, -1 sell |
| `eth` | quote amount: `quoteIn` of a buy (fee and tax included, what the buyer paid), `quoteOut` of a sell, the quote leg of a v4 swap |
| `tok` | token amount |
| `px` | quote per token, net of fee and tax for curve buys |
| `blk`, `li` | block number and log index |
| `tx` | transaction hash |

## Canonical order

Step, then block, then log index, then transaction hash. The hash is the last tie-break, so the order is fixed without trusting the order the node returned. Events are deduplicated on `tx:li`.

## Reading Pons v2

- The factory `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e` answers `getLaunchedToken(token)`: the curve, the pair token, the pool fee and tick spacing. A token it does not know is not a Pons v2 token and the page says so.
- The launch block is found from the curve's `launchedAt()` and the `TokenLaunched` event around it.
- On the curve: `CurveBuy(buyer, recipient, quoteIn, tokensOut, fee, tax)` and `CurveSell(seller, recipient, tokensIn, quoteOut, fee, tax)`. The trader is `recipient` of a buy and `seller` of a sell. `tx.from` is not used: on this chain a relayer submits most transactions.
- After graduation: `Swap` on the v4 PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`, filtered by the pool id, which is `keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hook))` with native ETH as `address(0)`. The amounts are the swapper's balance change, so a positive token amount is a buy. I checked that against the token's `Transfer` events in the same transactions: the fixture logs of both SNIFFR (curve) and FOMOFIED (v4) decode to the side their `Transfer` shows (`test/edge.test.js`).
- There are no dependencies: `src/chain.js` does JSON-RPC with `fetch` and decodes by hand, `src/keccak.js` is a 32-bit keccak. Both are checked against viem in the tests.

## Two sources

**direct** (badge `LOCAL`). The browser reads the RPC. Each poll (1.5 s) asks for the head, reads `[last read + 1, head - 5]` and moves "last read" up. While the token is on its curve a poll reads only the curve's log and checks `graduated()` at that same block with a cheap `eth_call`. Not graduated at that block means there is no pool yet and nothing on it to miss. On the poll where it flips, both legs are read and after that only the pool.

**collector** (badge `SYNC`). `ingest/ingest.js` runs the same reader, writes what it reads to the shards and publishes `safeStep` in `meta.json`. Clients never go past it. See [STORAGE.md](STORAGE.md).

## The safety margin

A node could report a new head a moment before the logs of that block are queryable. A feed that read up to the head and marked it done would lose those trades for good. The feed stops 5 blocks (about half a second) behind the head. I measured the risk directly: 25 samples of the newest 9 blocks, re-read 5 s later, found 0 late logs in 225 blocks. The margin costs half a second and `test/feed.test.js` shows it is enough for a node that lags 3 blocks, while a control run lagging 11 blocks does lose trades.

## Measured on this chain

`tools/rpc-check.js`, 2026-09-26:

| what | measured |
|---|---|
| block time | 0.1009 s over the last 1,000,000 blocks, 856,514 blocks a day |
| `eth_getLogs` latency, 600 blocks of chain-wide curve events | 173 to 1,056 ms over 8 calls |
| chain-wide curve trades | 3,633 in 6,000 blocks, about 518,600 a day at that rate |
| v4 swaps chain-wide over 6,000 blocks | refused: "logs matched by query exceeds limit of 10000" |
| graduations | 76 `PoolGraduated` events in 800,000 blocks (about 22 hours) |

The public RPC answers `429` to bursts: 40 parallel `eth_getLogs` calls from one machine got 7 answers and 33 refusals. In a browser a refused answer sometimes arrives with the CORS header doubled (`*, *`) and shows up as a network error. The client keeps at most 2 calls in flight, spaces `eth_getLogs` 150 ms apart and retries with backoff and the refusals it still sees heal on the next poll.

A range that would return more than 10,000 logs is refused; the reader then quarters the range (down to 200 blocks) and doubles it back after each clean read.
