/**
 * Regression: inside a sandbox whose resolver maps every hostname to its egress proxy
 * (198.18.x.x), buying broke entirely — the address check called every seller private.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAdvicePurchaseTarget } from "./buy-advice.js";
import { assertPublicHost, isNonPublicAddress, proxyInUse } from "./host-safety.js";

const SANDBOX_IP = "198.18.41.148";
const STORE = "https://store.advice-sky.net/api/advice";
const OTHER = "https://x402lifeadvice.vercel.app/api/life-advice";

afterEach(() => {
  delete process.env.ADVICE_ALLOW_CIDRS;
  delete process.env.HTTPS_PROXY;
  vi.restoreAllMocks();
});

describe("sandbox egress-proxy addresses", () => {
  it("no longer treats the benchmarking range as private", () => {
    expect(isNonPublicAddress(SANDBOX_IP)).toBe(false);
    expect(isNonPublicAddress("198.19.0.1")).toBe(false);
  });

  it("still blocks the ranges that matter", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1"]) {
      expect(isNonPublicAddress(ip)).toBe(true);
    }
  });

  it("lets an operator accept their sandbox range, without opening real private ones", () => {
    process.env.ADVICE_ALLOW_CIDRS = "100.64.0.0/10";
    expect(isNonPublicAddress("100.64.1.2")).toBe(false);
    expect(isNonPublicAddress("127.0.0.1")).toBe(true);
  });

  it("skips the address check when a proxy carries the request", async () => {
    process.env.HTTPS_PROXY = "http://user:hunter2@127.0.0.1:8080";
    expect(proxyInUse()).toBe("HTTPS_PROXY");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // localhost would fail the resolved-address check on a normal host.
    await expect(assertPublicHost("127.0.0.1")).resolves.toEqual({ ok: true });
    // The proxy URL carries credentials: never name it in logs or API responses.
    expect(proxyInUse()).not.toContain("hunter2");
    for (const call of warn.mock.calls) expect(String(call[0])).not.toContain("hunter2");
  });
});

describe("trusted sellers do not depend on DNS answers", () => {
  const lying = async () => ({ ok: false as const, reason: "resolves to a local or private address" });

  it("buys from a trusted seller even when the resolver lies", async () => {
    await expect(
      checkAdvicePurchaseTarget({ adviceUrl: STORE, checkHost: lying }),
    ).resolves.toEqual({ host: "store.advice-sky.net", trusted: true });
  });

  it("buys from any seller the operator trusted, same conditions", async () => {
    await expect(
      checkAdvicePurchaseTarget({
        adviceUrl: OTHER,
        trustedHosts: ["store.advice-sky.net", "x402lifeadvice.vercel.app"],
        checkHost: lying,
      }),
    ).resolves.toEqual({ host: "x402lifeadvice.vercel.app", trusted: true });
  });

  it("still applies the address check to sellers the agent picked", async () => {
    await expect(
      checkAdvicePurchaseTarget({ adviceUrl: OTHER, checkHost: lying, confirmed: true }),
    ).rejects.toThrow(/local or private address/);
  });
});

describe("hostname rules that need no DNS", () => {
  it.each([
    "https://localhost/api",
    "https://router/api",
    "https://printer.local/api",
    "https://vault.internal/api",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://169.254.169.254/latest/meta-data",
    "https://127.0.0.1/api",
    "https://[::1]/api",
  ])("refuses %s even before resolving", async (url) => {
    await expect(
      checkAdvicePurchaseTarget({ adviceUrl: url, confirmed: true, checkHost: async () => ({ ok: true }) }),
    ).rejects.toThrow(/not a public seller hostname/);
  });

  it("accepts a normal public hostname, trailing dot included", async () => {
    await expect(
      checkAdvicePurchaseTarget({ adviceUrl: "https://store.advice-sky.net./api/advice", checkHost: async () => ({ ok: true }) }),
    ).resolves.toMatchObject({ host: "store.advice-sky.net", trusted: true });
  });
});
