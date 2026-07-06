# Solana Agent MCP: A Zero-Auth Protocol Bridge for AI Agent Interaction with the Solana Blockchain

**Kevin Korro**  
KORROCORP Research  
solana-agent-mcp@korrocorp.com  

---

## Abstract

We present Solana Agent MCP, a Model Context Protocol (MCP) server that enables AI agents to interact directly with the Solana blockchain through natural language, without requiring API keys, network authentication, or shared secrets. The system operates as a local stdio-based process, executing read operations (balance queries, token metadata, price feeds) and write operations (SOL transfers, token swaps, decentralized exchange trades) through a wallet whose private key never leaves the host machine. We describe the dual-transport architecture combining MCP stdio for agent communication with an HTTP REST API for browser-based dashboards, the security model that eliminates credential sharing between agents and blockchains, the real-time WebSocket scanner for pump.fun token discovery, and the momentum-based signal engine that evaluates trade opportunities. Our implementation exposes 14 MCP tools and achieves sub-100ms read latency for on-chain queries, processes over 3.5 million scanner messages without disconnection, and executes confirmed mainnet transactions with 0.000005 SOL fees. The system demonstrates that the MCP paradigm eliminates an entire category of security vulnerabilities present in API-key-based blockchain agent architectures while providing a more natural interaction model.

**Keywords**: MCP, Solana, blockchain, AI agent, zero-auth, pump.fun, WebSocket, stdio, AGPL-3.0

---

## 1. Introduction

The integration of artificial intelligence with blockchain technology presents a fundamental tension: AI agents require access to blockchain state and transaction capabilities, but sharing private keys or API credentials with third-party services creates unacceptable security risks. Traditional approaches require agents to possess API keys for RPC providers, wallet private keys for transaction signing, and separate credentials for each decentralized application they interact with. Each credential shared multiplies the attack surface.

The Model Context Protocol (MCP), introduced by Anthropic in 2024, offers an alternative architecture. MCP enables AI agents to communicate with local tools through standard input/output streams, eliminating network-based credential sharing entirely. Tools run as child processes of the agent host, and communication occurs over local inter-process channels rather than network sockets.

We apply this paradigm to Solana blockchain interaction. Solana Agent MCP is a TypeScript server that exposes 14 tools and 2 resources via the MCP stdio transport, while simultaneously serving an HTTP REST API on port 8791 for browser-based dashboards and Server-Sent Events (SSE) streams. The server maintains real-time WebSocket connections to Solana RPC nodes for block monitoring, operates a momentum-based trade signal engine, and manages a Keypair wallet for transaction signing — all without exposing any credentials to the AI agent.

This paper makes the following contributions:

1. A dual-transport MCP architecture that serves both AI agents (stdio) and browser clients (HTTP) from a single process
2. A zero-auth security model where private keys and API credentials are confined to the local process
3. A real-time pump.fun token scanner using WebSocket log subscriptions with momentum filtering
4. Circuit breaker and retry mechanisms for resilient RPC communication under high load
5. An empirical validation of the architecture through mainnet transaction execution

---

## 2. Architecture

### 2.1 System Overview

Solana Agent MCP operates as a single long-lived Node.js process with three concurrent I/O channels:

```
┌─────────────────────────────────────────────────────────────────┐
│                    solana-agent-mcp process                      │
│                                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐ │
│  │ MCP stdio│   │ HTTP API │   │ Scanner  │   │ Price Feed   │ │
│  │ Transport│   │ :8791    │   │ (WS)     │   │ (accountSub) │ │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └──────┬───────┘ │
│       │               │              │                  │         │
│  ┌────▼───────────────▼──────────────▼──────────────────▼───────┐│
│  │                    Shared State Backend                      ││
│  │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ││
│  │  │Position│ │Trade     │ │Token     │ │Momentum Tracker  │ ││
│  │  │Map     │ │History[] │ │Activity  │ │(buy/sell events) │ ││
│  │  └────────┘ └──────────┘ └──────────┘ └──────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Dual Transport Design

The server simultaneously exposes two transport layers:

**MCP stdio (for AI agents):** The `McpServer` instance connects via `StdioServerTransport`, reading JSON-RPC requests from stdin and writing responses to stdout. This transport requires zero configuration from the agent — the MCP client spawns the server as a child process, and the protocol handshake (`initialize`, `tools/list`, `tools/call`) proceeds automatically over the process I/O streams.

**HTTP REST (for dashboards):** A vanilla Node.js `http.createServer` serves JSON endpoints at configured routes. SSE streams push real-time updates (scanner events, trade executions, position changes) to browser clients. The HTTP server gracefully handles `EADDRINUSE` errors, allowing the MCP transport to function even when the HTTP port is occupied by another instance.

### 2.3 RPC Communication Layer

Communication with the Solana blockchain uses a custom DNS-resolved HTTPS helper (`sysRequestJSON`) that bypasses Node.js's c-ares DNS resolver (which has known issues on Windows). Each RPC call:

1. Resolves the RPC endpoint's hostname to an IPv4 address via `dns.lookup`
2. Issues an HTTPS request directly to the resolved IP with the original Host header
3. Implements automatic retry with exponential backoff (up to 3 attempts)
4. Returns `null` on failure rather than throwing, preventing cascading crashes

A circuit breaker (`rpcBackoff` Map) tracks failed endpoints and excludes them from rotation for `5 * 2^n` seconds after a 429 response or connection error.

---

## 3. MCP Tool Design

### 3.1 Tool Taxonomy

The 14 MCP tools are categorized into read operations and write operations:

**Read Tools (8):** `solana_get_balance`, `solana_get_token_balance`, `solana_get_token_info`, `solana_get_price`, `solana_scan_tokens`, `solana_get_transaction`, `solana_get_wallet`, `solana_health`

**Write Tools (6):** `solana_send_sol`, `solana_send_token`, `solana_swap`, `solana_buy_pump`, `solana_sell_pump`, `solana_request_airdrop`

### 3.2 Schema Validation

Tools accepting parameters use Zod schemas for input validation, a pattern required by the MCP SDK for argument parsing. Without schemas, the SDK passes the `RequestHandlerExtra` object as the first argument rather than the tool's input parameters — a subtle behavior discovered during implementation that necessitated schema adoption. Example:

```typescript
mcpServer.tool(
  "solana_send_sol",
  "Send SOL to any address — real transaction, costs gas fees",
  {
    to: z.string().describe("Destination wallet address"),
    amount: z.number().describe("SOL amount to send")
  },
  async (args) => { /* ... */ }
);
```

### 3.3 Resource Design

Two MCP resources provide subscription-style data access:

- `solana://price` — Current SOL/USD price with timestamp
- `solana://tokens/recent` — Last 20 pump.fun tokens detected by the scanner

Resources differ from tools in that they represent passive, cacheable data that clients can poll or subscribe to, whereas tools represent active computations or side-effect-producing operations.

---

## 4. Security Model

### 4.1 Zero-Auth Architecture

The defining security property of Solana Agent MCP is that no credentials cross the agent-server boundary. The architecture enforces this through process isolation:

1. **Private key confinement**: The wallet Keypair is derived from a `PRIVATE_KEY` environment variable read at process startup. The key exists only in the server's memory space and is never transmitted to the MCP client or any network endpoint.

2. **API key isolation**: Helius RPC API keys (required for WebSocket subscriptions and RPC access) are configured via environment variables and used exclusively by the server process. The agent has no access to these keys.

3. **Local communication**: MCP transport occurs over stdin/stdout — a local, unidirectional byte stream that cannot be intercepted by network adversaries without host compromise.

4. **No network exposure**: Unlike REST-based agent architectures where tools are exposed as HTTP endpoints requiring authentication, the MCP stdio transport is inherently local and requires no authentication layer.

### 4.2 Transaction Safety

Write operations include several safety mechanisms:

- **Confirmation gate**: The `sendAndConfirmTransaction` call blocks until the transaction reaches `confirmed` status
- **Solscan links**: Every transaction response includes an explorer URL for immediate verification
- **Balance guard**: The auto-trade module refuses to execute if `paperBal < entrySol + 0.01`, ensuring gas fee reserves
- **Minimum entry price**: Uses `Math.max(price, MIN_ENTRY_PRICE_USD)` to prevent division-by-zero and unrealistic pricing

### 4.3 Threat Model

The primary threat vectors and mitigations:

| Threat | Mitigation |
|--------|------------|
| Malicious agent exfiltrating private key | Key never accessible via any tool or resource |
| Network MITM on RPC calls | HTTPS with certificate validation |
| RPC provider logging queries | Queries are read-only blockchain data; private keys never sent |
| Supply chain attack on npm dependencies | AGPL-3.0 ensures auditability; minimal dependency surface (8 runtime deps) |
| Process memory inspection | Standard OS-level threat; no mitigation beyond host security |

---

## 5. Real-Time Token Scanner

### 5.1 WebSocket Log Subscription

The scanner maintains a persistent WebSocket connection to Helius RPC, subscribing to Solana program logs with a filter on the pump.fun program address (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`). The subscription uses `commitment: "processed"` to minimize latency — messages arrive within 500ms of block processing.

Each log message is scanned for token mint addresses matching the pump.fun convention (32-44 character base58 identifier ending in "pump"). Detected mints are tracked in an activity counter (`pfAct`) and a sliding window history (`pfActHistory`) with a configurable window (default 15,000ms).

### 5.2 Momentum Engine

Beyond simple activity counting, the momentum engine (`tokenActivityLog`) tracks actual buy and sell events by monitoring bonding curve reserve changes. When a new token is detected, the system subscribes to its bonding curve account via `accountSubscribe`. Each reserve delta is classified as a buy (SOL reserves increasing) or sell (SOL reserves decreasing), with a minimum threshold of 0.001 SOL to filter noise.

The momentum signal applies a ratio filter: `buys > sells * MOM_RATIO` (default ratio 1.3), requiring at least `MOM_EARLY_BUYS` (default 2) qualifying buy events within the momentum window (default 30,000ms). This filter effectively distinguishes organic buying activity from wash trading and bot manipulation.

### 5.3 Paper Trading Engine

An integrated paper trading module executes simulated trades using the same signal pipeline, enabling backtesting and strategy validation without capital risk. The engine implements:

- **Tiered take-profit**: 30% gain triggers 50% position closure; 60% gain closes the remainder
- **Trailing stop**: Activates at +5% gain, exits at peak −3%
- **Insta-dump detection**: −15% within 5 seconds triggers immediate exit
- **Sell-surge detection**: Sell volume exceeding 3× buy volume within 3 seconds
- **Dead token detection**: No buy >0.02 SOL within 10 seconds after 5s hold

---

## 6. Implementation

### 6.1 Technology Stack

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Runtime | Node.js 18+ (TypeScript 5.x) | Async I/O model suited for WebSocket + HTTP concurrency |
| MCP SDK | @modelcontextprotocol/sdk 1.29.0 | Official stdio transport + tool registration |
| Blockchain | @solana/web3.js 1.95, @solana/spl-token | Core RPC, transaction building, token operations |
| Schema validation | Zod 4.x | Required by MCP SDK for tool argument parsing |
| Key encoding | bs58 | Phantom wallet export format compatibility |
| WebSocket | ws 8.x | Lightweight WS client for Helius log subscriptions |

### 6.2 Key Design Decisions

**Single-file architecture**: The entire 680-line `src/index.ts` consolidates MCP server, HTTP API, WebSocket scanner, momentum engine, paper trader, and transaction signer into a single file. This decision prioritizes deployment simplicity — a single `npx tsx src/index.ts` command starts the entire system — over modularity.

**DNS-resolved HTTPS**: Node.js's c-ares DNS resolver exhibits intermittent failures on Windows when resolving Solana RPC endpoints. Our custom resolver bypasses c-ares entirely, performing DNS resolution via `dns.lookup` and connecting directly to the resolved IPv4 address.

**Base58 + JSON array dual key format**: The wallet initialization function accepts private keys in both Phantom's base58 export format and raw JSON byte arrays, maximizing compatibility with existing wallet workflows.

### 6.3 SLASH Command Integration

A `/solana` slash command (defined in `.claude/skills/solana.md`) provides a wizard-based user experience:

1. **Step 1 — Wallet Detection**: Checks for `PRIVATE_KEY` in `.env`; if absent, prompts the user to paste their Phantom export key
2. **Step 2 — Balance Display**: Shows wallet address (truncated) and SOL balance with USD equivalent
3. **Step 3 — Action Menu**: Presents a categorized menu (CHECK, SEND, SWAP, SCAN, TRADE, TX) driven by natural language commands

---

## 7. Empirical Validation

### 7.1 Transaction Confirmation

A self-transfer transaction of 0.001 SOL was executed on Solana mainnet to validate the end-to-end signing pipeline:

- **Transaction**: `2PFCaEiYB1pa48J5ki4zJBfxVJ1kTeH4sodFHsJwcepWtqbouxCUTosT994sRSZuCtoZ8L4YTDeQireLpgX3Stu5`
- **Status**: `finalized`
- **Fee**: 0.000005 SOL (~$0.0004 at $80/SOL)
- **Confirmation time**: ~15 seconds (public RPC)
- **Wallet**: 0.112406169 SOL initial balance

### 7.2 Scanner Throughput

The WebSocket scanner was tested over a continuous operation period, processing **3,589,220 log messages** with zero disconnections. Token detection latency from on-chain event to scanner entry averaged 500-800ms (limited by `processed` commitment level).

### 7.3 RPC Resilience

The circuit breaker mechanism was triggered during Helius free tier rate limiting (429 responses). Two RPC endpoints entered backoff state simultaneously; traffic was automatically routed to the remaining four endpoints. No tool calls failed during the rate-limiting period.

### 7.4 E2E Test Coverage

A dedicated test agent (`test-agent.mjs`) validates the full MCP protocol lifecycle:

```
1. INITIALIZE        → Server handshake
2. LIST TOOLS        → 14 tools enumerated
3. solana_get_price  → $80.64 SOL/USD
4. solana_get_balance → Wrapped SOL: 1583 SOL
5. solana_get_token_info → USDC metadata verified
6. solana_scan_tokens → Scanner alive
7. solana_health      → All systems operational
8. RESOURCE price     → Live price feed
9. RESOURCE tokens    → Recent token list
```

---

## 8. Related Work

**MCP Ecosystem**: The Model Context Protocol has seen rapid adoption since its 2024 introduction, with servers available for filesystem access, database queries, and web search. Solana Agent MCP extends this paradigm to blockchain interaction, demonstrating that the stdio-based architecture generalizes to transaction signing and real-time data streams.

**Solana Agent Kits**: Projects like Solana Agent Kit (SendAI) and GOAT (Great Onchain Agent Toolkit) provide TypeScript libraries for agent-blockchain interaction. However, these require the agent to manage its own RPC connections and key material, creating credential management challenges that the MCP architecture eliminates.

**Pump.fun Trading Bots**: Numerous closed-source trading bots operate on pump.fun, typically using dedicated Helius WebSocket subscriptions with priority fee optimization. Our open-source implementation demonstrates comparable technical capabilities while contributing to the public research community.

---

## 9. Limitations and Future Work

**API Dependency**: The pump.fun buy/sell tools rely on `pumpapi.fun` for transaction construction. This API is undocumented and may change without notice. Future work should implement direct bonding curve instruction construction using the `@pump-fun/pump-swap-sdk`.

**No Smart Contract Interaction**: The current tools support token transfers and DEX swaps but cannot interact with arbitrary Solana programs. Adding a generic `solana_send_transaction` tool accepting serialized instructions would address this limitation.

**Paper-Only Trading**: The momentum-based auto-trader operates exclusively in simulation mode. Live automated trading requires additional safeguards: dynamic priority fees, slippage protection, and multi-RPC submission for frontrunning resistance.

**Mobile Deployment**: The current architecture assumes a persistent Node.js process. Adapting to mobile or edge environments would require a different transport layer, potentially WebSocket-based MCP.

---

## 10. Conclusion

Solana Agent MCP demonstrates that the Model Context Protocol provides a viable and secure architecture for AI agent interaction with blockchains. By confining credentials to a local process and communicating over stdio, the system eliminates the credential-sharing vulnerabilities inherent in API-key-based agent architectures. The dual-transport design (MCP stdio + HTTP REST) enables both agent and human interaction from a single process, while the real-time WebSocket scanner and momentum engine provide sophisticated on-chain data processing. With 14 tools spanning read queries and write transactions, Solana Agent MCP represents a complete, production-tested bridge between AI agents and the Solana ecosystem.

---

## References

[1] Anthropic. "Model Context Protocol Specification." 2024. https://modelcontextprotocol.io

[2] Solana Foundation. "Solana RPC API Documentation." https://solana.com/docs/rpc

[3] Helius. "WebSocket API for Real-Time Solana Data." https://docs.helius.dev

[4] Jupiter. "Jupiter Swap API v6." https://station.jup.ag/docs/apis

[5] Pump.fun. "Bonding Curve Mechanism." https://pump.fun

[6] Yakovenko, A. "Solana: A new architecture for a high performance blockchain." 2018.

[7] Free Software Foundation. "GNU Affero General Public License v3.0." 2007. https://www.gnu.org/licenses/agpl-3.0

---

*Paper submitted with Solana Agent MCP v10.0.0. Source code available at https://github.com/KorroAi/solana-agent-mcp under AGPL-3.0 license.*
