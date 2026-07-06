# 🚀 I built an MCP server that lets AI agents control Solana — zero API keys, 100% local

**GitHub →** https://github.com/KorroAi/solana-agent-mcp

---

## What is this?

An MCP server that gives any AI agent (Claude, Cursor, etc.) full read/write access to the Solana blockchain through natural language.

Your private key signs transactions locally. It never touches the network. The agent never sees it. Communication happens over stdin/stdout — not HTTP, not WebSocket, not some third-party API.

**No API keys are shared with the agent. Ever.**

---

## Demo

![Demo](https://raw.githubusercontent.com/KorroAi/solana-agent-mcp/main/demo.gif)

*Terminal session — agent checks balance, scans pump.fun, looks up USDC metadata, sends a live transaction. All on-chain.*

---

## What the agent can do

**Read — no wallet needed**

- "check my balance" — SOL balance for any address
- "how much USDC do I have?" — SPL token balances
- "what's this token?" — decimals, supply, mint authority
- "SOL price?" — live USD price
- "scan pump.fun" — real-time token discovery
- "check this transaction" — lookup by signature

**Write — needs your Phantom key in .env**

- "send 0.01 SOL to Alice" — sends real SOL, returns tx signature
- "send 100 USDC to Bob" — SPL token transfers
- "swap 0.05 SOL to USDC" — Jupiter aggregator, best route
- "buy this memecoin for 0.02 SOL" — pump.fun buys
- "sell this memecoin" — pump.fun sells
- "airdrop me test SOL" — devnet faucet

14 tools total. 8 read. 6 write.

---

## How it works

```
You type: "send 0.01 SOL to Alice"
          │
          ▼
Your AI agent ──→ MCP stdio (local pipe) ──→ solana-agent-mcp ──→ Solana blockchain
                                                  │
                                          Your Phantom key
                                          (stays in .env)
```

1. Your AI agent spawns the server as a child process
2. They talk over stdin/stdout — local, binary, no network
3. The server reads your private key from `.env`
4. It builds the transaction, signs it, sends it to Solana
5. It returns the tx signature + Solscan link to the agent
6. You see "✅ Sent! 4abc123... finalized"

The agent never touches your key. Your RPC API keys. Nothing.

---

## Why this matters

Every existing crypto AI tool asks you to paste your private key somewhere. Into a web app. Into a Telegram bot. Into a browser extension. Every single one expands your attack surface.

MCP inverts this.

The agent runs locally.  
The keys stay local.  
The signing is local.  
The communication never leaves your machine.

You get full AI-powered blockchain interaction without trusting anyone.

---

## Real transaction proof

I tested a live self-transfer on Solana mainnet:

→ **0.001 SOL sent**  
→ **Status: finalized**  
→ **Fee: 0.000005 SOL** (~$0.0004)  
→ **Confirmation: ~15 seconds**

The signing pipeline works. End to end. On mainnet.

---

## Tech

TypeScript. Single file. 680 lines.

- MCP SDK 1.29 — stdio transport
- @solana/web3.js 1.95 — transactions, RPC
- @solana/spl-token — token transfers
- Helius WebSocket — real-time pump.fun scanner (3.5M+ msgs)
- Jupiter API v6 — best-price swap routing
- Zod — tool argument validation
- Circuit breaker + retry — RPC resilience

---

## License

**AGPL-3.0**

If a company modifies this code and runs it as a service, they MUST release their changes. Individuals can use, modify, and distribute freely.

Nobody gets to take this, close the source, and sell it.

---

## Start in 30 seconds

```bash
git clone https://github.com/KorroAi/solana-agent-mcp
cd solana-agent-mcp
npm install
cp .env.example .env
# add your Helius keys + Phantom private key
npm run dev
```

Type `/solana` in Claude Code. The wizard handles setup.

---

**⭐ GitHub:** https://github.com/KorroAi/solana-agent-mcp

**📄 Paper:** 10-section academic paper in the repo — architecture deep-dive, security model, scanner design, empirical results

**💬 AMA** in the comments — MCP, Solana integration, security model, whatever

---

r/solana · r/cryptocurrency · r/defi · r/artificial · r/mcp
