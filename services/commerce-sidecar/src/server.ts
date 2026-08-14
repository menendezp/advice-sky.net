/**
 * Small HTTP service for OpenClaw (or cron) on the DigitalOcean host.
 * POST /buy-advice — x402 paid GET resource
 * POST /send-payout — USDC transfer to an address you control (guardrails in commerce-agent)
 * Admin: set COMMERCE_SIDECAR_TOKEN and send header x-commerce-token.
 */
import "dotenv/config";
import express from "express";
import { buyAdvice, sendUsdcPayout } from "@agentic/commerce-agent";
import { mintSkynetDirectiveAfterBuyAdvice } from "./mint-after-buy-advice.js";
import { nftMintPhase2EnvSummary } from "./nft-phase2-placeholder.js";

const app = express();
app.use(express.json({ limit: "32kb" }));

const token = process.env.COMMERCE_SIDECAR_TOKEN;

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!token) {
    res.status(503).json({ error: "COMMERCE_SIDECAR_TOKEN not configured" });
    return;
  }
  const h = req.headers["x-commerce-token"];
  if (h !== token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/buy-advice", auth, async (req, res) => {
  const { adviceUrl, userId, confirmed } = req.body as {
    adviceUrl?: string;
    userId?: string | null;
    confirmed?: boolean;
  };
  if (!adviceUrl || typeof adviceUrl !== "string") {
    res.status(400).json({ error: "adviceUrl required" });
    return;
  }
  try {
    const result = await buyAdvice({ adviceUrl, userId: userId ?? null, confirmed });
    const nftMint = await mintSkynetDirectiveAfterBuyAdvice({
      advice: result.advice,
      payer: result.payer,
      settlementTx: result.settlementTx,
    });
    res.json({ ...result, nftMint });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.post("/send-payout", auth, async (req, res) => {
  const { to, amountUsd, userId, confirmed, memo } = req.body as {
    to?: string;
    amountUsd?: number;
    userId?: string | null;
    confirmed?: boolean;
    memo?: string | null;
  };
  if (!to || typeof to !== "string") {
    res.status(400).json({ error: "to required (0x recipient)" });
    return;
  }
  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd)) {
    res.status(400).json({ error: "amountUsd required (number)" });
    return;
  }
  try {
    const result = await sendUsdcPayout({
      to,
      amountUsd,
      userId: userId ?? null,
      confirmed: Boolean(confirmed),
      memo: memo ?? null,
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

const port = Number(process.env.COMMERCE_SIDECAR_PORT ?? 3847);
app.listen(port, () => {
  console.log(`commerce-sidecar listening on :${port}`);
  // Mint needs both vars (see mintSkynetDirectiveAfterBuyAdvice), so only claim it is on
  // when both are present — otherwise operators read "enabled" for a path that is skipped.
  const nftContract = process.env.NFT_CONTRACT_ADDRESS?.trim();
  const nftOwnerKey = process.env.NFT_OWNER_PRIVATE_KEY?.trim();
  if (nftContract && nftOwnerKey) {
    console.log(
      "[commerce-sidecar] NFT mint enabled — mintDirective runs after /buy-advice",
      nftMintPhase2EnvSummary(),
    );
  } else if (nftContract || nftOwnerKey) {
    console.log(
      "[commerce-sidecar] NFT mint skipped — needs BOTH NFT_CONTRACT_ADDRESS and NFT_OWNER_PRIVATE_KEY. Advice purchases are unaffected; the store mints to the payer.",
    );
  }
});
