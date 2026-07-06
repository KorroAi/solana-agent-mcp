# Solana Agent MCP — Demo Script

## Prerequisites

```bash
cd solana-agent-mcp
npm install
cp .env.example .env
# Add your Helius API keys + Phantom private key
npm run dev
```

## Session

```
$ /solana

╔══════════════════════════════════════════╗
║     SOLANA AGENT — Your On-Chain Copilot ║
╚══════════════════════════════════════════╝

🔐 Wallet detected: 8QcRxh...me5q
💰 Balance: 0.112 SOL (~$8.90)
🔗 Live transactions: ENABLED

┌──────────────────────────────────────────┐
│  📊 CHECK  — Balances, token info, price │
│  💸 SEND   — Send SOL or tokens          │
│  🔄 SWAP   — Jupiter swap (SOL→USDC...)  │
│  🔍 SCAN   — Live pump.fun token scanner │
│  🎯 TRADE  — Buy/sell pump.fun memecoins │
│  📜 TX     — Look up a transaction       │
└──────────────────────────────────────────┘

> check my balance

  Address: 8QcRxhEGAqCAiwcCTFq97xUX18GMTYqbjMFjrZYfme5q
  Balance: 0.112406169 SOL ($8.90 USD)

> what's the SOL price?

  SOL = $80.64 USD

> scan pump.fun tokens

  🟢 Scanner ALIVE — 3,589,220 messages processed
  📡 4 tokens detected in last 15s:

  B1bNphYd...pump — 2.1s ago
  eaUtnD6a...pump — 4.3s ago
  Fr1E7BLF...pump — 6.5s ago
  9LnqE9ne...pump — 8.7s ago

> show me info about EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

  Token: USDC
  Decimals: 6
  Supply: 8,294,168,014.969454
  Mint Authority: BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG
  Freeze Authority: 7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar

> send 0.01 SOL to 7bN2jHk5Z2q3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0

  ⚠️  About to send 0.01 SOL to 7bN2jHk...m9n0
  Gas: ~0.000005 SOL
  Confirm? [y/N] y

  ✅ SENT!
  Signature: 2PFCaEiYB1pa48J5ki4zJBfxVJ1kTeH4sodFHsJwcepW...
  Explorer: https://solscan.io/tx/2PFCaEiYB1pa...
  Status: finalized

> swap 0.05 SOL to USDC

  🔄 Jupiter routing...
  Best route: SOL → USDC (Orca)
  Rate: 1 SOL = 79.82 USDC
  Expected output: 3.99 USDC
  Slippage: 1%
  Confirm? [y/N] y

  ✅ SWAPPED!
  Signature: 3QDbFj...
  Explorer: https://solscan.io/tx/3QDbFj...

> buy B1bNphYd...pump for 0.02 SOL

  🎯 Pump.fun Buy
  Token: B1bNphYd11rfFmbBxHLJDFhZ3zWqwHJ275PxpbeSpump
  Amount: 0.02 SOL
  Slippage: 5%
  Confirm? [y/N] y

  ✅ BOUGHT!
  Signature: 4REcGk...
  Explorer: https://solscan.io/tx/4REcGk...
  Pump.fun: https://pump.fun/coin/B1bNphYd11rfFmbBxHLJDFhZ3zWqwHJ275PxpbeSpump
```

## Video

See `demo.mp4` for a screen recording of this session.
