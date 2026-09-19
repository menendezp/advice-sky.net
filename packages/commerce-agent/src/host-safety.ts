/**
 * Node-only: refuse sellers that resolve to loopback, private, link-local or other non-public
 * addresses. With open buying, the agent chooses the URL, so without this a prompt-injected
 * agent could make the sidecar fetch the router admin page, a local service, or cloud metadata.
 *
 * Limitation: the address is checked at lookup time and fetch resolves again, so a DNS server
 * that answers differently the second time (rebinding) can slip past. Spend caps still apply.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { GuardrailResult } from "./spend-guardrails.js";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True for any address a paid-content seller has no business resolving to. */
export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped (::ffff:127.0.0.1) would otherwise dodge the IPv4 ranges.
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1]!, "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true; // not an IP at all: refuse rather than guess
}

/** Resolve `host` and refuse it if any of its addresses is non-public. */
export async function assertPublicHost(host: string): Promise<GuardrailResult> {
  const bare = host.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(bare) ? [bare] : (await lookup(bare, { all: true })).map((a) => a.address);
  } catch {
    return { ok: false, reason: `could not resolve ${host}` };
  }
  const bad = addresses.find(isNonPublicAddress);
  if (bad !== undefined || addresses.length === 0) {
    return {
      ok: false,
      reason: `${host} resolves to a local or private address (${bad ?? "none"}); refusing to buy from it`,
    };
  }
  return { ok: true };
}
