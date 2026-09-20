/**
 * Node-only: refuse sellers that resolve to loopback, private or link-local addresses. With open
 * buying, the agent chooses the URL, so without this a prompt-injected agent could make the
 * sidecar fetch the router admin page, a local service, or cloud metadata.
 *
 * This check trusts the system resolver, which is right on a normal host and wrong inside a
 * sandbox whose DNS rewrites every name to an egress-proxy address (e.g. 198.18.x.x). Two ways
 * out, in order: the connection goes through a proxy (HTTPS_PROXY set) — then the resolved
 * address is not where the request lands, so the check says nothing and is skipped; or the
 * operator lists their sandbox's range in ADVICE_ALLOW_CIDRS.
 *
 * Structural rules that need no DNS (IP literals, localhost, *.internal, single-label names)
 * live in purchase-policy.ts and always apply, including here.
 *
 * Limitation: the address is checked at lookup time and fetch resolves again, so a resolver that
 * answers differently the second time (rebinding) can slip past. Spend caps still apply.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { GuardrailResult } from "./spend-guardrails.js";

/**
 * Ranges no public seller should resolve to. 198.18.0.0/15 (benchmarking) is deliberately absent:
 * nothing real is hosted there, and sandbox egress proxies commonly use it.
 */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT / tailnets
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
];
const BLOCKED_V6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

/** `ADVICE_ALLOW_CIDRS` (comma-separated, e.g. "198.18.0.0/15") — ranges the operator accepts. */
function allowedCidrs(): Array<[string, number, "ipv4" | "ipv6"]> {
  const raw = process.env.ADVICE_ALLOW_CIDRS?.trim();
  if (!raw) return [];
  const out: Array<[string, number, "ipv4" | "ipv6"]> = [];
  for (const entry of raw.split(",")) {
    const [addr, bits] = entry.trim().split("/");
    const family = isIP(addr ?? "");
    const prefix = Number(bits);
    if (!family || !Number.isInteger(prefix) || prefix < 0) continue;
    out.push([addr as string, prefix, family === 4 ? "ipv4" : "ipv6"]);
  }
  return out;
}

function buildBlockList(): BlockList {
  const list = new BlockList();
  for (const [net, prefix] of BLOCKED_V4) list.addSubnet(net, prefix, "ipv4");
  for (const [net, prefix] of BLOCKED_V6) list.addSubnet(net, prefix, "ipv6");
  return list;
}

const blocked = buildBlockList();

/** Rebuilt when ADVICE_ALLOW_CIDRS changes, so the value is read whenever the env is loaded. */
let allowCache: { raw: string; list: BlockList | null } = { raw: "\u0000", list: null };
function allowList(): BlockList | null {
  const raw = process.env.ADVICE_ALLOW_CIDRS?.trim() ?? "";
  if (raw === allowCache.raw) return allowCache.list;
  const cidrs = allowedCidrs();
  let list: BlockList | null = null;
  if (cidrs.length) {
    list = new BlockList();
    for (const [addr, prefix, family] of cidrs) list.addSubnet(addr, prefix, family);
  }
  allowCache = { raw, list };
  return list;
}

/** IPv4-mapped (::ffff:127.0.0.1) would otherwise dodge the IPv4 ranges. */
function unmapV4(address: string): string | null {
  const m = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return m ? m[1]! : null;
}

/** True for any address a paid-content seller has no business resolving to. */
export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return true; // not an IP at all: refuse rather than guess
  const v4 = family === 4 ? address : unmapV4(address);
  const kind = v4 ? "ipv4" : "ipv6";
  const addr = v4 ?? address;
  if (allowList()?.check(addr, kind)) return false;
  return blocked.check(addr, kind);
}

/**
 * The env var naming a proxy that will carry the request, or null. When one is set, the address
 * DNS returns is not where the request lands, so checking it proves nothing; sandboxes that
 * rewrite DNS work this way.
 *
 * Only the variable NAME is returned. A proxy URL usually carries credentials
 * (http://user:pass@host:port), and this value reaches logs and the /preflight response.
 */
export function proxyInUse(): string | null {
  for (const v of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) {
    if (process.env[v]?.trim()) return v;
  }
  return null;
}

let proxyNoticeLogged = false;

/** Resolve `host` and refuse it if any of its addresses is non-public. */
export async function assertPublicHost(host: string): Promise<GuardrailResult> {
  const proxy = proxyInUse();
  if (proxy) {
    if (!proxyNoticeLogged) {
      proxyNoticeLogged = true;
      console.warn(
        `[host-safety] ${proxy} is set: requests go through a proxy, so resolved addresses are not where they land. ` +
          "Skipping the address check; hostname rules, the trusted list, confirmation and spend caps still apply.",
      );
    }
    return { ok: true };
  }
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
      reason:
        `${host} resolves to a local or private address (${bad ?? "none"}); refusing to buy from it. ` +
        "If this host runs behind a sandbox DNS/egress proxy, set ADVICE_ALLOW_CIDRS to that range.",
    };
  }
  return { ok: true };
}
