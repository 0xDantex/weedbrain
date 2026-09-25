// Local static server for src/ and data/.
//   npm run serve -- [--token 0xABC] [--mode demo|direct|collector] [--port 8080] [--lookback 60]
// --token overrides the configured token without touching any file.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { parseArgs, ROOT, loadConfig } from "./common.js";

const args = parseArgs();
const port = Number(args.port || 8080);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".webp": "image/webp", ".csv": "text/csv", ".jsonl": "application/x-ndjson", ".svg": "image/svg+xml",
};

function configBody() {
  const cfg = loadConfig();
  if (args.token !== undefined) cfg.token = args.token === true ? "" : args.token;
  if (args.mode) cfg.mode = args.mode;
  if (args.mode === "demo") cfg.token = "";
  if (args.lookback) cfg.lookbackMin = Number(args.lookback);
  if (args.genesis) cfg.genesisBlock = Number(args.genesis);
  return JSON.stringify(cfg, null, 2);
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (path === "/") path = "/index.html";
  if (path === "/weedbrain.config.json") {
    res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-cache" });
    return res.end(configBody());
  }
  const base = path.startsWith("/data/") ? ROOT : join(ROOT, "src");
  const file = normalize(join(base, path));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  let st;
  try { st = await stat(file); } catch { res.writeHead(404); return res.end("not found"); }
  if (st.isDirectory()) { res.writeHead(404); return res.end(); }
  const type = TYPES[extname(file)] || "application/octet-stream";
  const headers = {
    "content-type": type,
    "accept-ranges": "bytes",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Content-Range",
    "cache-control": "no-cache",
  };
  const body = await readFile(file);
  const range = req.headers.range && /^bytes=(\d+)-$/.exec(req.headers.range);
  if (range) {
    const from = Number(range[1]);
    if (from >= body.length) { res.writeHead(416, { ...headers, "content-range": `bytes */${body.length}` }); return res.end(); }
    res.writeHead(206, { ...headers, "content-range": `bytes ${from}-${body.length - 1}/${body.length}` });
    return res.end(body.subarray(from));
  }
  res.writeHead(200, headers);
  res.end(body);
}).listen(port, () => {
  const cfg = JSON.parse(configBody());
  console.log(`serving http://localhost:${port}/weedbrain.html  mode ${cfg.token ? cfg.mode : "demo"}  token ${cfg.token || "(none)"}`);
});
