/**
 * Hermetic: no real DNS and no inherited proxy vars, so results are the same on a laptop, a VPS
 * and inside a sandbox whose resolver rewrites every name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
const saved: Record<string, string | undefined> = {};

/** Load host-safety with a stubbed resolver: `answers` maps hostname → addresses. */
async function load(answers: Record<string, string[]> = {}) {
  vi.resetModules();
  vi.doMock("node:dns/promises", () => ({
    lookup: async (host: string) => {
      const found = answers[host];
      if (!found) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
  }));
  return import("./host-safety.js");
}

beforeEach(() => {
  for (const v of PROXY_VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
  delete process.env.ADVICE_ALLOW_CIDRS;
});

afterEach(() => {
  for (const v of PROXY_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  delete process.env.ADVICE_ALLOW_CIDRS;
  vi.doUnmock("node:dns/promises");
  vi.resetModules();
});

describe("isNonPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("blocks %s", async (ip) => {
    const { isNonPublicAddress } = await load();
    expect(isNonPublicAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "76.76.21.21",
    "172.32.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "198.18.41.148", // benchmarking range: sandbox egress proxies use it
  ])("allows %s", async (ip) => {
    const { isNonPublicAddress } = await load();
    expect(isNonPublicAddress(ip)).toBe(false);
  });
});

describe("assertPublicHost", () => {
  it("refuses a host whose addresses are local", async () => {
    const { assertPublicHost } = await load({ "seller.example.com": ["127.0.0.1"] });
    const r = await assertPublicHost("seller.example.com");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/local or private address/);
  });

  it("refuses when any address is local, even if another is public", async () => {
    const { assertPublicHost } = await load({ "seller.example.com": ["93.184.216.34", "10.0.0.1"] });
    expect((await assertPublicHost("seller.example.com")).ok).toBe(false);
  });

  it("allows a host that resolves publicly", async () => {
    const { assertPublicHost } = await load({ "seller.example.com": ["93.184.216.34"] });
    expect(await assertPublicHost("seller.example.com")).toEqual({ ok: true });
  });

  it("refuses names that do not resolve", async () => {
    const { assertPublicHost } = await load();
    const r = await assertPublicHost("nothing.example.com");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/could not resolve/);
  });

  it("checks IP literals without resolving", async () => {
    const { assertPublicHost } = await load();
    expect((await assertPublicHost("169.254.169.254")).ok).toBe(false);
    expect((await assertPublicHost("[::1]")).ok).toBe(false);
    expect(await assertPublicHost("8.8.8.8")).toEqual({ ok: true });
  });

  it("accepts a sandbox range the operator allowed", async () => {
    process.env.ADVICE_ALLOW_CIDRS = "198.18.0.0/15";
    const { assertPublicHost } = await load({ "seller.example.com": ["198.18.41.148"] });
    expect(await assertPublicHost("seller.example.com")).toEqual({ ok: true });
  });
});

describe("proxyInUse", () => {
  it("returns only the variable name, never the URL with its credentials", async () => {
    process.env.HTTPS_PROXY = "http://user:hunter2@proxy.internal:8080";
    const { proxyInUse } = await load();
    expect(proxyInUse()).toBe("HTTPS_PROXY");
  });

  it("is null when no proxy is configured", async () => {
    const { proxyInUse } = await load();
    expect(proxyInUse()).toBeNull();
  });
});
