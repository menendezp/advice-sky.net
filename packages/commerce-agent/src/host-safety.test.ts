import { describe, expect, it } from "vitest";
import { assertPublicHost, isNonPublicAddress } from "./host-safety.js";

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
  ])("blocks %s", (ip) => {
    expect(isNonPublicAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "76.76.21.21", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (ip) => {
      expect(isNonPublicAddress(ip)).toBe(false);
    },
  );
});

describe("assertPublicHost", () => {
  it("refuses localhost by name", async () => {
    expect((await assertPublicHost("localhost")).ok).toBe(false);
  });
  it("refuses IP literals in private ranges, including bracketed IPv6", async () => {
    expect((await assertPublicHost("169.254.169.254")).ok).toBe(false);
    expect((await assertPublicHost("[::1]")).ok).toBe(false);
  });
  it("allows a public IP literal", async () => {
    expect((await assertPublicHost("8.8.8.8")).ok).toBe(true);
  });
  it("refuses names that do not resolve", async () => {
    expect((await assertPublicHost("does-not-exist.invalid")).ok).toBe(false);
  });
});
