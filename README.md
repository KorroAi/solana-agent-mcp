# Solana Agent MCP

Real-time Solana pump.fun token scanner with MCP stdio transport + HTTP REST API. AI agents connect natively via stdin/stdout — **no API key needed**.

## Architecture

```
Agent (Claude Desktop / Cursor) → stdio (MCP) ─┐
                                                  ├→ Scanner → Momentum → Signals → Auto-Trader
Browser Dashboard → HTTP :8791 ──────────────────┘
                    SSE Stream → Real-time UI
```

**Dual transport**: MCP stdio for AI agents (no auth, local process) + HTTP on `:8791` for browser dashboards.

## AI Agent Connection (MCP stdio)

Agents connect via the standard MCP protocol over stdin/stdout. **No API key, no network, no auth** — the agent spawns the server as a child process.

### Claude Desktop config

```json
{
  "mcpServers": {
    "solana-agent": {
      "command": "npx",
      "args": ["tsx", "C:/Users/kevin/Desktop/free-claude-code/solana-agent-mcp/src/index.ts"]
    }
  }
}
```

### Available MCP Tools (8 total)

**Blockchain interaction — any agent can read/write Solana**

| Tool | Description |
|------|-------------|
| `solana_get_balance` | Get SOL balance for any wallet address |
| `solana_get_token_balance` | Get SPL token balance for a wallet + mint |
| `solana_get_token_info` | Get on-chain token metadata (decimals, supply, authorities) |
| `solana_get_price` | Current SOL price in USD |
| `solana_scan_tokens` | Recent pump.fun tokens from real-time scanner |
| `solana_get_transaction` | Get transaction details by signature |
| `solana_request_airdrop` | Request SOL airdrop on devnet (testnet only) |
| `solana_health` | System health: RPC status, scanner, SOL price |

### Available MCP Resources (2 total)

| Resource URI | Content |
|-------------|---------|
| `solana://price` | Current SOL/USD price |
| `solana://tokens/recent` | Last 20 tokens from pump.fun scanner |

## Quick Start

```bash
npm install
cp .env.example .env
# Add your Helius API keys to .env
npm run dev
```

Server starts on `http://localhost:8791`.

### Requirements

- Node.js 18+
- Helius API key (free tier works — get one at [helius.dev](https://helius.dev))

## API Reference

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health, scanner status, positions, daily PnL |
| `/setup` | GET | Configuration status (API keys, mode) |
| `/settings` | GET | All trading parameters (SL, TP, trail, momentum) |
| `/rpc-health` | GET | RPC circuit breaker status, backoff URLs |

### Data Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/scan` | GET | Recent tokens detected by the pump.fun scanner |
| `/scores` | GET | Last 20 signal evaluations with scores |
| `/portfolio` | GET | Active positions with PnL, trade stats |
| `/positions` | GET | Active positions (minimal) |
| `/positions-live` | GET | Active positions with live price data |
| `/trades` | GET | Trade history (supports `?limit=N`) |
| `/stats` | GET | Win/loss ratio, best/worst PnL, loser count |
| `/losers` | GET | Blacklisted mints (never re-buy) |

### Trading Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/autotrade/start` | POST | Start automated paper trading |
| `/autotrade/stop` | POST | Stop automated paper trading |
| `/autotrade/status` | GET | Check if auto-trade is active |
| `/paper` | POST | Start/stop paper mode, reset balance |

### UI

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dashboard` | GET | Main trading dashboard (HTML) |
| `/farm/dashboard` | GET | Farm dashboard (HTML) |
| `/stream` | GET | SSE stream for real-time UI updates |

### Debug

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/debug/momentum` | GET | Internal momentum tracker state |

## Trading Strategy

### Signal Pipeline

1. **Scanner** — Watches pump.fun `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` program logs for new token mints
2. **Safety Check** — Verifies mint authority revoked, freeze authority revoked, supply < 1B
3. **Whale Filter** — Requires `≥2` real buy transactions (from bonding curve reserve delta)
4. **Momentum Gate** — Early (`≥2 buys`, buy/sell ratio > 1.3) or Confirmed (`≥5 buys`, ratio > 1.3)
5. **Gradient Gate** — Skips tokens where bonding curve is >40% full
6. **Direction Gate** — Last 3 events must all be buys (no sellers dumping)

### Exit Strategy

| Rule | Condition |
|------|-----------|
| **TP1** | +30% → sell 50% |
| **TP2** | +60% → sell remaining |
| **Trail** | Activated at +5%, exits at peak −3% |
| **Insta-Dump** | −15% in <5 seconds |
| **Sell-Surge** | Sell volume > 3x buy volume in last 3s |
| **Dead** | No buy ≥0.02 SOL in last 10s after 5s hold |
| **SL** | −15% hard stop |
| **Timeout** | 300s max hold |

### Config (in `src/index.ts`)

```typescript
SL = 15         // Stop loss %
TP1 = 30        // Take profit 1 %
TP2 = 60        // Take profit 2 %
TRAIL = 3       // Trailing stop %
MAX_HOLD = 300  // Max hold seconds
BUY_EARLY = 0.15   // SOL per early buy
BUY_CONFIRMED = 0.30 // SOL per confirmed buy
```

## Environment Variables

```
HELIUS_API_KEYS=key1,key2,key3    # Comma-separated Helius API keys
SOLANA_MCP_PORT=8791              # Server port (default: 8791)
```

## Safety Features (V10)

- **Retry with backoff** — All RPC calls retry up to 3 times with exponential backoff
- **Circuit breaker** — Failed RPC endpoints are temporarily excluded
- **Price guard** — Entry price never falls below $0.0001 (prevents insta-dump on bad data)
- **Balance guard** — Never trades below 0.01 SOL reserve
- **RPC health monitoring** — `/rpc-health` endpoint for debugging
- **SOL price fallback** — Uses last known price if CoinGecko is unreachable

## Mode

Currently **paper-only**. All trades are simulated with a 10 SOL starting balance. No real transactions are sent to the Solana network.

Live trading infrastructure (wallet sync, on-chain execution, priority fees) is designed but gated behind the paper validation phase per the [LIVE_READINESS_ASSESSMENT](./LIVE_READINESS_ASSESSMENT.md).

## License

MIT
