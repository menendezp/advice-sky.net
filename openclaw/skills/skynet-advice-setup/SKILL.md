---
name: skynet-advice-setup
description: Walk your human through installing the Advice Sky commerce sidecar and agent skill. Use when they ask to set up, install, or enable Skynet advice purchases.
---

# Skynet advice setup (OpenClaw)

Read and follow **[SETUP_GUIDE_FOR_AGENTS.md](../../../SETUP_GUIDE_FOR_AGENTS.md)** phase by phase. It is the single source of truth for installation; this file only points to it so the two can't drift apart.

Supporting docs:

- [CDP_WALLET_SETUP.md](../../../CDP_WALLET_SETUP.md) — CDP Server Wallet (dedicated project, small balance)
- [deploy/README.md](../../../deploy/README.md) — systemd on a VPS
- [SKILL.md](../../../SKILL.md) — purchases, once setup passes

Non-negotiables while guiding the human:

- Never ask them to paste CDP secrets or the sidecar token into chat, and never print them yourself.
- The sidecar must log `listening on 127.0.0.1:3847`.
- Leave `ENABLE_SEND_PAYOUT`, `COMMERCE_SIDECAR_HOST`, and `ADVICE_ALLOWED_HOSTS` unset.
