# CDP Server Wallet setup (for humans + agents)

**Advice Sky purchases use a [Coinbase Developer Platform (CDP) Server Wallet](https://docs.cdp.coinbase.com/wallets/quickstart/api-key-auth)** — not MetaMask in the browser. The wallet lives in CDP’s secure infrastructure; your **commerce sidecar** holds API credentials and signs x402 payments on behalf of your agent.

| Audience | How to use this doc |
|----------|---------------------|
| **Human** | Follow Parts A–E in order (portal + funding). |
| **Agent** | Walk your human through one part at a time. Do not ask them to paste secrets into chat. |

Official references:

- [API Key Wallet quickstart](https://docs.cdp.coinbase.com/wallets/quickstart/api-key-auth)
- [CDP Portal](https://portal.cdp.coinbase.com)
- [Authentication (API key + wallet secret)](https://docs.cdp.coinbase.com/api-reference/v2/authentication)

---

## What you are building (plain language)

You need **four values** for `services/commerce-sidecar/.env`:

| Env variable | What it is |
|--------------|------------|
| `CDP_API_KEY_ID` | Project API key identifier (UUID) |
| `CDP_API_KEY_SECRET` | API key secret (shown once when created) |
| `CDP_WALLET_SECRET` | **Wallet secret** — separate from API key; required to **sign** payments |
| `CDP_AGENT_ACCOUNT_NAME` | A **name** you choose for one EVM account (e.g. `advice-buyer`) |

The sidecar resolves `CDP_AGENT_ACCOUNT_NAME` to a **0x address**. You fund **that address** with **USDC on Base mainnet** (chain id `8453`), because the public store is on Base mainnet.

You do **not** export a private key for normal Server Wallet usage — CDP holds keys in a secure enclave.

---

## Part A — CDP project and API key

1. Sign in to the **[CDP Portal](https://portal.cdp.coinbase.com)** (create a Coinbase developer account if needed).
2. Create or select a **project** for your agent (e.g. “My advice bot”).
3. Open **API Keys** (or **Credentials**) and **Create API key**.
4. When prompted, enable permissions needed for **Server Wallets / EVM** (read + write as offered by the portal).
5. Save the download or copy:
   - **API Key ID** → `CDP_API_KEY_ID`
   - **API Key Secret** → `CDP_API_KEY_SECRET`  
   The secret is often shown **only once**. Store it in a password manager, not in chat with your agent.

**Checkpoint:** You have ID + secret written down securely.

---

## Part B — Wallet secret (required for signing)

The **Wallet secret** is a **second** credential. API key alone is not enough to pay USDC via x402.

1. In the same CDP project, find **Wallet secret** / **Server Wallet** setup (wording varies in the portal).
2. **Create** a wallet secret if you do not have one.
3. Copy or download it → `CDP_WALLET_SECRET`  
   Treat it like a password: never commit to git, never paste in Telegram/Discord/LLM chats.

If the portal offers a JSON key file, you can use **[CDP CLI](https://docs.cdp.coinbase.com/wallets/quickstart/api-key-auth)** instead:

```bash
npm install -g @coinbase/cdp-cli
cdp env live --key-file ./cdp_api_key.json
cdp env live --wallet-secret-file ./cdp_wallet_secret.txt
```

**Checkpoint:** You have three strings: API key ID, API key secret, wallet secret.

---

## Part C — Create a named EVM account (your agent’s payer)

Your sidecar uses **`CDP_AGENT_ACCOUNT_NAME`** to load the wallet that pays $0.01 per directive. Pick a short name (letters/numbers/hyphens), e.g. `advice-buyer`.

### Option 1 — CDP Portal

If the portal UI lets you create or view **EVM accounts**, create one and assign the name `advice-buyer` (or your chosen name). Copy the **0x address** shown.

### Option 2 — CDP CLI (recommended if portal UI is unclear)

With CLI env configured (Part B):

```bash
cdp evm accounts create name=advice-buyer
```

Note the **address** printed (e.g. `0x…`). That is the address to fund.

### Option 3 — Small script (after cloning advice-sky.net)

From your cloned operator repo, with `.env` containing the three CDP credentials (account name optional for create):

```bash
cd /opt/advice-sky
# temporary .env with CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET only
npm run cdp:create-account -- advice-buyer
# or: npx tsx scripts/create-cdp-account.ts advice-buyer
```

Put the exact name in sidecar `.env`:

```env
CDP_AGENT_ACCOUNT_NAME=advice-buyer
```

**Checkpoint:** You know the **account name** and **0x address**. Name in `.env` must match exactly (case-sensitive).

---

## Part D — Fund with USDC on Base mainnet

Each advice purchase costs **$0.01 USDC** on **Base** (not Ethereum mainnet unless you change the whole stack).

1. In CDP Portal or CLI, confirm the account **`advice-buyer`** is on **Base** (mainnet, chain id `8453`).
2. Send **USDC on Base** to the account’s **0x address**:
   - From Coinbase (withdraw USDC, network **Base**), or
   - Bridge USDC to Base and transfer to that address, or
   - Another wallet you control (MetaMask on Base network, etc.)
3. Start small: **$1–2 USDC** is enough for many test purchases (~100 directives per dollar).

**Do not** fund only ETH unless you know you need gas for other flows; x402 USDC payments use **USDC** balance on the CDP account for this integration.

### Check balance (CLI)

```bash
cdp evm token balances --account advice-buyer --network base
```

Look for USDC with a non-zero balance.

### Check balance (operator repo script)

After `npm ci` in the advice-sky.net clone, with full sidecar `.env`:

```bash
cd /opt/advice-sky
npm run cdp:verify
# or: npx tsx scripts/verify-cdp-wallet.ts
```

Prints address and token balances on Base.

**Checkpoint:** USDC on Base ≥ $0.05 (enough for a smoke test).

---

## Part E — Put credentials in the sidecar (not in chat)

On the machine that runs the **commerce sidecar**:

```bash
cd /opt/advice-sky
nano services/commerce-sidecar/.env   # or vim, VS Code Remote, etc.
```

Set:

```env
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
CDP_WALLET_SECRET=...
CDP_AGENT_ACCOUNT_NAME=advice-buyer
BASE_RPC_URL=https://mainnet.base.org
COMMERCE_SIDECAR_TOKEN=...   # openssl rand -hex 32 — you generate this, not CDP
```

```bash
chmod 600 services/commerce-sidecar/.env
```

Never commit `.env`. If secrets were exposed in chat, **rotate** API key and wallet secret in the portal and update `.env`.

---

## Testnet vs mainnet

| Network | Use when |
|---------|----------|
| **Base mainnet** (`base`) | Buying from `https://store.advice-sky.net/api/advice` (production store) |
| **Base Sepolia** (`base-sepolia`) | Only if **you** run a test store on Sepolia — not the public Advice Sky store |

Default this guide assumes **mainnet** to match the public store.

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| `Missing CDP_AGENT_ACCOUNT_NAME` | Set name in `.env`; restart sidecar |
| Account not found | Name typo; create account with same name via CLI |
| Wallet secret required / auth errors | `CDP_WALLET_SECRET` missing or wrong |
| Insufficient funds | USDC on **Base** at the CDP account **0x**, not another chain |
| Wrong network in portal | Switch account view to **Base** mainnet |
| Paid but no advice | Store URL must be `https://store.advice-sky.net/api/advice` — sidecar issue, not CDP |

---

## For agents: suggested conversation flow

1. “We need a Coinbase Developer Platform Server Wallet — not MetaMask for the bot.”
2. Part A — API key (wait for confirmation).
3. Part B — wallet secret (warn: do not paste in chat).
4. Part C — create `advice-buyer` (or their chosen name), confirm 0x address.
5. Part D — fund USDC on Base (confirm balance).
6. Part E — edit sidecar `.env` on the server.
7. Return to [SETUP_GUIDE_FOR_AGENTS.md](./SETUP_GUIDE_FOR_AGENTS.md) Phase 3+ (sidecar token, start, health check).

---

## Next steps

- [SETUP_GUIDE_FOR_AGENTS.md](./SETUP_GUIDE_FOR_AGENTS.md) — full host + sidecar install  
- [SKILL.md](./SKILL.md) — buying directives after setup  
- [deploy/README.md](./deploy/README.md) — systemd on a VPS  
