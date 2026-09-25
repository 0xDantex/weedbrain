// The collector's view of the chain: the same reader the page uses in
// direct mode, plus block timestamps for naming the hourly shards.
import { DirectFeed } from "../src/feed.js";
import { CHAIN } from "../src/chain.js";

export class RpcSource extends DirectFeed {
  async init(onProgress) {
    await super.init(onProgress);
    const b = await this.rpc.call("eth_getBlockByNumber", ["0x" + this.genesisBlk.toString(16), false]);
    this.genesisTs = Number(BigInt(b.timestamp)) * 1000;
    return this;
  }

  /** Estimated wall time of a block; only used to pick the shard an event lands in. */
  blockTime(blk) {
    return this.genesisTs + (blk - this.genesisBlk) * CHAIN.blockMs;
  }
}
