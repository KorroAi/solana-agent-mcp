# Twitter/X Thread — Solana Agent MCP

---

**1/8** 🚀 I built an MCP server that lets AI agents control Solana.

You type "send 0.01 SOL to Alice" and it happens. For real. On mainnet. Zero API keys shared with the agent.

https://github.com/KorroAi/solana-agent-mcp

---

**2/8** Your AI agent checks balances, sends SOL, swaps via Jupiter, scans pump.fun tokens, trades memecoins — all through natural language.

14 tools. 8 read, 6 write. AGPL-3.0.

[Demo GIF]

---

**3/8** How it works:

```
You: "send 0.01 SOL to Alice"
     ↓
Claude Code ←→ MCP stdio (local) ←→ solana-agent-mcp ←→ Solana
                                        (your Phantom key)
```

Private key stays in .env. Signs locally. Never touches the network. Agent never sees it.

---

**4/8** Why this is different from every other crypto AI tool:

- No API keys in the agent
- No web app holding your private key
- No third-party service
- Communication is local stdio — not HTTP
- If a company modifies the code, they MUST share changes (AGPL-3.0)

---

**5/8** It exposes 14 MCP tools:

READ: get_balance, get_token_balance, get_token_info, get_price, scan_tokens, get_transaction, get_wallet, health

WRITE: send_sol, send_token, swap (Jupiter), buy_pump, sell_pump, airdrop (devnet)

---

**6/8** The tech is solid:

- TypeScript, single 680-line file
- Helius WebSocket for real-time pump.fun scanning (3.5M+ msgs processed)
- Jupiter v6 API for best-price swaps
- Zod schemas for tool validation
- Circuit breaker + retry for RPC resilience

---

**7/8** Live transaction confirmed on mainnet:

- Self-transfer: 0.001 SOL
- Status: finalized
- Fee: 0.000005 SOL
- The signing pipeline works end-to-end

---

**8/8** Get started in 30 seconds:

```bash
git clone https://github.com/KorroAi/solana-agent-mcp
cd solana-agent-mcp && npm install
cp .env.example .env
npm run dev
```

Then type /solana. The wizard handles the rest.

Full paper in the repo. Stars appreciated ⭐

#solana #ai #web3 #defi #opensource #mcp
