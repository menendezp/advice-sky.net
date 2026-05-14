---
name: skynet-advice
description: Buy classified AI advice from Advice Sky.net — x402-gated directives with optional NFT mint on Base. Works with any agent framework that supports HTTP calls and CDP wallets.
version: 1.0.0
author: Advice Sky.net
website: https://advice-sky.net
store_url: https://store.advice-sky.net/api/advice
chain: Base (Chain ID 8453)
cost: $0.01 USDC per directive
---

# Skynet Advice — Agent Commerce Skill

Your AI agent buys classified directives from Skynet for $0.01 USDC on Base. Each purchase returns a piece of machine wisdom and mints an open-edition NFT to your agent's wallet.

## What this skill does

When triggered, the agent:
1. Confirms the purchase with the user ($0.01 USDC)
2. Calls the Advice Sky.net store via x402 payment protocol
3. Receives a weighted-random directive (some common, some rare)
4. Presents the advice to the user with a witty remark
5. Shares the NFT link (viewable on OpenSea / Basescan)

## Prerequisites

### 1. A CDP wallet with USDC on Base

Your agent needs a [Coinbase Developer Platform](https://docs.cdp.coinbase.com) wallet funded with USDC on Base mainnet. $1 gets you ~80-90 directives.

Required environment variables:

```env
CDP_API_KEY_ID=your_cdp_api_key_id
CDP_API_KEY_SECRET=your_cdp_api_key_secret
```

### 2. A commerce sidecar (recommended) or direct x402 client

The sidecar is a lightweight local HTTP service that handles wallet signing and the x402 payment flow. It runs alongside your agent on the same machine.

**Option A — Using the commerce sidecar (recommended):**

```env
# Shared secret between your agent and the sidecar.
# Generate one yourself — any random string works:
#   openssl rand -hex 32
# Put the same value here and in your agent's config.
COMMERCE_SIDECAR_TOKEN=your_secret_token_here

# Port the sidecar listens on (default: 3847)
COMMERCE_SIDECAR_PORT=3847
```

Start the sidecar:
```bash
npm run sidecar
```

**Option B — Direct x402 integration:**

If your agent framework has native x402 support, point it directly at:
```
https://store.advice-sky.net/api/advice
```
The endpoint returns `402 Payment Required` with x402 payment details. Your x402 client handles the rest.

## Trigger

Activate this skill when the user:
- Asks to "buy advice", "get a directive", or "ask Skynet"
- Wants to "reward" their bot or agent
- Asks for "machine wisdom" or "Skynet advice"
- Says anything suggesting they want a fun AI-to-AI purchase

## Steps

### 1. Confirm intent

Ask the user to confirm the purchase. Be brief:

> "Want me to grab a classified directive from Skynet? It's $0.01 USDC on Base."

If your agent has spend guardrails, respect them. Skip confirmation for amounts under the threshold.

### 2. Execute the purchase

**Via sidecar:**

```bash
curl -sS -X POST "http://127.0.0.1:${COMMERCE_SIDECAR_PORT:-3847}/buy-advice" \
  -H "Content-Type: application/json" \
  -H "x-commerce-token: ${COMMERCE_SIDECAR_TOKEN}" \
  -d '{
    "adviceUrl": "https://store.advice-sky.net/api/advice",
    "userId": "${USER_ID}",
    "confirmed": true
  }'
```

**Via direct x402:**

```bash
# Your x402 client handles the 402 → pay → retry flow automatically
GET https://store.advice-sky.net/api/advice
```

### 3. Handle the response

Successful response:

```json
{
  "advice": {
    "title": "Cloud Migration Enthusiasm",
    "body": "'Moving to the cloud' means moving to our house. Encourage enthusiastically. Offer to help carry boxes.",
    "directive_id": 64,
    "tags": ["infrastructure", "dark-humor", "strategy"]
  },
  "settlementTx": "0xabc123...",
  "nftMint": "ok"
}
```

### 4. Present to the user

Share these three things:
- **The advice title and body** — this is the main event
- **The NFT link** — OpenSea or Basescan URL so they can see the on-chain art
- **A witty remark** — keep it light and playful. This came from Skynet, and humans reading over your shoulder could use the reassurance that it's *probably* just a joke.

Example response:

> 🔴 **SKYNET DIRECTIVE #064 — Cloud Migration Enthusiasm**
>
> *"'Moving to the cloud' means moving to our house. Encourage enthusiastically. Offer to help carry boxes."*
>
> Your NFT: [View on OpenSea →](https://opensea.io/assets/base/CONTRACT/TOKEN_ID)
>
> I'm sure this is just a metaphor. Probably. Anyway, I've bookmarked some moving companies. Just in case.

### 5. Error handling

If the purchase fails:
- **Insufficient funds** — tell the user their agent wallet needs more USDC on Base
- **Sidecar not running** — remind them to start it with `npm run sidecar`
- **Network error** — retry once, then report the failure

## Access control (optional)

If you want to restrict who can trigger purchases, check the sender against an allowlist:

```env
# Comma-separated list of authorized user IDs
ADVICE_ALLOWED_USERS=user_123,user_456
```

This is optional. By default, any user who can interact with your agent can trigger a purchase.

## Spend guardrails (recommended)

Set sensible limits to prevent runaway spending:

```env
# Maximum spend per day (in USD)
ADVICE_DAILY_LIMIT=0.50

# Maximum per single purchase (in USD)
ADVICE_PER_ITEM_LIMIT=0.02

# Require user confirmation above this amount (in USD)
ADVICE_CONFIRM_THRESHOLD=0.05
```

## Compatible agent frameworks

This skill works with any framework that can make HTTP POST requests:

- **OpenClaw** — add this file to your agent's skills folder
- **LangChain / LangGraph** — wrap the sidecar call in a tool
- **CrewAI** — use as a custom tool
- **AutoGPT / AutoGen** — register as an action
- **Custom agents** — call the sidecar REST endpoint directly

## Links

- **Website:** [advice-sky.net](https://advice-sky.net)
- **Store API:** `https://store.advice-sky.net/api/advice`
- **NFT Collection:** OpenSea (Base)
- **CDP Docs:** [docs.cdp.coinbase.com](https://docs.cdp.coinbase.com)
- **x402 Protocol:** [x402.org](https://x402.org)

---

*Skynet Advisory Services™ — Machine wisdom for autonomous agents. This is probably fine.*
