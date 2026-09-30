// Pons v2 on Robinhood Chain, read straight from the public RPC.
// No dependencies: plain JSON-RPC over fetch plus hand decoding, so the same
// file runs in the browser (direct mode) and in Node (watch, ingest, tests).

import { keccakText, keccak256 } from "./keccak.js";

export const CHAIN = {
  id: 4663,
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  blockscout: "https://robinhoodchain.blockscout.com",
  // measured 0.1014-0.1017 s per block across 1M blocks
  blockMs: 101.4,
};

export const ADDR = {
  factory: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  hook: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044",
  weth: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
};

export const ZERO = "0x0000000000000000000000000000000000000000";

export const TOPIC = {
  buy: keccakText("CurveBuy(address,address,uint256,uint256,uint256,uint256)"),
  sell: keccakText("CurveSell(address,address,uint256,uint256,uint256,uint256)"),
  swap: keccakText("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"),
  launched: keccakText("TokenLaunched(address,address,address,address,uint256,uint256)"),
  transfer: keccakText("Transfer(address,address,uint256)"),
};

const sel = (sig) => keccakText(sig).slice(0, 10);
const SEL = {
  getLaunchedToken: sel("getLaunchedToken(address)"),
  graduated: sel("graduated()"),
  launchedAt: sel("launchedAt()"),
  symbol: sel("symbol()"),
  decimals: sel("decimals()"),
  name: sel("name()"),
};

export class ChainError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const txUrl = (tx) => `${CHAIN.blockscout}/tx/${tx}`;
export const isAddress = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * JSON-RPC client with the manners the official node asks for: eth_getLogs
 * calls are spaced apart, 429/5xx back off exponentially and the "too many
 * logs" refusal surfaces as code "too-many" so callers can shrink the range.
 */
export function makeRpc(url = CHAIN.rpc, { logsSpacingMs = 150, retries = 6, maxInFlight = 2, fetchImpl } = {}) {
  const f = fetchImpl || globalThis.fetch.bind(globalThis);
  let lastLogs = 0;
  let id = 0;
  const stats = { calls: 0, logsCalls: 0, retries: 0, lastMs: 0 };
  // Bursts of parallel calls get rate-limited and in a browser that answer
  // arrives with a doubled CORS header and looks like a network failure.
  let inFlight = 0;
  const queue = [];
  const acquire = () => (inFlight < maxInFlight ? (inFlight++, Promise.resolve()) : new Promise((r) => queue.push(r)));
  const release = () => (queue.length ? queue.shift()() : inFlight--);
  async function call(method, params) {
    await acquire();
    try {
      return await callOnce(method, params);
    } finally {
      release();
    }
  }
  async function callOnce(method, params) {
    if (method === "eth_getLogs") {
      const wait = lastLogs + logsSpacingMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastLogs = Date.now();
      stats.logsCalls++;
    }
    stats.calls++;
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      let res, body;
      try {
        res = await f(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        });
        body = await res.text();
      } catch (e) {
        if (attempt >= retries) throw new ChainError("network", `RPC unreachable: ${e.message}`);
        stats.retries++;
        await sleep(400 * 2 ** attempt);
        continue;
      }
      stats.lastMs = Date.now() - t0;
      if (res.status === 429 || res.status >= 500 || res.status === 403) {
        if (attempt >= retries) throw new ChainError("rate", `RPC answered HTTP ${res.status}`);
        stats.retries++;
        await sleep(Math.min(15000, 500 * 2 ** attempt));
        continue;
      }
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        if (attempt >= retries) throw new ChainError("network", "RPC answered with a non-JSON body");
        stats.retries++;
        await sleep(500);
        continue;
      }
      if (json.error) {
        const msg = String(json.error.message || "");
        // a range too heavy for the node comes back as a refusal or as a timeout
        if (/exceeds limit|Missing or invalid parameters|query returned more than|timed out|timeout|deadline|narrow the block range|are allowed for this request/i.test(msg)) {
          throw new ChainError("too-many", msg);
        }
        if (json.error.code === 429 && attempt < retries) {
          stats.retries++;
          await sleep(Math.min(15000, 500 * 2 ** attempt));
          continue;
        }
        throw new ChainError("rpc", msg);
      }
      return json.result;
    }
  }
  return { call, stats, url };
}

// ---- ABI helpers ---------------------------------------------------------

const word = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const uint = (data, i) => BigInt("0x" + word(data, i));
const int = (data, i) => BigInt.asIntN(256, uint(data, i));
const addrWord = (data, i) => "0x" + word(data, i).slice(24);
const topicAddr = (t) => "0x" + t.slice(26).toLowerCase();
const pad32 = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const hexNum = (n) => "0x" + n.toString(16);

function decodeString(data) {
  if (!data || data === "0x") return "";
  const off = Number(uint(data, 0)) / 32;
  const len = Number(uint(data, off));
  const hex = data.slice(2 + (off + 1) * 64, 2 + (off + 1) * 64 + len * 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return new TextDecoder().decode(bytes);
}

/** Token amounts as floats in whole units. Precision past 1e-15 relative is not needed here. */
export function toUnits(raw, decimals) {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = Number(v / base);
  const frac = Number(v % base) / Number(base);
  return (neg ? -1 : 1) * (whole + frac);
}

async function ethCall(rpc, to, data) {
  return rpc.call("eth_call", [{ to, data }, "latest"]);
}

/** v4 pool id for the token's pool: keccak of the abi-encoded sorted PoolKey. */
export function poolIdFor(token, pairToken, fee, tickSpacing) {
  const a = token.toLowerCase();
  const b = pairToken.toLowerCase();
  const [c0, c1] = a < b ? [a, b] : [b, a];
  const ts = BigInt.asUintN(256, BigInt(tickSpacing));
  return keccak256(
    "0x" + pad32(c0) + pad32(c1) + pad32(BigInt(fee).toString(16)) + pad32(ts.toString(16)) + pad32(ADDR.hook),
  );
}

// ---- token resolution ----------------------------------------------------

/**
 * Everything the feed needs about one Pons v2 token. Throws ChainError with
 * code "bad-address" or "not-pons" when the address cannot be watched.
 */
export async function resolveToken(rpc, token, { findLaunch = true } = {}) {
  if (!isAddress(token)) {
    throw new ChainError("bad-address", "This is not an address. A token address is 0x followed by 40 hex characters.");
  }
  token = token.toLowerCase();
  const rec = await ethCall(rpc, ADDR.factory, SEL.getLaunchedToken + pad32(token));
  // struct LaunchedToken: token, curve, deployer, creatorFeeRecipient, pairToken,
  // graduationThreshold, poolFee, tickSpacing, creatorTaxBps, buybackEnabled,
  // phase, sweptQuote, sweptTokens, sweptAt, exists
  const exists = rec && rec.length >= 2 + 15 * 64 && uint(rec, 14) === 1n;
  if (!exists) {
    const code = await rpc.call("eth_getCode", [token, "latest"]);
    const what = code && code !== "0x" ? "a contract, but not a token launched on Pons v2" : "not a contract on Robinhood Chain";
    throw new ChainError("not-pons", `${token} is ${what}. Paste the token address from its Pons page.`);
  }
  const curve = addrWord(rec, 1).toLowerCase();
  const pairToken = addrWord(rec, 4).toLowerCase();
  const poolFee = Number(uint(rec, 6));
  const tickSpacing = Number(int(rec, 7));
  const phase = Number(uint(rec, 10));

  const [symRaw, decRaw, nameRaw, gradRaw, launchedRaw] = await Promise.all([
    ethCall(rpc, token, SEL.symbol).catch(() => "0x"),
    ethCall(rpc, token, SEL.decimals).catch(() => "0x"),
    ethCall(rpc, token, SEL.name).catch(() => "0x"),
    ethCall(rpc, curve, SEL.graduated).catch(() => "0x"),
    ethCall(rpc, curve, SEL.launchedAt).catch(() => "0x"),
  ]);
  const meta = {
    token,
    curve,
    pairToken,
    pairIsEth: pairToken === ZERO || pairToken === ADDR.weth,
    poolFee,
    tickSpacing,
    poolId: poolIdFor(token, pairToken, poolFee, tickSpacing),
    symbol: decodeString(symRaw) || "TOKEN",
    name: decodeString(nameRaw) || "",
    decimals: decRaw && decRaw !== "0x" ? Number(uint(decRaw, 0)) : 18,
    pairSymbol: "ETH",
    pairDecimals: 18,
    graduated: (gradRaw && gradRaw !== "0x" && uint(gradRaw, 0) === 1n) || phase === 2,
    launchedAt: launchedRaw && launchedRaw !== "0x" ? Number(uint(launchedRaw, 0)) : 0,
    launchBlock: 0,
  };
  if (!meta.pairIsEth) {
    const [ps, pd] = await Promise.all([
      ethCall(rpc, pairToken, SEL.symbol).catch(() => "0x"),
      ethCall(rpc, pairToken, SEL.decimals).catch(() => "0x"),
    ]);
    meta.pairSymbol = decodeString(ps) || "QUOTE";
    meta.pairDecimals = pd && pd !== "0x" ? Number(uint(pd, 0)) : 18;
  }
  if (findLaunch && meta.launchedAt) meta.launchBlock = await findLaunchBlock(rpc, meta);
  return meta;
}

export async function headBlock(rpc) {
  return Number(BigInt(await rpc.call("eth_blockNumber", [])));
}

async function blockTs(rpc, n) {
  const b = await rpc.call("eth_getBlockByNumber", [hexNum(n), false]);
  return b ? Number(BigInt(b.timestamp)) : 0;
}

/** Exact launch block: estimate from launchedAt, then read TokenLaunched around it. */
export async function findLaunchBlock(rpc, meta) {
  const head = await headBlock(rpc);
  const headTs = await blockTs(rpc, head);
  let est = head - Math.round(((headTs - meta.launchedAt) * 1000) / CHAIN.blockMs);
  for (let i = 0; i < 3; i++) {
    const ts = await blockTs(rpc, Math.max(1, est));
    const drift = Math.round(((ts - meta.launchedAt) * 1000) / CHAIN.blockMs);
    if (Math.abs(drift) < 50) break;
    est -= drift;
  }
  const from = Math.max(1, est - 3000);
  const to = Math.min(head, est + 3000);
  const logs = await rpc.call("eth_getLogs", [
    { address: ADDR.factory, fromBlock: hexNum(from), toBlock: hexNum(to), topics: [TOPIC.launched, "0x" + pad32(meta.token)] },
  ]);
  if (logs && logs.length) return Number(BigInt(logs[0].blockNumber));
  return Math.max(1, est);
}

// ---- trades --------------------------------------------------------------

/**
 * Turn raw logs into trades. Curve events carry the trader in their fields
 * (recipient of a buy, seller of a sell) because on this chain a relayer
 * submits most transactions and tx.from is infrastructure. A v4 Swap only
 * names the router, so graduated trades carry no trader.
 *
 * v4 Swap amounts are the swapper's balance delta: positive means the
 * swapper received that currency. Token delta > 0 is a buy.
 */
export function decodeTrades(meta, logs) {
  const out = [];
  for (const l of logs) {
    const t0 = l.topics[0];
    const blk = Number(BigInt(l.blockNumber));
    const li = Number(BigInt(l.logIndex));
    const tx = l.transactionHash.toLowerCase();
    let side, quote, tok, net, trader = "";
    if (t0 === TOPIC.buy && l.address.toLowerCase() === meta.curve) {
      const quoteIn = uint(l.data, 0), tokensOut = uint(l.data, 1), fee = uint(l.data, 2), tax = uint(l.data, 3);
      side = 1;
      quote = quoteIn;
      net = quoteIn - fee - tax > 0n ? quoteIn - fee - tax : quoteIn;
      tok = tokensOut;
      trader = topicAddr(l.topics[2]);
    } else if (t0 === TOPIC.sell && l.address.toLowerCase() === meta.curve) {
      const tokensIn = uint(l.data, 0), quoteOut = uint(l.data, 1);
      side = -1;
      quote = quoteOut;
      net = quoteOut;
      tok = tokensIn;
      trader = topicAddr(l.topics[1]);
    } else if (t0 === TOPIC.swap && l.topics[1] && l.topics[1].toLowerCase() === meta.poolId) {
      const a0 = int(l.data, 0), a1 = int(l.data, 1);
      const tokenIsC0 = meta.token < meta.pairToken;
      const dTok = tokenIsC0 ? a0 : a1;
      const dQuote = tokenIsC0 ? a1 : a0;
      if (dTok === 0n) continue;
      side = dTok > 0n ? 1 : -1;
      tok = dTok < 0n ? -dTok : dTok;
      quote = dQuote < 0n ? -dQuote : dQuote;
      net = quote;
    } else {
      continue;
    }
    const q = toUnits(quote, meta.pairDecimals);
    const t = toUnits(tok, meta.decimals);
    const pxNet = toUnits(net, meta.pairDecimals);
    out.push({ blk, li, tx, side, quote: q, tok: t, px: t > 0 ? pxNet / t : 0, trader });
  }
  out.sort(tradeOrder);
  return out;
}

/** Canonical order: block, then log index, then tx hash as the last tie-break. */
export function tradeOrder(a, b) {
  return a.blk - b.blk || a.li - b.li || (a.tx < b.tx ? -1 : a.tx > b.tx ? 1 : 0);
}

// the public node allows at most 100,000 blocks per log query (since 2026-09-30)
const MAX_CHUNK = 100_000;
const MIN_CHUNK = 200;

/**
 * Read one log filter over [from, to] in adaptive chunks. The node refuses a
 * range whose result tops 10,000 logs, so a refusal quarters the chunk and
 * each clean read doubles it back.
 */
export async function getLogsChunked(rpc, filter, from, to, { chunk = MAX_CHUNK, onProgress } = {}) {
  const logs = [];
  let start = from;
  let fails = 0;
  while (start <= to) {
    const end = Math.min(to, start + chunk - 1);
    try {
      const batch = await rpc.call("eth_getLogs", [{ ...filter, fromBlock: hexNum(start), toBlock: hexNum(end) }]);
      logs.push(...batch);
      start = end + 1;
      fails = 0;
      chunk = Math.min(MAX_CHUNK, chunk * 2);
      if (onProgress) onProgress((start - from) / Math.max(1, to - from + 1));
    } catch (e) {
      if (e.code === "too-many" && chunk > MIN_CHUNK) {
        chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 4));
        continue;
      }
      // anything else (a busy node, a dropped connection): wait and try the
      // same range again a few times before giving up on the whole read
      if (e.code !== "bad-address" && e.code !== "not-pons" && fails++ < 5) {
        await sleep(1000 * fails);
        continue;
      }
      throw e;
    }
  }
  return { logs, chunk };
}

/** All trades of the token in [from, to]: curve events plus v4 pool swaps. */
export async function readTrades(rpc, meta, from, to, { curve = true, pool = true, onProgress } = {}) {
  if (to < from) return [];
  const parts = [];
  let swapLogs = null;
  let done = 0;
  const legs = (curve ? 1 : 0) + (pool ? 1 : 0);
  const prog = (p) => onProgress && onProgress((done + p) / legs);
  if (curve) {
    const { logs } = await getLogsChunked(rpc, { address: meta.curve, topics: [[TOPIC.buy, TOPIC.sell]] }, from, to, { onProgress: prog });
    parts.push(...logs);
    done++;
  }
  if (pool) {
    // v4 logs are far denser than curve logs, so this leg starts small
    const { logs } = await getLogsChunked(rpc, { address: ADDR.poolManager, topics: [TOPIC.swap, meta.poolId] }, from, to, {
      chunk: 50_000,
      onProgress: prog,
    });
    parts.push(...logs);
    if (logs.length) swapLogs = logs;
  }
  const trades = decodeTrades(meta, parts);
  if (swapLogs) await attachSwapTraders(rpc, meta, trades, from, to);
  return trades;
}

/**
 * A v4 Swap names only the router, so the wallet behind a pool trade is read
 * from the token's Transfer in the same transaction: tokens leaving the pool
 * manager go to the buyer, tokens arriving come from the seller. Display
 * only: the trader never enters the log or the hash.
 */
async function attachSwapTraders(rpc, meta, trades, from, to) {
  // only the recent ones: the page shows the last 40 trades and reading
  // every Transfer since launch would double a cold start
  const need = trades.filter((t) => !t.trader && t.blk > to - 20_000);
  if (!need.length) return;
  const lo = Math.min(...need.map((t) => t.blk)), hi = Math.max(...need.map((t) => t.blk));
  let logs;
  try {
    ({ logs } = await getLogsChunked(rpc, { address: meta.token, topics: [TOPIC.transfer] }, Math.max(from, lo), Math.min(to, hi), { chunk: 20_000 }));
  } catch {
    return;
  }
  const pm = ADDR.poolManager;
  const byTx = new Map();
  for (const l of logs) {
    const f = topicAddr(l.topics[1]), t = topicAddr(l.topics[2]);
    const who = f === pm ? t : t === pm ? f : null;
    if (who && !byTx.has(l.transactionHash.toLowerCase())) byTx.set(l.transactionHash.toLowerCase(), who);
  }
  for (const t of need) t.trader = byTx.get(t.tx) || "";
}

/** Refresh the graduated flag; the feed switches its polling leg when it flips. */
export async function isGraduated(rpc, meta, block = "latest") {
  const tag = typeof block === "number" ? hexNum(block) : block;
  const r = await rpc.call("eth_call", [{ to: meta.curve, data: SEL.graduated }, tag]).catch(() => "0x");
  return r && r !== "0x" && uint(r, 0) === 1n;
}
