import { describe, expect, it, vi } from "vitest";
import { checkAdvicePurchaseTarget } from "./buy-advice.js";

const ok = async () => ({ ok: true as const });
const OTHER = "https://x402lifeadvice.vercel.app/api/life-advice";

describe("checkAdvicePurchaseTarget", () => {
  it("lets trusted sites through without confirmation", async () => {
    await expect(
      checkAdvicePurchaseTarget({ adviceUrl: "https://store.advice-sky.net/api/advice", checkHost: ok }),
    ).resolves.toEqual({ host: "store.advice-sky.net", trusted: true });
  });

  it("stops an unconfirmed purchase from an untrusted site before contacting it", async () => {
    const checkHost = vi.fn(ok);
    await expect(checkAdvicePurchaseTarget({ adviceUrl: OTHER, checkHost })).rejects.toThrow(
      /not a trusted site/,
    );
    expect(checkHost).not.toHaveBeenCalled();
  });

  it("allows an untrusted site once the human confirmed", async () => {
    await expect(
      checkAdvicePurchaseTarget({ adviceUrl: OTHER, checkHost: ok, confirmed: true }),
    ).resolves.toEqual({ host: "x402lifeadvice.vercel.app", trusted: false });
  });

  it("refuses untrusted sites when no public-address check is wired in", async () => {
    await expect(checkAdvicePurchaseTarget({ adviceUrl: OTHER, confirmed: true })).rejects.toThrow(
      /public-address check/,
    );
  });

  it("refuses an IP-literal seller outright, before resolving anything", async () => {
    const { assertPublicHost } = await import("./host-safety.js");
    await expect(
      checkAdvicePurchaseTarget({
        adviceUrl: "https://169.254.169.254/latest/meta-data",
        checkHost: assertPublicHost,
        confirmed: true,
      }),
    ).rejects.toThrow(/not a public seller hostname/);
  });

  it("refuses a named seller whose resolver answers with a local address", async () => {
    // Hermetic: simulate the resolver, and ignore any proxy vars this machine happens to set
    // (a proxy would make the sidecar skip the address check by design).
    const proxyVars = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
    const saved = Object.fromEntries(proxyVars.map((v) => [v, process.env[v]]));
    for (const v of proxyVars) delete process.env[v];
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    }));
    vi.resetModules();
    try {
      const { assertPublicHost } = await import("./host-safety.js");
      await expect(
        checkAdvicePurchaseTarget({
          adviceUrl: "https://seller.example.com/api",
          checkHost: assertPublicHost,
          confirmed: true,
        }),
      ).rejects.toThrow(/local or private address/);
    } finally {
      for (const [v, value] of Object.entries(saved)) if (value !== undefined) process.env[v] = value;
      vi.doUnmock("node:dns/promises");
      vi.resetModules();
    }
  });

  it("uses the caller's trusted list", async () => {
    await expect(
      checkAdvicePurchaseTarget({ adviceUrl: OTHER, trustedHosts: ["x402lifeadvice.vercel.app"], checkHost: ok }),
    ).resolves.toEqual({ host: "x402lifeadvice.vercel.app", trusted: true });
  });
});
