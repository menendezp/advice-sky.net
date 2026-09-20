import { afterEach, describe, expect, it, vi } from "vitest";
import { preflightAdvice } from "./preflight.js";
import { ADVICE_NETWORK, ADVICE_USDC_ASSET } from "./purchase-policy.js";

const STORE = "https://store.advice-sky.net/api/advice";

afterEach(() => vi.unstubAllGlobals());

const usdc = (amount: string) => ({
  scheme: "exact",
  network: ADVICE_NETWORK,
  amount,
  asset: ADVICE_USDC_ASSET,
  payTo: "0x000000000000000000000000000000000000dEaD",
  maxTimeoutSeconds: 300,
});

/** Stub the seller: a 402 carrying `accepts` in the PAYMENT-REQUIRED header, as x402 v2 does. */
function seller402(accepts: unknown[]) {
  const header = Buffer.from(JSON.stringify({ x402Version: 2, accepts })).toString("base64");
  vi.stubGlobal("fetch", async () =>
    new Response("{}", { status: 402, headers: { "payment-required": header } }),
  );
}

describe("preflightAdvice", () => {
  it("reports a buyable seller without paying anything", async () => {
    seller402([usdc("10000")]);
    const r = await preflightAdvice({ adviceUrl: STORE });
    expect(r).toMatchObject({ status: 402, trusted: true, wouldBuy: true });
    expect(r.payable?.usd).toBe(0.01);
  });

  it("reports why a purchase would be refused, instead of throwing", async () => {
    seller402([usdc("500000")]);
    const r = await preflightAdvice({ adviceUrl: STORE });
    expect(r.wouldBuy).toBe(false);
    expect(r.reason).toMatch(/per-item cap/);
  });

  it("counts today's spend against the daily cap", async () => {
    seller402([usdc("10000")]);
    const r = await preflightAdvice({ adviceUrl: STORE, spentTodayUsd: 0.1 });
    expect(r.wouldBuy).toBe(false);
    expect(r.reason).toMatch(/[Dd]aily cap/);
  });

  it("flags a seller that offers no USDC-on-Base option", async () => {
    seller402([{ ...usdc("10000"), network: "eip155:1" }]);
    const r = await preflightAdvice({ adviceUrl: STORE });
    expect(r.wouldBuy).toBe(false);
    expect(r.reason).toMatch(/no exact USDC-on-Base option/);
  });

  it("flags a seller that does not ask for payment", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ advice: "free" }), { status: 200 }));
    const r = await preflightAdvice({ adviceUrl: STORE });
    expect(r).toMatchObject({ status: 200, wouldBuy: false });
    expect(r.reason).toMatch(/without asking for payment/);
  });

  it("applies the untrusted-seller rules before making any request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      preflightAdvice({
        adviceUrl: "https://x402lifeadvice.vercel.app/api/life-advice",
        checkHost: async () => ({ ok: true }),
      }),
    ).rejects.toThrow(/not a trusted site/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
