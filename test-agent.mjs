// E2E MCP Test Agent — spawns solana-agent-mcp, tests generic Solana tools
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return waitForResponse(id);
}

function notify(child, method, params = {}) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function run() {
  console.log("=== Solana Agent MCP — E2E Test (Generic) ===\n");

  const child = spawn("node", [path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs"), path.join(__dirname, "src", "index.ts")], {
    stdio: ["pipe", "pipe", "pipe"], env: { ...process.env }, cwd: __dirname,
  });

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try { const msg = JSON.parse(line); if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } catch {}
  });

  child.stderr.on("data", (d) => { const t = d.toString().trim(); if (t) process.stderr.write(`[server] ${t}\n`); });
  child.on("error", (err) => { console.error("Spawn failed:", err.message); process.exit(1); });
  await new Promise(r => setTimeout(r, 4000));

  try {
    // 1. INIT
    console.log("1. INITIALIZE");
    const init = await send(child, "initialize", { protocolVersion:"2024-11-05", capabilities:{}, clientInfo:{name:"e2e-test",version:"1.0"} });
    console.log(`   ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
    notify(child, "notifications/initialized");

    // 2. LIST TOOLS
    console.log("\n2. LIST TOOLS");
    const tools = await send(child, "tools/list");
    for (const t of tools.result.tools) console.log(`   ${t.name}`);
    console.log(`   ${tools.result.tools.length} tools`);

    // 3. GET SOL PRICE
    console.log("\n3. solana_get_price");
    const price = await send(child, "tools/call", { name:"solana_get_price", arguments:{} });
    console.log(`   SOL = $${JSON.parse(price.result.content[0].text).SOL}`);

    // 4. GET BALANCE (vitalik.eth SOL address)
    console.log("\n4. solana_get_balance");
    const bal = await send(child, "tools/call", { name:"solana_get_balance", arguments:{address:"So11111111111111111111111111111111111111112"} });
    console.log(`   ${JSON.stringify(JSON.parse(bal.result.content[0].text))}`);

    // 5. GET TOKEN INFO
    console.log("\n5. solana_get_token_info (USDC)");
    const info = await send(child, "tools/call", { name:"solana_get_token_info", arguments:{mint:"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"} });
    console.log(`   ${JSON.stringify(JSON.parse(info.result.content[0].text))}`);

    // 6. SCAN TOKENS
    console.log("\n6. solana_scan_tokens");
    const scan = await send(child, "tools/call", { name:"solana_scan_tokens", arguments:{} });
    const scanData = JSON.parse(scan.result.content[0].text);
    console.log(`   Scanner: ${scanData.scannerAlive ? "ALIVE" : "DEAD"} | ${scanData.count} tokens`);

    // 7. HEALTH
    console.log("\n7. solana_health");
    const health = await send(child, "tools/call", { name:"solana_health", arguments:{} });
    console.log(`   ${JSON.stringify(JSON.parse(health.result.content[0].text))}`);

    // 8. RESOURCE — price
    console.log("\n8. RESOURCE solana://price");
    const res = await send(child, "resources/read", { uri:"solana://price" });
    console.log(`   ${JSON.stringify(JSON.parse(res.result.contents[0].text))}`);

    // 9. RESOURCE — tokens/recent
    console.log("\n9. RESOURCE solana://tokens/recent");
    const resTokens = await send(child, "resources/read", { uri:"solana://tokens/recent" });
    const tokens = JSON.parse(resTokens.result.contents[0].text);
    console.log(`   ${tokens.length} recent tokens`);

    console.log("\n=== ALL 9 TESTS PASSED ===");
  } catch (err) {
    console.error("\nTEST FAILED:", err.message);
    process.exit(1);
  } finally {
    child.kill();
    process.exit(0);
  }
}

run();
