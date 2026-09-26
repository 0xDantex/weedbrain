// Instrument counters that are not part of the sim: holders, trades in the
// last 24 hours and market cap. Display only, read in the background after
// the scene is live so they never slow the boot.
//
// Holders come from replaying the token's Transfer events from its launch
// block: the Blockscout API sits behind a Cloudflare challenge from this
// network and the Pons API allows 8 calls a minute, neither fits a counter
// every viewer refreshes.
import { getLogsChunked, readTrades, headBlock, ADDR, ZERO } from "./chain.js";
import { keccakText } from "./keccak.js";

const TRANSFER = keccakText("Transfer(address,address,uint256)");
const DAY_BLOCKS = 856514; // measured, see docs/FEED.md
const SUPPLY_SEL = keccakText("totalSupply()").slice(0, 10);
const addr = (t) => "0x" + t.slice(26).toLowerCase();

export class Stats {
  constructor(rpc, meta, onUpdate) {
    this.rpc = rpc;
    this.meta = meta;
    this.onUpdate = onUpdate;
    this.balances = new Map();
    this.holders = null;
    this.trades24 = null;
    this.tradeBlocks = [];
    this.supply = null;
    this.head = 0;
    this.infra = new Set([ZERO, meta.curve, ADDR.poolManager, meta.token]);
  }

  async start() {
    try {
      const s = await this.rpc.call("eth_call", [{ to: this.meta.token, data: SUPPLY_SEL }, "latest"]);
      this.supply = Number(BigInt(s)) / 10 ** this.meta.decimals;
    } catch { this.supply = 1e9; }
    this.onUpdate(this);
    const head = await headBlock(this.rpc);
    this.head = head;
    // trades in the last day, counted from the curve and pool logs
    const from = Math.max(this.meta.launchBlock || 0, head - DAY_BLOCKS);
    try {
      const t = await readTrades(this.rpc, this.meta, from, head);
      this.tradeBlocks = t.map((x) => x.blk);
      this.trades24 = this.tradeBlocks.length;
      this.countedTo = head;
      this.onUpdate(this);
    } catch { /* the counter stays empty */ }
    // holders, replayed from launch
    try {
      await this.transfers(this.meta.launchBlock || head - DAY_BLOCKS, head);
      this.onUpdate(this);
    } catch { /* the counter stays empty */ }
    this.scanned = head;
    setInterval(() => this.refresh(), 30000);
  }

  async transfers(from, to) {
    const { logs } = await getLogsChunked(this.rpc, { address: this.meta.token, topics: [TRANSFER] }, from, to, { chunk: 200000 });
    for (const l of logs) {
      const v = BigInt(l.data === "0x" ? 0 : l.data);
      const f = addr(l.topics[1]), t = addr(l.topics[2]);
      this.balances.set(f, (this.balances.get(f) || 0n) - v);
      this.balances.set(t, (this.balances.get(t) || 0n) + v);
    }
    let n = 0;
    for (const [a, b] of this.balances) if (b > 0n && !this.infra.has(a)) n++;
    this.holders = n;
  }

  async refresh() {
    try {
      const head = await headBlock(this.rpc);
      if (head > this.scanned) {
        await this.transfers(this.scanned + 1, head);
        this.scanned = head;
      }
      this.head = head;
      this.tradeBlocks = this.tradeBlocks.filter((b) => b > head - DAY_BLOCKS);
      this.trades24 = this.tradeBlocks.length;
      this.onUpdate(this);
    } catch { /* keep the last numbers */ }
  }

  /** New trades from the feed, so the 24 h count moves between refreshes. */
  addTrade(blk) {
    if (this.trades24 == null || blk <= this.countedTo) return;
    this.tradeBlocks.push(blk);
    this.trades24++;
  }

  mcapEth(px) {
    return this.supply && px > 0 ? px * this.supply : null;
  }
}
