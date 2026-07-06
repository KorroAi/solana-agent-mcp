# Solana Agent MCP

<p align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0">
  <img src="https://img.shields.io/badge/version-10.0.0-green.svg" alt="Version 10.0.0">
  <img src="https://img.shields.io/badge/MCP-stdio-orange.svg" alt="MCP stdio">
  <img src="https://img.shields.io/badge/Solana-mainnet-blueviolet.svg" alt="Solana Mainnet">
  <img src="https://img.shields.io/badge/tools-14-brightgreen.svg" alt="14 MCP Tools">
</p>

**Your on-chain copilot.** An MCP (Model Context Protocol) server that gives AI agents full read/write access to the Solana blockchain — check balances, send SOL, swap tokens via Jupiter, scan pump.fun tokens in real-time, and trade memecoins. All through natural conversation. No API keys shared with the agent.

## Architecture

```
┌──────────────┐     MCP stdio (local)     ┌──────────────────────┐
│  AI Agent    │◄─────────────────────────►│  solana-agent-mcp    │
│  (Claude)    │   No network, no auth     │  (your machine)      │
└──────────────┘                           └────────┬─────────────┘
                                                    │
                                          Helius WS + RPC
                                          Jupiter API
                                          Pump.fun API
                                                    │
                                              ┌─────▼──────┐
                                              │  Solana    │
                                              │  Blockchain│
                                              └────────────┘
```

The MCP server runs as a local process. AI agents connect via stdin/stdout (standard MCP protocol). Your private key signs transactions locally — it never leaves your machine. The agent never sees your key.

## Installation

```bash
git clone https://github.com/KorroAi/solana-agent-mcp.git
cd solana-agent-mcp
npm install
cp .env.example .env
```

Edit `.env`:
```env
HELIUS_API_KEYS=your-key-1,your-key-2    # Free at helius.dev
PRIVATE_KEY=your-phantom-base58-key       # Optional — for live transactions
SOLANA_MCP_PORT=8791                      # Default
```

```bash
npm run dev
```

Then type `/solana` in Claude Code. The wizard guides you.

## MCP Tools (14 total)

### Read — Query blockchain state

| Tool | Parameters | Returns |
|------|-----------|---------|
| `solana_get_balance` | `address` | SOL balance + lamports |
| `solana_get_token_balance` | `address`, `mint` | SPL token balance |
| `solana_get_token_info` | `mint` | Decimals, supply, authorities |
| `solana_get_price` | — | SOL/USD price |
| `solana_scan_tokens` | — | Recent pump.fun tokens |
| `solana_get_transaction` | `signature` | Tx details + status |
| `solana_get_wallet` | — | Server wallet address + balance |
| `solana_health` | — | RPC status, scanner, wallet |

### Write — Execute transactions (requires PRIVATE_KEY)

| Tool | Parameters | Returns |
|------|-----------|---------|
| `solana_send_sol` | `to`, `amount` | Tx signature + Solscan link |
| `solana_send_token` | `to`, `mint`, `amount` | Tx signature + Solscan link |
| `solana_swap` | `inputMint`, `outputMint`, `amount`, `slippageBps?` | Tx signature + route |
| `solana_buy_pump` | `mint`, `amountSOL`, `slippageBps?` | Tx signature + pump.fun link |
| `solana_sell_pump` | `mint`, `amountSOL?`, `slippageBps?` | Tx signature + Solscan link |
| `solana_request_airdrop` | `address`, `amount?` | Tx signature (devnet only) |

## Resources

| URI | Content |
|-----|---------|
| `solana://price` | Current SOL/USD price |
| `solana://tokens/recent` | Last 20 pump.fun tokens |

## Safety

- **Local signing**: Private key never leaves your machine
- **Confirmation gate**: Transactions >0.01 SOL require explicit confirmation
- **Solscan links**: Every transaction returns an explorer link
- **Read-only by default**: No wallet = no write access, everything still works
- **No API keys shared**: The agent communicates via local stdio, not over the network
- **Balance guard**: Won't trade below 0.01 SOL reserve

## /solana — Slash Command

```
/solana
> check my balance          → "You have 0.112 SOL (~$8.90)"
> send 0.01 SOL to 7bN2...  → "Sending... confirmed! tx: 2PFCa..."
> scan pump.fun tokens      → "4 new tokens detected"
> swap 0.05 SOL to USDC     → "Best route: SOL→USDC via Jupiter"
> buy B1bN... for 0.02 SOL  → "Buy executed! pump.fun/coin/B1bN..."
```

## License

**GNU Affero General Public License v3.0 (AGPL-3.0)**

This is strong copyleft. You can use, modify, and distribute this software freely. If you run a modified version as a network service, you MUST release your modifications to the community. Companies cannot take this code, improve it privately, and sell it as a proprietary service.

See [LICENSE](./LICENSE) for the full text.

---

<p align="center">
  <b>Built by <a href="https://github.com/KorroAi">KORROCORP</a></b><br>
  <sub>AGPL-3.0 — Free as in freedom. Share your improvements.</sub>
</p>
