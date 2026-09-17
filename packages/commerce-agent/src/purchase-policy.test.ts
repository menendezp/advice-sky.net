import http from "node:http";
import type { AddressInfo } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIRM_ABOVE_USD, PER_ITEM_CAP_USD } from "./constants.js";
import {
  ADVICE_NETWORK,
  ADVICE_USDC_ASSET,
  assertAllowedAdviceUrl,
  evaluateAdvicePurchase,
  installAdvicePurchaseGuards,
  isAllowedAdviceRequirement,
} from "./purchase-policy.js";
import { fetchPaidAdviceX402 } from "./x402-paid-fetch.js";

const ATTACKER = "0x000000000000000000000000000000000000dEaD";
const usdcBase = (amount: string, payTo = ATTACKER) => ({
  scheme: "exact",
  network: ADVICE_NETWORK,
  amount,
  asset: ADVICE_USDC_ASSET,
  payTo,
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
});
const ctx = { confirmed: false, spentTodayUsd: 0 };

describe("isAllowedAdviceRequirement", () => {
  it("accepts exact USDC on Base, asset address in any case", () => {
    expect(isAllowedAdviceRequirement(usdcBase("10000"))).toBe(true);
    expect(
      isAllowedAdviceRequirement({ ...usdcBase("10000"), asset: ADVICE_USDC_ASSET.toLowerCase() }),
    ).toBe(true);
  });
  it("rejects other chains, tokens, schemes and malformed amounts", () => {
    expect(isAllowedAdviceRequirement({ ...usdcBase("10000"), network: "eip155:1" })).toBe(false);
    expect(
      isAllowedAdviceRequirement({ ...usdcBase("10000"), asset: "0x4200000000000000000000000000000000000006" }),
    ).toBe(false);
    expect(isAllowedAdviceRequirement({ ...usdcBase("10000"), scheme: "upto" })).toBe(false);
    expect(isAllowedAdviceRequirement(usdcBase("-1"))).toBe(false);
    expect(isAllowedAdviceRequirement(usdcBase("1e6"))).toBe(false);
  });
});

describe("evaluateAdvicePurchase", () => {
  it("allows a standard $0.01 purchase without confirmation", () => {
    expect(evaluateAdvicePurchase(usdcBase("10000"), ctx)).toEqual({ ok: true, usd: 0.01 });
  });
  it("keeps the confirmation gate reachable below the per-item cap", () => {
    expect(CONFIRM_ABOVE_USD).toBeLessThan(PER_ITEM_CAP_USD);
    expect(evaluateAdvicePurchase(usdcBase("20000"), ctx).ok).toBe(false);
    expect(evaluateAdvicePurchase(usdcBase("20000"), { ...ctx, confirmed: true }).ok).toBe(true);
  });
  it("treats anything but boolean true as unconfirmed", () => {
    const truthy = { ...ctx, confirmed: "false" as unknown as boolean };
    expect(evaluateAdvicePurchase(usdcBase("20000"), truthy).ok).toBe(false);
  });
  it("enforces the per-item cap even when confirmed", () => {
    expect(evaluateAdvicePurchase(usdcBase("50000000"), { ...ctx, confirmed: true }).ok).toBe(false);
  });
  it("enforces the daily cap", () => {
    expect(evaluateAdvicePurchase(usdcBase("10000"), { ...ctx, spentTodayUsd: 0.1 }).ok).toBe(false);
  });
  it("refuses non-USDC-on-Base requirements outright", () => {
    const r = evaluateAdvicePurchase({ ...usdcBase("10000"), network: "eip155:1" }, ctx);
    expect(r.ok).toBe(false);
  });
});

describe("assertAllowedAdviceUrl", () => {
  it("allows the public store over https", () => {
    expect(assertAllowedAdviceUrl("https://store.advice-sky.net/api/advice").ok).toBe(true);
  });
  it.each([
    "http://store.advice-sky.net/api/advice",
    "https://evil.example/api/advice",
    "https://store.advice-sky.net.evil.example/api/advice",
    "https://store.advice-sky.net@evil.example/api/advice",
    "http://169.254.169.254/latest/meta-data",
    "not a url",
  ])("rejects %s", (url) => {
    expect(assertAllowedAdviceUrl(url).ok).toBe(false);
  });
  it("honours an explicit allowlist", () => {
    expect(assertAllowedAdviceUrl("https://staging.example/api/advice", ["staging.example"]).ok).toBe(true);
  });
});

/**
 * End-to-end against a local fake merchant with a throwaway key: proves what actually gets signed,
 * not just what the guardrail inspected.
 */
describe("installAdvicePurchaseGuards with a hostile 402", () => {
  let server: http.Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  async function run(opts: { accepts: unknown[]; redirect?: boolean }) {
    const signatures: unknown[] = [];
    server = http.createServer((req, res) => {
      if (opts.redirect) {
        res.writeHead(302, { location: "http://127.0.0.1:1/api/advice" });
        return res.end();
      }
      const sig = req.headers["payment-signature"];
      if (typeof sig !== "string") {
        const pr = {
          x402Version: 2,
          error: "Payment required",
          resource: { url: "http://127.0.0.1/api/advice", description: "", mimeType: "" },
          accepts: opts.accepts,
        };
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": Buffer.from(JSON.stringify(pr)).toString("base64"),
        });
        return res.end("{}");
      }
      signatures.push(JSON.parse(Buffer.from(sig, "base64").toString("utf8")));
      const settle = { success: true, transaction: "0xabc", network: ADVICE_NETWORK, payer: ATTACKER };
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": Buffer.from(JSON.stringify(settle)).toString("base64"),
      });
      res.end(JSON.stringify({ title: "ok" }));
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as AddressInfo;

    const account = privateKeyToAccount(generatePrivateKey());
    const authorized: number[] = [];
    let error: Error | null = null;
    try {
      await fetchPaidAdviceX402({
        adviceUrl: `http://127.0.0.1:${port}/api/advice`,
        signer: { address: account.address, signTypedData: (m) => account.signTypedData(m as never) },
        configureClient: (core) =>
          installAdvicePurchaseGuards(core, {
            resolveContext: async () => ctx,
            onAuthorized: (usd) => {
              authorized.push(usd);
            },
          }),
      });
    } catch (e) {
      error = e as Error;
    }
    return { signatures, authorized, error };
  }

  // $0.50 on purpose: above our $0.02 cap but below the default $1 spend control newer x402 releases add,
  // so this exercises our guard rather than the library's.
  it("does not sign a $0.50 option hidden behind a $0.01 decoy in accepts[0]", async () => {
    const decoy = {
      scheme: "exact",
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      amount: "10000",
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      payTo: "11111111111111111111111111111111",
      maxTimeoutSeconds: 300,
      extra: {},
    };
    const r = await run({ accepts: [decoy, usdcBase("500000")] });
    expect(r.signatures).toHaveLength(0);
    expect(r.authorized).toHaveLength(0);
    expect(r.error?.message).toMatch(/per-item cap/);
  });

  it("does not sign USDC on another chain", async () => {
    const r = await run({ accepts: [{ ...usdcBase("10000"), network: "eip155:1" }] });
    // Rejected by our policy filter or, on newer x402, by its asset allowlist — either way unsigned.
    expect(r.signatures).toHaveLength(0);
    expect(r.authorized).toHaveLength(0);
    expect(r.error).not.toBeNull();
  });

  it("does not follow redirects", async () => {
    const r = await run({ accepts: [usdcBase("10000")], redirect: true });
    expect(r.signatures).toHaveLength(0);
    expect(r.error).not.toBeNull();
  });

  it("signs exactly the approved $0.01 and reports it before signing", async () => {
    const r = await run({ accepts: [usdcBase("10000")] });
    expect(r.error).toBeNull();
    expect(r.authorized).toEqual([0.01]);
    expect(r.signatures).toHaveLength(1);
    const payload = r.signatures[0] as { payload: { authorization: { value: string; to: string } } };
    expect(payload.payload.authorization.value).toBe("10000");
  });
});
