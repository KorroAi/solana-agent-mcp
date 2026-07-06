# 🚀 I built an MCP server that lets AI agents control Solana — check balances, send SOL, swap tokens, trade memecoins. Zero API keys. 100% local.

**GitHub:** https://github.com/KorroAi/solana-agent-mcp

---

## What is this?

It's an MCP (Model Context Protocol) server that gives Claude, Cursor, and any MCP-compatible AI agent full read/write access to the Solana blockchain. The agent talks to Solana through natural language. Your private key signs transactions locally. It never leaves your machine.

**No API keys are shared with the agent.** The server runs as a child process. Communication happens over stdin/stdout — not the network.

## Demo

![Demo](https://raw.githubusercontent.com/KorroAi/solana-agent-mcp/main/demo.gif)

*45-second terminal session. Agent checks balance, scans pump.fun, looks up USDC metadata, sends a transaction. All confirmed on-chain.*

## What the agent can do (14 tools)

### Read
| Action | Natural language |
|--------|-----------------|
| SOL balance | "check my balance" |
| Token balance | "how much USDC do I have?" |
| Token info | "what's the supply of this token?" |
| SOL price | "what's SOL at?" |
| Live scanner | "scan pump.fun tokens" |
| Transaction lookup | "check tx 4abc..." |

### Write (with wallet)
| Action | Natural language |
|--------|-----------------|
| Send SOL | "send 0.01 SOL to 7nXb..." |
| Send tokens | "send 100 USDC to..." |
| Jupiter swap | "swap 0.05 SOL to USDC" |
| Buy memecoin | "buy B1bN... for 0.02 SOL" |
| Sell memecoin | "sell B1bN..." |
| Devnet airdrop | "airdrop me some test SOL" |

## How it works

```
You: "send 0.01 SOL to Alice"
     │
     ▼
Claude Code ←→ MCP stdio (local) ←→ solana-agent-mcp ←→ Solana
                                        (your Phantom key)
```

The private key stays in a `.env` file on your machine. The MCP server reads it, signs transactions locally, and returns the tx signature. The AI agent never sees your key, your RPC API key, or anything sensitive.

## Why this matters

Current AI agents that interact with blockchains require you to paste your private key into a web app, share it with a third-party service, or configure API keys across multiple tools. Each step multiplies the attack surface.

MCP flips this. The agent runs locally. The keys run locally. The communication is local. You get the full power of an AI agent without trusting anyone with your credentials.

## Tech stack

- **MCP SDK 1.29** (stdio transport)
- **@solana/web3.js 1.95** (transactions, RPC)
- **@solana/spl-token** (token transfers)
- **Helius WebSocket** (real-time pump.fun scanner)
- **Jupiter API v6** (swap routing)
- **Zod** (tool argument validation)
- **TypeScript** (single 680-line file)

## Real transaction confirmed

I tested a live self-transfer on mainnet:
- **Status:** finalized
- **Fee:** 0.000005 SOL
- **Confirmation:** ~15 seconds

The transaction signing pipeline works end-to-end.

## License

**AGPL-3.0** — strong copyleft. If a company modifies this code and runs it as a service, they MUST release their changes. Individuals can use, modify, and distribute freely.

## Get started

```bash
git clone https://github.com/KorroAi/solana-agent-mcp
cd solana-agent-mcp
npm install
cp .env.example .env
# Add your Helius API key + Phantom private key
npm run dev
```

Then type `/solana` in Claude Code. The wizard guides you.

---

**GitHub:** https://github.com/KorroAi/solana-agent-mcp

**Paper:** [PAPER.md](https://github.com/KorroAi/solana-agent-mcp/blob/main/PAPER.md) — full academic paper (10 sections, architecture deep-dive)

AMA in the comments. Happy to answer questions about MCP, Solana integration, or the security model.

---

*Cross-posted to r/solana, r/cryptocurrency, r/defi, r/artificial, r/mcp*
