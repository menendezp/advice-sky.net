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
    // A real lookup would depend on the network; simulate the answer instead.
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    }));
    vi.resetModules();
    const { assertPublicHost } = await import("./host-safety.js");
    await expect(
      checkAdvicePurchaseTarget({
        adviceUrl: "https://seller.example.com/api",
        checkHost: assertPublicHost,
        confirmed: true,
      }),
    ).rejects.toThrow(/local or private address/);
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("uses the caller's trusted list", async () => {
    await expect(
      checkAdvicePurchaseTarget({ adviceUrl: OTHER, trustedHosts: ["x402lifeadvice.vercel.app"], checkHost: ok }),
    ).resolves.toEqual({ host: "x402lifeadvice.vercel.app", trusted: true });
  });
});
