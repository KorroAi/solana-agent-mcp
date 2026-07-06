// E2E MCP Test Agent — spawns solana-agent-mcp, runs full tool/resource suite
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_CMD = "node";
const SERVER_ARGS = [path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs"), path.join(__dirname, "src", "index.ts")];
const TIMEOUT = 15000;

let nextId = 1;
const pending = new Map();

function waitForResponse(id, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: id=${id}`)); }, timeoutMs);
  });
}

function send(child, method, params = {}) {
  const id = nextId++;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  child.stdin.write(msg);
  return waitForResponse(id);
}

function notify(child, method, params = {}) {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
  child.stdin.write(msg);
}

async function run() {
  console.log("=== Solana Agent MCP — E2E Test ===\n");

  // Kill any existing server on port 8791 first
  const child = spawn(SERVER_CMD, SERVER_ARGS, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    cwd: __dirname,
  });

  const rl = createInterface({ input: child.stdout });
  let buffer = "";

  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      // stderr lines or partial JSON — ignore
    }
  });

  child.stderr.on("data", (d) => {
    const txt = d.toString().trim();
    if (txt) process.stderr.write(`[server] ${txt}\n`);
  });

  child.on("error", (err) => {
    console.error("Failed to spawn server:", err.message);
    process.exit(1);
  });

  // Wait for server startup
  await new Promise((r) => setTimeout(r, 4000));

  try {
    // 1. Initialize
    console.log("1. INITIALIZE");
    const init = await send(child, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e-test-agent", version: "1.0.0" },
    });
    console.log(`   Server: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
    notify(child, "notifications/initialized");

    // 2. List tools
    console.log("\n2. LIST TOOLS");
    const tools = await send(child, "tools/list");
    for (const t of tools.result.tools) {
      console.log(`   ${t.name} — ${t.description.slice(0, 80)}`);
    }
    console.log(`   TOTAL: ${tools.result.tools.length} tools`);

    // 3. Call solana_scan
    console.log("\n3. solana_scan");
    const scan = await send(child, "tools/call", { name: "solana_scan", arguments: {} });
    const scanData = JSON.parse(scan.result.content[0].text);
    console.log(`   Tokens: ${scanData.count}`);
    if (scanData.tokens.length > 0) {
      console.log(`   Latest: ${scanData.tokens[0].mint} (${scanData.tokens[0].ageSec}s ago)`);
    }

    // 4. Call solana_health
    console.log("\n4. solana_health");
    const health = await send(child, "tools/call", { name: "solana_health", arguments: {} });
    const healthData = JSON.parse(health.result.content[0].text);
    console.log(`   Scanner: ${healthData.scannerAlive ? "ALIVE" : "DEAD"} | ${healthData.scannerMsgs.toLocaleString()} msgs`);
    console.log(`   Positions: ${healthData.activePositions} | Trades: ${healthData.trades} | PnL: ${healthData.dailyPnl}`);
    console.log(`   SOL: $${healthData.solPrice} | Paper: ${healthData.paperBal} SOL`);

    // 5. Call solana_stats
    console.log("\n5. solana_stats");
    const stats = await send(child, "tools/call", { name: "solana_stats", arguments: {} });
    const statsData = JSON.parse(stats.result.content[0].text);
    console.log(`   ${statsData.totalTrades} trades | ${statsData.winRate} WR | best: ${statsData.bestPnlSol} SOL`);

    // 6. Call solana_settings
    console.log("\n6. solana_settings");
    const settings = await send(child, "tools/call", { name: "solana_settings", arguments: {} });
    const settingsData = JSON.parse(settings.result.content[0].text);
    console.log(`   SL: ${settingsData.SL}% | TP: ${settingsData.TP1}/${settingsData.TP2}% | Trail: ${settingsData.TRAIL}%`);
    console.log(`   Max hold: ${settingsData.MAX_HOLD}s | Max pos: ${settingsData.MAX_POS}`);

    // 7. Read resource — solana://health
    console.log("\n7. RESOURCE solana://health");
    const resHealth = await send(child, "resources/read", { uri: "solana://health" });
    const resData = JSON.parse(resHealth.result.contents[0].text);
    console.log(`   Mode: ${resData.mode} | Paper: ${resData.paperBal} SOL`);

    // 8. Read resource — solana://tokens/recent
    console.log("\n8. RESOURCE solana://tokens/recent");
    const resTokens = await send(child, "resources/read", { uri: "solana://tokens/recent" });
    const tokensData = JSON.parse(resTokens.result.contents[0].text);
    console.log(`   ${tokensData.length} recent tokens`);

    // 9. Call autotrade_start then immediately stop
    console.log("\n9. AUTOTRADE START/STOP");
    const atStart = await send(child, "tools/call", { name: "solana_autotrade_start", arguments: {} });
    console.log(`   Start: ${JSON.parse(atStart.result.content[0].text).status}`);
    const atStop = await send(child, "tools/call", { name: "solana_autotrade_stop", arguments: {} });
    console.log(`   Stop: ${JSON.parse(atStop.result.content[0].text).status}`);

    // 10. Final portfolio check
    console.log("\n10. solana_portfolio");
    const pf = await send(child, "tools/call", { name: "solana_portfolio", arguments: {} });
    const pfData = JSON.parse(pf.result.content[0].text);
    console.log(`   Positions: ${pfData.activePositions.length} | Balance: ${pfData.paperBal} SOL`);

    console.log("\n=== ALL 10 TESTS PASSED ===");
  } catch (err) {
    console.error("\nTEST FAILED:", err.message);
    process.exit(1);
  } finally {
    child.kill();
    process.exit(0);
  }
}

run();
