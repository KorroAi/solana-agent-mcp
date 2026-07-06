// PUMPFUN SNIPER v10 — MCP stdio + HTTP REST API
import dotenv from "dotenv";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
dotenv.config();

const KEYS = (process.env.HELIUS_API_KEYS || process.env.HELIUS_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
const WS_URLS = KEYS.map(k => `wss://mainnet.helius-rpc.com/?api-key=${k}`);
const RPC_URLS = [...KEYS.map(k => `https://mainnet.helius-rpc.com/?api-key=${k}`), "https://api.mainnet-beta.solana.com", "https://solana-api.projectserum.com"];
let wsIdx = 0, rpcIdx = 0;
const PORT = parseInt(process.env.SOLANA_MCP_PORT || "8791", 10);

// RPC circuit breaker — track failures per URL
const rpcBackoff = new Map<string, number>();
const RPC_BACKOFF_BASE = 5000;
function markRpcFailed(url: string) { rpcBackoff.set(url, Date.now() + RPC_BACKOFF_BASE * (rpcBackoff.has(url) ? 2 : 1)); }
function getRPC() {
  for (let i = 0; i < RPC_URLS.length; i++) {
    const u = RPC_URLS[rpcIdx++ % RPC_URLS.length] || "https://api.mainnet-beta.solana.com";
    const backoff = rpcBackoff.get(u) || 0;
    if (Date.now() >= backoff) return u;
  }
  return RPC_URLS[rpcIdx++ % RPC_URLS.length] || "https://api.mainnet-beta.solana.com";
}
let rpcConsecutiveFails = 0;
function onRpcSuccess() { rpcConsecutiveFails = 0; }
function onRpcFail() { rpcConsecutiveFails++; if (rpcConsecutiveFails >= 3) { rpcConsecutiveFails = 0; /* circuit would trip here for live mode */ } }

const MIN_ENTRY_PRICE_USD = 0.0001;
let lastSolPrice = 73; // fallback SOL price

// â"€â"€ State â"€â"€
const pos = new Map<string, { mint: string; entrySol: number; tokenAmount: number; ts: number; sold: boolean; soldPct?: number; entryAct: number; entryPriceUsd: number; peakPriceUsd: number }>();
let paperBal = 10, paperOn = true, autoTradeOn = false, autoTradeId: any = null;
let wins = 0, losses = 0, best = 0, worst = 0, dailyPnl = 0, cbLosses = 0;
const tradeHistory: any[] = [];
const latest: { mint: string; ts: number }[] = [];
const pfAct = new Map<string, number>();
const pfActHistory = new Map<string, number[]>(); // sliding window: timestamps of each mention
const checked = new Map<string, number>(); // mint -> timestamp, avoid re-checking same token
const traded = new Set<string>();
const loserMints = new Set<string>(); // never rebuy a loser
let scanMsgs = 0, scanWs: WebSocket | null = null, lastScanTs = Date.now();
const signalLog: any[] = [];
let lastDebugTs = 0;
let solPriceUsd = 200;
const priceCache = new Map<string, number>();
const priceSubs = new Map<string, number>();
const subToMint = new Map<number, string>();
let priceWs: WebSocket | null = null;
let subIdCounter = 0;

// â"€â"€ Config â"€â"€
// V9.4 TIGHT: tighter trail to cut losses, bigger bets to beat fees
const SL = 15, TP1 = 30, TP2 = 60, TRAIL = 3, MAX_HOLD = 300, MAX_POS = 2, WINDOW = 15_000, MIN_TX = 2;
const BUY_EARLY = 0.15, BUY_CONFIRMED = 0.30;
const MOM_WINDOW = 30_000, MOM_EARLY_BUYS = 2, MOM_CONF_BUYS = 5, MOM_MIN_SOL = 0.01, MOM_RATIO = 1.3;
const BC_GRAD_SOL = 85;

// â"€â"€ SSE â"€â"€
const sseClients = new Set<http.ServerResponse>();
function sse(e: string, d: any) { const m = `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`; for (const c of sseClients) { try { c.write(m); } catch { sseClients.delete(c); } } }
function json(res: http.ServerResponse, d: any, code = 200) { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(d)); }
function sf(res: http.ServerResponse, f: string, ct: string) { try { res.writeHead(200, { "Content-Type": ct }); res.end(fs.readFileSync(path.resolve(process.cwd(), f), "utf-8")); } catch { json(res, { error: "not found" }, 404); } }

// System DNS HTTP helpers with retry + backoff (bypasses Node.js c-ares DNS issues)
function sysGetJSON(url: string, timeout = 5000, retries = 2): Promise<any> {
  return sysRequestJSON("GET", url, null, timeout, retries);
}
function sysPostJSON(url: string, body: any, timeout = 5000, retries = 2): Promise<any> {
  return sysRequestJSON("POST", url, body, timeout, retries);
}
function sysRequestJSON(method: "GET" | "POST", url: string, body: any, timeout: number, retries: number): Promise<any> {
  return new Promise((resolve) => {
    const u = new URL(url);
    dns.lookup(u.hostname, { family: 4 }, (err, ip) => {
      if (err) {
        if (retries > 0) return resolve(sysRequestJSON(method, url, body, timeout, retries - 1));
        return resolve(null);
      }
      const opts: any = { hostname: ip, path: u.pathname + u.search, method, headers: { Host: u.hostname }, servername: u.hostname };
      if (method === "POST") {
        const payload = JSON.stringify(body);
        opts.headers["Content-Type"] = "application/json";
        opts.headers["Content-Length"] = String(Buffer.byteLength(payload));
      }
      const req = https.request(opts, (res) => {
        let d = ""; res.on("data", c => d += c); res.on("end", () => {
          if (res.statusCode === 429) {
            markRpcFailed(url);
            if (retries > 0) return setTimeout(() => resolve(sysRequestJSON(method, url, body, timeout, retries - 1)), 2000);
            return resolve(null);
          }
          try { resolve(JSON.parse(d)); } catch { resolve(null); }
        });
      });
      req.on("error", () => {
        markRpcFailed(url);
        if (retries > 0) return setTimeout(() => resolve(sysRequestJSON(method, url, body, timeout, retries - 1)), 1000);
        resolve(null);
      });
      req.setTimeout(timeout, () => { req.destroy(); if (retries > 0) setTimeout(() => resolve(sysRequestJSON(method, url, body, timeout, retries - 1)), 1000); else resolve(null); });
      if (method === "POST") req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// Pump.fun bonding curve PDA derivation
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
function getBondingCurveAddr(mint: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
    PUMP_PROGRAM
  );
  return pda.toBase58();
}

// SOL price via CoinGecko with fallback (never returns 0)
function getSolPriceSafe(): number { return solPriceUsd > 0 ? solPriceUsd : lastSolPrice; }
async function refreshSolPrice() {
  https.get("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { headers: { "User-Agent": "solana-sniper/1.0" } }, (res) => {
    let d = ""; res.on("data", c => d += c); res.on("end", () => {
      try { const p = JSON.parse(d)?.solana?.usd; if (p && p > 0) { solPriceUsd = p; lastSolPrice = p; } } catch {}
    });
  }).on("error", () => {});
}
async function getBondingCurvePriceSol(mint: string): Promise<number | null> {
  try {
    const bcAddr = getBondingCurveAddr(mint);
    const d = await sysPostJSON(getRPC(), {
      jsonrpc: "2.0", id: 1, method: "getAccountInfo",
      params: [bcAddr, { encoding: "base64" }]
    }, 3000);
    const data = d?.result?.value?.data;
    if (!data || !data[0]) return null;
    const buf = Buffer.from(data[0], "base64");
    const vtReserves = Number(buf.readBigUInt64LE(8));
    const vsReserves = Number(buf.readBigUInt64LE(16));
    if (!vtReserves || !vsReserves) return null;
    return vsReserves / vtReserves; // SOL per raw token unit
  } catch { return null; }
}
async function getPriceUsdSafe(mint: string): Promise<number> {
  const priceSOL = await getBondingCurvePriceSol(mint);
  const solPrice = getSolPriceSafe();
  if (priceSOL !== null) return Math.max(priceSOL * solPrice, MIN_ENTRY_PRICE_USD);
  return MIN_ENTRY_PRICE_USD;
}
async function getPriceUsd(mint: string, _timeout?: number): Promise<number | null> {
  const priceSOL = await getBondingCurvePriceSol(mint);
  return priceSOL !== null ? priceSOL * getSolPriceSafe() : null;
}
function getPnL(pp: { entrySol: number; entryPriceUsd: number }, currentPriceUsd: number) {
  if (!pp.entryPriceUsd || pp.entryPriceUsd <= 0) return { currentValueSol: pp.entrySol, pnlPct: 0, pnlSol: 0 };
  if (!currentPriceUsd || currentPriceUsd <= 0) return { currentValueSol: pp.entrySol, pnlPct: 0, pnlSol: 0 };
  const ratio = currentPriceUsd / pp.entryPriceUsd;
  const currentValueSol = pp.entrySol * ratio;
  return { currentValueSol, pnlPct: (ratio - 1) * 100, pnlSol: currentValueSol - pp.entrySol };
}

// V9.2 Momentum filter — bonding curve deltas for real buy/sell activity
const tokenActivityLog = new Map<string, {dir: 'buy'|'sell', ts: number, sol: number}[]>();
const bcPrevReserves = new Map<string, number>();
function getMomentum(mint: string): {buys: number, sells: number, ok: boolean} {
  const now = Date.now();
  const events = tokenActivityLog.get(mint) || [];
  const fresh = events.filter(e => now - e.ts < MOM_WINDOW);
  if (fresh.length < events.length) tokenActivityLog.set(mint, fresh);
  const buys = fresh.filter(e => e.dir === 'buy' && e.sol >= MOM_MIN_SOL);
  const sells = fresh.filter(e => e.dir === 'sell');
  return { buys: buys.length, sells: sells.length, ok: buys.length >= MOM_EARLY_BUYS && buys.length > sells.length * MOM_RATIO };
}
function watchMomentum(mint: string) {
  if (!priceWs || priceWs.readyState !== WebSocket.OPEN) return;
  if (bcPrevReserves.has(mint)) return;
  const bcAddr = getBondingCurveAddr(mint);
  const subId = ++subIdCounter; priceSubs.set(mint, subId); subToMint.set(subId, mint);
  priceWs.send(JSON.stringify({ jsonrpc: "2.0", id: subId, method: "accountSubscribe", params: [bcAddr, { encoding: "base64", commitment: "processed" }] }));
  getBondingCurvePriceSol(mint).then(p => { if (p !== null) priceCache.set(mint, p); });
}
function trackMomentum(mint: string, vsReserves: number, vtReserves: number) {
  const prev = bcPrevReserves.get(mint);
  bcPrevReserves.set(mint, vsReserves);
  if (prev === undefined || vsReserves === prev) return;
  const delta = (vsReserves - prev) / 1e9;
  const dir = delta > 0 ? 'buy' : 'sell';
  const absDelta = Math.abs(delta);
  if (absDelta < 0.001) return;
  const events = tokenActivityLog.get(mint) || [];
  events.push({ dir, ts: Date.now(), sol: absDelta });
  if (events.length > 200) events.shift();
  tokenActivityLog.set(mint, events);
}

// V9 State persistence
function saveState() {
  try {
    const data = { pfActHistory: [...pfActHistory.entries()].map(([mint, tss]) => [mint, tss]), loserMints: [...loserMints], savedAt: Date.now() };
    fs.writeFileSync("state.json", JSON.stringify(data));
  } catch { /* ignore */ }
}
function loadState() {
  try {
    if (!fs.existsSync("state.json")) return;
    const data = JSON.parse(fs.readFileSync("state.json", "utf8"));
    const now = Date.now();
    if (data.pfActHistory) for (const [mint, tss] of data.pfActHistory) { const valid = tss.filter((ts: number) => now - ts < WINDOW); if (valid.length > 0) pfActHistory.set(mint, valid); }
    if (data.loserMints) for (const m of data.loserMints) loserMints.add(m);
  } catch { /* ignore */ }
}

async function isSafe(mint: string) {
  try {
    const d = await sysPostJSON(getRPC(), { jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] });
    if (!d) return false;
    const p = d?.result?.value?.data?.parsed?.info;
    if (!p) return false;
    if (p.mintAuthority) return false;
    if (p.freezeAuthority) return false;
    const supply = Number(p.supply || 0) / 10 ** (p.decimals || 0);
    if (supply > 1_000_000_000) return false;
    return true;
  } catch { return false; }
}

// Get real SOL deposited on bonding curve (offset 32: realSolReserves u64 LE, in lamports)
async function getBondingCurveRealSol(mint: string): Promise<number> {
  try {
    const bcAddr = getBondingCurveAddr(mint);
    const d = await sysPostJSON(getRPC(), {
      jsonrpc: "2.0", id: 1, method: "getAccountInfo",
      params: [bcAddr, { encoding: "base64" }]
    }, 3000);
    const data = d?.result?.value?.data;
    if (!data || !data[0]) return 0;
    const buf = Buffer.from(data[0], "base64");
    return Number(buf.readBigUInt64LE(32)) / 1e9; // lamports → SOL
  } catch { return 0; }
}

// Whale check: 10+ transactions in last 60s (sliding window) → real momentum NOW
// Cumulative realSolReserves is IGNORED — old buys from 15min ago are irrelevant
function hasWhales(mint: string): boolean {
  const now = Date.now();
  const history = pfActHistory.get(mint) || [];
  const recent = history.filter(ts => now - ts < WINDOW).length;
  return recent >= MIN_TX;
}

// Price WebSocket — accountSubscribe for live SOL prices
function startPriceWS() {
  const u = WS_URLS[wsIdx++ % WS_URLS.length] || "wss://api.mainnet-beta.solana.com";
  const ws = new WebSocket(u); priceWs = ws;
  ws.on("open", () => {
    for (const [mint, pp] of pos) { if (pp.sold) continue; watchBondingCurve(mint); }
  });
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === "accountNotification") {
        const subId = msg.params?.subscription;
        const targetMint = subId ? subToMint.get(subId) : undefined;
        if (!targetMint) return;
        const buf = Buffer.from(msg.params.result.value.data[0], "base64");
        const vt = Number(buf.readBigUInt64LE(8)), vs = Number(buf.readBigUInt64LE(16));
        if (vt && vs) { priceCache.set(targetMint, vs / vt); trackMomentum(targetMint, vs, vt); }
      }
      if (msg.id !== undefined && msg.result !== undefined && typeof msg.result === 'number') {
        const requestId = msg.id; const realSubId = msg.result;
        const mint = subToMint.get(requestId);
        if (mint) { subToMint.delete(requestId); subToMint.set(realSubId, mint); priceSubs.set(mint, realSubId); }
      }
    } catch { /* */ }
  });
  ws.on("close", () => { priceWs = null; priceCache.clear(); subToMint.clear(); priceSubs.clear(); setTimeout(startPriceWS, 1000); });
  ws.on("error", () => { try { ws.close(); } catch { /* */ } });
}
function watchBondingCurve(mint: string) {
  if (!priceWs || priceWs.readyState !== WebSocket.OPEN) return;
  const bcAddr = getBondingCurveAddr(mint);
  const subId = ++subIdCounter; priceSubs.set(mint, subId); subToMint.set(subId, mint);
  priceWs.send(JSON.stringify({ jsonrpc: "2.0", id: subId, method: "accountSubscribe", params: [bcAddr, { encoding: "base64", commitment: "processed" }] }));
  getBondingCurvePriceSol(mint).then(p => { if (p !== null) priceCache.set(mint, p); });
}
function unwatchBondingCurve(mint: string) {
  const subId = priceSubs.get(mint);
  if (subId && priceWs && priceWs.readyState === WebSocket.OPEN) priceWs.send(JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "accountUnsubscribe", params: [subId] }));
  const sId = priceSubs.get(mint); if (sId) subToMint.delete(sId);
  priceSubs.delete(mint); priceCache.delete(mint);
}

// Scanner
function startScanner() {
  const u = WS_URLS[wsIdx++ % WS_URLS.length] || "wss://api.mainnet-beta.solana.com";
  const ws = new WebSocket(u); scanWs = ws;
  ws.on("open", () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"] }, { commitment: "processed" }] })));
  ws.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()); const logs: string[] = msg.params?.result?.value?.logs ?? [];
      const re = /[1-9A-HJ-NP-Za-km-z]{32,44}pump/; let mint: string | null = null;
      for (const log of logs) { scanMsgs++; if (!mint) { const m = log.match(re); if (m) mint = m[0]; } }
      if (mint) { lastScanTs = Date.now();
        const cnt = (pfAct.get(mint) || 0) + 1; pfAct.set(mint, cnt); const h = pfActHistory.get(mint) || []; h.push(Date.now()); if (h.length > 30) h.shift(); pfActHistory.set(mint, h);
        if (cnt === 1) watchMomentum(mint);
        if (cnt <= 1 || cnt === 3 || cnt === 5 || cnt === 8) { latest.unshift({ mint, ts: Date.now() }); if (latest.length > 500) latest.length = 500; sse("scan", latest.slice(0, 20)); }
      }
    } catch { /* */ }
  });
  ws.on("close", () => { scanWs = null; setTimeout(startScanner, 3000); });
  ws.on("error", () => { try { ws.close(); } catch { /* */ } });
}

// â"€â"€ Close position â"€â"€
function closePos(mint: string, pp: any, reason: string, currentValue?: number) {
  const hs = (Date.now() - pp.ts) / 1000;
  const v = currentValue ?? pp.entrySol; const profit = v - pp.entrySol; pp.sold = true;
  if (profit > 0) { wins++; if (profit > best) best = profit; cbLosses = 0; } else { losses++; if (profit < worst) worst = profit; cbLosses++; loserMints.add(mint); }
  dailyPnl += profit; if (paperOn) { pos.delete(mint); traded.add(mint); paperBal += Math.max(0, v); } unwatchBondingCurve(mint); saveState();
  const t = { id: tradeHistory.length + 1, mint, entrySol: pp.entrySol, exitSol: v, pnlSol: profit, pnlPct: (profit / pp.entrySol) * 100, holdSec: hs, reason, ts: Date.now(), entryPriceUsd: pp.entryPriceUsd, exitPriceUsd: pp.entryPriceUsd > 0 ? pp.entryPriceUsd * (1 + ((profit/pp.entrySol)*100)/100) : 0 };
  tradeHistory.unshift(t); sse("trade", t); sse("stats", { trades: tradeHistory.length, wins, losses, dailyPnl: +dailyPnl.toFixed(4), cbLosses });
}

// â"€â"€ TP/SL Monitor â"€â"€
let tpSlLock = false;
async function checkTpSl() {
  if (tpSlLock) return;
  tpSlLock = true;
  try {
    for (const [mint, pp] of [...pos.entries()]) {
      if (pp.sold) continue;
      const hs = (Date.now() - pp.ts) / 1000;
      // Fast: bonding curve SOL price (sub-second, always available)
      const priceSOL = await getBondingCurvePriceSol(mint);
      if (pp.sold) continue; // re-check after async
      const priceUsd = priceSOL !== null ? priceSOL * solPriceUsd : null;
      let pnl = 0, v = pp.entrySol;
      if (priceUsd !== null && pp.entryPriceUsd > 0) {
        const r = getPnL(pp, priceUsd);
        pnl = r.pnlPct; v = r.currentValueSol;
        // Track peak for trailing SL
        const curPeak = pp.peakPriceUsd || pp.entryPriceUsd;
        if (priceUsd > curPeak) pp.peakPriceUsd = priceUsd;
      }
      // Graduated: bonding curve closed → sell at peak (prevents TIMEOUT at 0 PnL)
      if (priceSOL === null && pp.peakPriceUsd > pp.entryPriceUsd) {
        const peakVal = pp.entrySol * (pp.peakPriceUsd / pp.entryPriceUsd);
        closePos(mint, pp, "GRAD", peakVal); continue;
      }
      // V9.2 Tiered TP: +30% sell 50%, +60% sell rest
      if (pnl >= TP1 && (pp.soldPct || 0) < 1) {
        pp.soldPct = (pp.soldPct || 0) + (pnl >= TP2 ? 1 : 0.5);
        const sellVal = v * (pnl >= TP2 ? 1 : 0.5);
        if (paperOn) paperBal += Math.max(0, sellVal);
        sse("journal", { action: pnl >= TP2 ? "TP2" : "TP1", mint, pnl: pnl.toFixed(1)+"%", valueSOL: sellVal.toFixed(6) });
        if (pp.soldPct >= 1) { pos.delete(mint); traded.add(mint); }
        continue;
      }
      // V9.4 Tighter trail: activate at +5%, exit at peak -3%
      if (pp.peakPriceUsd > pp.entryPriceUsd) {
        const peakPnl = (pp.peakPriceUsd / pp.entryPriceUsd - 1) * 100;
        if (peakPnl >= 5) {
          const trailPrice = pp.peakPriceUsd * (1 - TRAIL / 100);
          if (priceUsd !== null && priceUsd <= trailPrice) { closePos(mint, pp, "TRAIL", v); continue; }
        }
      }
      // INSTA-DUMP: -15% in < 5s
      if (hs < 5 && pnl <= -15) { closePos(mint, pp, "INSTA-DUMP", v); continue; }
      // SELL-SURGE: sell vol > buy vol * 3 in last 3s (detect dump before price moves)
      const evts = tokenActivityLog.get(mint) || [];
      const recent3s = evts.filter(e => Date.now() - e.ts < 3000);
      const sellVol = recent3s.filter(e => e.dir === 'sell').reduce((s, e) => s + e.sol, 0);
      const buyVol = recent3s.filter(e => e.dir === 'buy').reduce((s, e) => s + e.sol, 0);
      if (sellVol > buyVol * 3 && sellVol > 0.1) { closePos(mint, pp, "SELL-SURGE", v); continue; }
      // DEAD: no buy >0.02 SOL in last 10s
      if (hs > 5 && !recent3s.some(e => e.dir === 'buy' && e.sol >= 0.02)) { closePos(mint, pp, "DEAD", v); continue; }
      if (pnl <= -SL) { closePos(mint, pp, "SL", v); continue; }
      if (hs >= 60 && pnl <= -50) { closePos(mint, pp, "RUG", v); continue; }
      if (hs >= MAX_HOLD) { closePos(mint, pp, "TIMEOUT", v); }
    }
  } finally { tpSlLock = false; }
}

// â"€â"€ Auto-Trade â"€â"€
function startAutoTrade() {
  if (autoTradeOn) return "Already ON"; autoTradeOn = true;
  autoTradeId = setInterval(async () => {
    try {
    if (pos.size >= MAX_POS) return;
    const now = Date.now();
    // V9.3: triple filter — isSafe + hasWhales + momentum + skip near-grad
    const fresh = latest.filter(t => {
      if (traded.has(t.mint) || pos.has(t.mint)) return false;
      if (loserMints.has(t.mint)) return false;
      if ((now - t.ts) < 2000) return false;
      return true;
    }).slice(0, 3);
    if (!fresh.length) return;

    const signals: any[] = [];
    for (const t of fresh) {
      const ageSec = (now - t.ts) / 1000;
      checked.set(t.mint, now);
      let action = "SKIP", reasons: string[] = [];

      const safe = await isSafe(t.mint);
      if (!safe) { reasons.push("unsafe"); signals.push({ mint: t.mint, score: 0, action: "SKIP", reasons, ts: now, buySize: 0 }); continue; }
      reasons.push("safe");

      const whales = hasWhales(t.mint);
      if (!whales) { reasons.push("no-buys"); signals.push({ mint: t.mint, score: 0, action: "WAIT", reasons, ts: now, buySize: 0 }); continue; }
      reasons.push("real-buys");

      watchMomentum(t.mint);
      const mom = getMomentum(t.mint);
      const isEarly = mom.buys >= MOM_EARLY_BUYS && mom.buys > mom.sells * MOM_RATIO;
      const isConfirmed = mom.buys >= MOM_CONF_BUYS && mom.buys > mom.sells * MOM_RATIO;
      if (!isEarly && !isConfirmed) { reasons.push("B"+mom.buys+"/S"+mom.sells); signals.push({ mint: t.mint, score: mom.buys>=1?30:0, action: "WAIT", reasons, ts: now, buySize: 0 }); continue; }
      reasons.push("B"+mom.buys+"/S"+mom.sells);

      const bcNearGrad = await getBondingCurveRealSol(t.mint);
      const bcComplete = bcNearGrad > 0 ? (bcNearGrad / BC_GRAD_SOL) * 100 : 0;
      if (bcComplete > 40) { reasons.push("near-grad:"+bcComplete.toFixed(0)+"%"); signals.push({ mint: t.mint, score: 0, action: "SKIP", reasons, ts: now, buySize: 0 }); continue; }

      // Direction: last 3 events must be buys (no one dumping)
      const dirEvents = tokenActivityLog.get(t.mint) || [];
      const last3 = dirEvents.slice(-3);
      if (last3.some(e => e.dir === 'sell')) { reasons.push("dir:sell"); signals.push({ mint: t.mint, score: 0, action: "SKIP", reasons, ts: now, buySize: 0 }); continue; }

      action = "BUY"; reasons.push("age:"+ageSec.toFixed(0)+"s");
      const buySize = isConfirmed ? BUY_CONFIRMED : BUY_EARLY;
      const score = 40 + (isConfirmed ? 40 : 20) + (bcComplete < 30 ? 20 : 0);
      const sig = { mint: t.mint, score, action, reasons, ts: now, buySize };
      signals.push(sig);
      signalLog.unshift(sig); if (signalLog.length > 100) signalLog.length = 100;
    }
    sse("scores", signals);

    const buys = signals.filter((s: any) => s.action === "BUY");
    if (!buys.length) return;
    const best = buys[0];
    if (pos.has(best.mint) || traded.has(best.mint)) return;
    if (!paperOn) return;

    // Retry entry price up to 3 times, then use safe fallback
    let entryPriceUsd: number | null = null;
    for (let retry = 0; retry < 3 && entryPriceUsd === null; retry++) {
      if (retry > 0) await new Promise(r => setTimeout(r, 500));
      const p = await getPriceUsd(best.mint, 3000);
      if (p !== null) entryPriceUsd = Math.max(p, MIN_ENTRY_PRICE_USD);
    }
    if (entryPriceUsd === null) {
      entryPriceUsd = await getPriceUsdSafe(best.mint); // guaranteed non-zero
    }
    const entrySol = best.buySize;
    if (paperBal < entrySol + 0.01) return; // balance guard
    paperBal -= entrySol;
    const solPx = getSolPriceSafe();
    const tokenAmount = entryPriceUsd > 0 ? Math.floor((entrySol * solPx) / entryPriceUsd) : Math.floor(entrySol * 1e9);
    pos.set(best.mint, { mint: best.mint, entrySol: entrySol, tokenAmount, ts: Date.now(), sold: false, entryAct: pfAct.get(best.mint) || 1, entryPriceUsd, peakPriceUsd: entryPriceUsd });
    watchBondingCurve(best.mint);
    sse("journal", { action: "AUTO_BUY", mint: best.mint, sol: entrySol, entryPriceUsd });
    sse("state", { positions: pos.size, paperBal, paperOn, autoTradeOn, trades: tradeHistory.length, scannerAlive: scanWs?.readyState === WebSocket.OPEN, scannerMsgs: scanMsgs, dailyPnl: +dailyPnl.toFixed(4), cbLosses });
    } catch (e: any) { console.error("[auto-trade] error:", e.message); }
  }, 1000);
  return `V10 ON | TP${TP1}/${TP2}% TRAIL${TRAIL}% | early>=${MOM_EARLY_BUYS}B conf>=${MOM_CONF_BUYS}B | skip>70% grad | minPx≥$${MIN_ENTRY_PRICE_USD}`;
}
function stopAutoTrade() { if (autoTradeId) clearInterval(autoTradeId); autoTradeOn = false; autoTradeId = null; return "OFF"; }

// â"€â"€ HTTP API â"€â"€
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", `http://127.0.0.1:${PORT}`); const p = u.pathname;
  let b: any = {};
  if (req.method === "POST") { try { b = await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(JSON.parse(d || "{}"))); }); } catch { b = {}; } }
  try {
    if (p === "/health") return json(res, { ok: true, mode: "V10-SAFE", positions: [...pos.values()].filter(x => !x.sold).length, scannerAlive: scanWs?.readyState === WebSocket.OPEN, scannerMsgs: scanMsgs, trades: tradeHistory.length, paper: paperOn, paperBal, autoTrade: autoTradeOn, tpslActive: true, dailyPnl: +dailyPnl.toFixed(4), cbLosses, losers: loserMints.size, scannerLag: ((Date.now() - lastScanTs) / 1000).toFixed(1), stuckPositions: [...pos.values()].filter(x => !x.sold && (Date.now() - x.ts) > 240000 && x.peakPriceUsd <= x.entryPriceUsd).length, rpcBackoffCount: rpcBackoff.size, rpcConsecutiveFails, solPrice: getSolPriceSafe() });
    if (p === "/wallet") return json(res, { address: "PAPER", balance: paperBal, mode: "paper" });
    if (p === "/settings") return json(res, { mode:"V10", SL, TP1, TP2, TRAIL, MAX_HOLD, BUY_EARLY, BUY_CONFIRMED, MOM_WINDOW, MOM_EARLY_BUYS, MOM_CONF_BUYS, MOM_MIN_SOL, MOM_RATIO, BC_GRAD_SOL, MAX_POS, autoTradeOn, tpslActive: true, minEntryPrice: MIN_ENTRY_PRICE_USD, solPrice: getSolPriceSafe() });
    if (p === "/rpc-health") return json(res, { backoffCount: rpcBackoff.size, consecutiveFails: rpcConsecutiveFails, backoffUrls: [...rpcBackoff.entries()].map(([url, until]) => ({ url: url.replace(/\?.*/, ""), until, remainingMs: Math.max(0, until - Date.now()) })), rpcCount: RPC_URLS.length });
    if (p === "/setup") return json(res, { configured: KEYS.length > 0, hasHelius: KEYS.length, mode: "SL20/TP100" });
    if (p === "/scores") return json(res, signalLog.slice(0, 20));
    if (p === "/scan") return json(res, latest.slice(0, parseInt(u.searchParams.get("limit") || "20")));
    if (p === "/portfolio") { const active = [...pos.values()].filter(x => !x.sold); const prices = Object.fromEntries((await Promise.all(active.map(async x => [x.mint, await getPriceUsd(x.mint)] as const))).filter(([, pr]) => pr !== null)); const ac = active.map(x => { const hs = (Date.now() - x.ts) / 1000; const priceUsd = prices[x.mint] || 0; const r = getPnL(x, priceUsd); return { mint: x.mint, entrySol: x.entrySol, entryUsd: x.entryPriceUsd || 0, tokenAmount: x.tokenAmount, currentValueSol: r.currentValueSol, pnlPct: r.pnlPct, pnlSol: r.pnlSol, soldPct: 0, holdMin: hs / 60 }; }); return json(res, { address: "PAPER", mode: "paper", solBalance: paperBal, activePositions: ac, tradeStats: { totalTrades: tradeHistory.length, wins, losses, winRate: tradeHistory.length ? ((wins / tradeHistory.length) * 100).toFixed(0) : "0", bestPnl: best, worstPnl: worst }, dailyPnl: +dailyPnl.toFixed(4), cbLosses }); }
    if (p === "/positions") { const active = [...pos.values()].filter(x => !x.sold); if (!active.length) return json(res, []); const prices = Object.fromEntries((await Promise.all(active.map(async x => [x.mint, await getPriceUsd(x.mint)] as const))).filter(([, pr]) => pr !== null)); return json(res, active.map(x => { const priceUsd = prices[x.mint] || 0; const r = getPnL(x, priceUsd); return { mint: x.mint, entrySol: x.entrySol, entryUsd: x.entryPriceUsd || 0, tokenAmount: x.tokenAmount, currentValueSol: r.currentValueSol, pnlSol: r.pnlSol, pnlPct: r.pnlPct, soldPct: 0, holdMin: (Date.now() - x.ts) / 60000 }; })); }
    if (p === "/positions-live") { const active = [...pos.values()].filter(x => !x.sold); const prices = Object.fromEntries((await Promise.all(active.map(async x => [x.mint, await getPriceUsd(x.mint)] as const))).filter(([, pr]) => pr !== null)); return json(res, active.map(x => { const hs = (Date.now() - x.ts) / 1000; const priceUsd = prices[x.mint] || 0; const r = getPnL(x, priceUsd); return { mint: x.mint, entrySol: x.entrySol, entryUsd: x.entryPriceUsd || 0, currentValueSol: r.currentValueSol, pnlSol: r.pnlSol, pnlPct: r.pnlPct, priceUsd, soldPct: 0, holdSec: hs, tokenAmount: x.tokenAmount, peakPriceUsd: x.peakPriceUsd || x.entryPriceUsd }; })); }
    if (p === "/trades") return json(res, { trades: tradeHistory.slice(0, parseInt(u.searchParams.get("limit") || "20")), total: tradeHistory.length });
    if (p === "/losers") return json(res, { count: loserMints.size, mints: [...loserMints] });
    if (p === "/stats") { const tot = tradeHistory.length; return json(res, { totalTrades: tot, wins, losses, winRate: tot ? ((wins / tot) * 100).toFixed(0) : "N/A", best, worst, loserMints: loserMints.size }); }
    if (p === "/autotrade/start") return json(res, { status: startAutoTrade() });
    if (p === "/autotrade/stop") return json(res, { status: stopAutoTrade() });
    if (p === "/autotrade/status") return json(res, { active: autoTradeOn });
    if (p === "/paper") { if (b.action === "start") { paperOn = true; paperBal = b.balanceSol || 10; return json(res, { paperMode: true, balanceSol: paperBal }); } if (b.action === "stop") { paperOn = false; return json(res, { paperMode: false }); } return json(res, { paperMode: paperOn, balanceSol: paperBal }); }
    if (p === "/stream") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" }); res.write("event: connected\ndata: {}\n\n"); sseClients.add(res); sse("state", { positions: [...pos.values()].filter(x => !x.sold).length, paperBal, paperOn, autoTradeOn, trades: tradeHistory.length, scannerAlive: scanWs?.readyState === WebSocket.OPEN, scannerMsgs: scanMsgs, dailyPnl: +dailyPnl.toFixed(4), cbLosses }); req.on("close", () => sseClients.delete(res)); return; }
    if (p === "/debug/momentum") return json(res, { tokenActivityLogSize: tokenActivityLog.size, priceWsState: priceWs?.readyState, priceSubsSize: priceSubs.size, bcPrevReservesSize: bcPrevReserves.size, tracked: [...tokenActivityLog.entries()].slice(0, 10).map(([m, evts]) => ({ mint: m.slice(0,12), events: evts.length, buys: evts.filter(e=>e.dir==='buy').length, sells: evts.filter(e=>e.dir==='sell').length, latest: evts.slice(-3) })) });
    if (p === "/dashboard") return sf(res, "dashboard.html", "text/html");
    if (p === "/farm/dashboard") return sf(res, "farm-dashboard.html", "text/html");
    return json(res, { error: "not found" }, 404);
  } catch (e: any) { if (!res.headersSent) json(res, { error: e.message }, 500); }
});

// ── Generic Solana helpers (not pump.fun specific) ──
async function getSolBalance(address: string): Promise<number | null> {
  try {
    const d = await sysPostJSON(getRPC(), { jsonrpc:"2.0", id:1, method:"getBalance", params:[address] }, 5000);
    return d?.result?.value !== undefined ? d.result.value / 1e9 : null;
  } catch { return null; }
}
async function getTokenBalance(address: string, mint: string): Promise<number | null> {
  try {
    const d = await sysPostJSON(getRPC(), { jsonrpc:"2.0", id:1, method:"getTokenAccountsByOwner", params:[address, {mint}, {encoding:"jsonParsed"}] }, 5000);
    if (!d?.result?.value?.length) return 0;
    const info = d.result.value[0]?.account?.data?.parsed?.info;
    return info ? Number(info.tokenAmount.amount) / 10 ** info.tokenAmount.decimals : null;
  } catch { return null; }
}
async function getTokenMetadata(mint: string): Promise<any> {
  try {
    const d = await sysPostJSON(getRPC(), { jsonrpc:"2.0", id:1, method:"getAccountInfo", params:[mint, {encoding:"jsonParsed"}] }, 5000);
    const info = d?.result?.value?.data?.parsed?.info;
    if (!info) return null;
    return { mint, decimals: info.decimals, supply: Number(info.supply) / 10**info.decimals, mintAuthority: info.mintAuthority || null, freezeAuthority: info.freezeAuthority || null };
  } catch { return null; }
}
async function getTxDetails(signature: string): Promise<any> {
  try {
    const d = await sysPostJSON(getRPC(), { jsonrpc:"2.0", id:1, method:"getTransaction", params:[signature, {encoding:"jsonParsed", maxSupportedTransactionVersion:0}] }, 5000);
    if (!d?.result) return null;
    const tx = d.result;
    return { signature, slot: tx.slot, blockTime: tx.blockTime, status: tx.meta?.status, fee: tx.meta?.fee / 1e9, signer: tx.transaction?.message?.accountKeys?.[0]?.pubkey };
  } catch { return null; }
}

// ── MCP stdio server — AI agents connect natively via stdin/stdout (no API key needed) ──
const mcpServer = new McpServer(
  { name: "solana-agent-mcp", version: "10.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

mcpServer.tool("solana_get_balance", "Get SOL balance for any Solana wallet address", { address: z.string().describe("Solana wallet address") }, async (args) => {
  const bal = await getSolBalance(args.address);
  return { content: [{ type:"text" as const, text: JSON.stringify({ address: args.address, balanceSOL: bal, balanceLamports: bal !== null ? Math.floor(bal * 1e9) : null }) }] };
});

mcpServer.tool("solana_get_token_balance", "Get SPL token balance for a wallet address and token mint", { address: z.string(), mint: z.string() }, async (args) => {
  const bal = await getTokenBalance(args.address, args.mint);
  return { content: [{ type:"text" as const, text: JSON.stringify({ address: args.address, mint: args.mint, balance: bal }) }] };
});

mcpServer.tool("solana_get_token_info", "Get on-chain metadata for any SPL token: decimals, supply, authorities", { mint: z.string().describe("Token mint address") }, async (args) => {
  const info = await getTokenMetadata(args.mint);
  if (!info) return { content: [{ type:"text" as const, text: JSON.stringify({ error:"Token not found or invalid mint address" }) }], isError: true };
  return { content: [{ type:"text" as const, text: JSON.stringify({ ...info, mintRevoked: info.mintAuthority === null, freezeRevoked: info.freezeAuthority === null }) }] };
});

mcpServer.tool("solana_get_price", "Get current SOL price in USD", {}, async () => ({
  content: [{ type:"text" as const, text: JSON.stringify({ SOL: getSolPriceSafe(), timestamp: Date.now() }) }]
}));

mcpServer.tool("solana_scan_tokens", "Scan recent pump.fun tokens from real-time Helius WebSocket", {}, async () => {
  const tokens = latest.slice(0, 20).map(t => ({ mint: t.mint, ageSec: ((Date.now() - t.ts) / 1000).toFixed(1) }));
  return { content: [{ type:"text" as const, text: JSON.stringify({ scannerAlive: scanWs?.readyState === WebSocket.OPEN, count: tokens.length, tokens }) }] };
});

mcpServer.tool("solana_get_transaction", "Get transaction details by signature", { signature: z.string().describe("Transaction signature") }, async (args) => {
  const tx = await getTxDetails(args.signature);
  if (!tx) return { content: [{ type:"text" as const, text: JSON.stringify({ error:"Transaction not found" }) }], isError: true };
  return { content: [{ type:"text" as const, text: JSON.stringify(tx) }] };
});

mcpServer.tool("solana_request_airdrop", "Request SOL airdrop on devnet (testnet only, not mainnet)", { address: z.string().describe("Solana wallet address"), amount: z.number().optional().describe("SOL amount (default 1)") }, async (args) => {
  const amount = args.amount || 1;
  try {
    const d = await sysPostJSON("https://api.devnet.solana.com", { jsonrpc:"2.0", id:1, method:"requestAirdrop", params:[args.address, Math.floor(amount * 1e9)] }, 15000);
    return { content: [{ type:"text" as const, text: JSON.stringify({ address: args.address, amountSOL: amount, signature: d?.result || null, network: "devnet" }) }] };
  } catch { return { content: [{ type:"text" as const, text: JSON.stringify({ error:"Airdrop failed — devnet may be throttled" }) }], isError: true }; }
});

mcpServer.tool("solana_health", "System health: RPC status, scanner status, SOL price", {}, async () => ({
  content: [{ type:"text" as const, text: JSON.stringify({
    rpcHealthy: rpcConsecutiveFails < 3,
    rpcBackoffCount: rpcBackoff.size,
    scannerAlive: scanWs?.readyState === WebSocket.OPEN,
    scannerTokensTracked: pfAct.size,
    solPrice: getSolPriceSafe(),
  }) }]
}));

// Resources — read-only data an agent can subscribe to
mcpServer.resource("solana://price", "solana://price", async () => ({
  contents: [{ uri:"solana://price", mimeType:"application/json", text: JSON.stringify({ SOL: getSolPriceSafe(), ts: Date.now() }) }]
}));

mcpServer.resource("solana://tokens/recent", "solana://tokens/recent", async () => ({
  contents: [{ uri:"solana://tokens/recent", mimeType:"application/json", text: JSON.stringify(latest.slice(0, 20)) }]
}));

// Start MCP stdio transport (no API key — agents connect via local process stdio)
async function startMcp() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  process.stderr.write(`[mcp] solana-agent-mcp v10 ready on stdio\n`);
}
startMcp().catch(e => process.stderr.write(`[mcp] stdio transport failed: ${e.message}\n`));

server.on("error", (e: any) => {
  if (e.code === "EADDRINUSE") process.stderr.write(`[http] port ${PORT} in use — HTTP skipped, MCP stdio still active\n`);
  else throw e;
});
server.listen(PORT, () => { process.stderr.write(`[http] V10-MCP | :${PORT} | mcp+http ready\n`); loadState(); startScanner(); startPriceWS(); refreshSolPrice(); setInterval(refreshSolPrice, 60000); setInterval(checkTpSl, 100); setInterval(saveState, 30000); setInterval(() => { const lag = Date.now() - lastScanTs; if (lag > 30000) process.stderr.write(`[ALERT] Scanner dead ${(lag/1000).toFixed(0)}s!\n`); const stuck = [...pos.values()].filter(x => !x.sold && (Date.now() - x.ts) > 240000 && x.peakPriceUsd <= x.entryPriceUsd); if (stuck.length) process.stderr.write(`[ALERT] Stuck: ${stuck.length}\n`); }, 15000); setInterval(() => sse("heartbeat", { ts: Date.now() }), 15000); });
