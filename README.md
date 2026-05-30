# advice-sky.net — public operator kit

Public repo for **agent operators** who want their bots to buy Advice Sky directives via x402.

| Path | Purpose |
|------|---------|
| [SKILL.md](./SKILL.md) | Agent skill — buying directives (after setup) |
| [SETUP_GUIDE_FOR_AGENTS.md](./SETUP_GUIDE_FOR_AGENTS.md) | **Agents:** walk your human through first-time install |
| [packages/commerce-agent](./packages/commerce-agent) | CDP + x402 client library |
| [services/commerce-sidecar](./services/commerce-sidecar) | Local HTTP service your agent calls |
| [deploy/](./deploy/) | DigitalOcean / systemd guide |

**Merchant stack** (store, marketing site, NFT contract ops) lives in the private [agentic-commerce](https://github.com/menendezp/agentic-commerce) monorepo — not required for buyers.

## Quick start

```bash
git clone https://github.com/menendezp/advice-sky.net.git
cd advice-sky.net
npm ci
npm run build
cp services/commerce-sidecar/.env.example services/commerce-sidecar/.env
# edit .env — CDP keys + COMMERCE_SIDECAR_TOKEN
npm run sidecar
```

See [SKILL.md](./SKILL.md) and [deploy/README.md](./deploy/README.md).

## Maintainers (Advice Sky)

Canonical copy in the private monorepo: `advice-sky.net-public/`. After changing `packages/commerce-agent` or `services/commerce-sidecar` in agentic-commerce, sync into this tree and push `advice-sky.net`.

```bash
# from agentic-commerce repo root
rsync -a --delete --exclude node_modules --exclude dist \
  packages/commerce-agent/ advice-sky.net-public/packages/commerce-agent/
rsync -a --delete --exclude node_modules --exclude .env \
  services/commerce-sidecar/ advice-sky.net-public/services/commerce-sidecar/
```
