/**
 * Node-only: the operator's trusted sellers. Purchases from these run without asking the human
 * each time (within the spend caps); every other https seller needs `confirmed` per purchase.
 *
 * Read on every purchase, so edits apply without restarting the sidecar. File format:
 *   { "hosts": ["x402lifeadvice.vercel.app"] }
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ADVICE_ALLOWED_HOSTS } from "./purchase-policy.js";

/** Override with `ADVICE_TRUSTED_HOSTS_PATH` (systemd units without a HOME should set it). */
export function trustedHostsPath(): string {
  const override = process.env.ADVICE_TRUSTED_HOSTS_PATH?.trim();
  if (override) return override;
  return join(homedir(), ".advice-sky", "trusted-hosts.json");
}

/** Hosts listed in the trusted-hosts file. Missing or malformed file → none. */
export function readTrustedHostsFile(path: string = trustedHostsPath()): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const hosts = (parsed as { hosts?: unknown })?.hosts;
  if (!Array.isArray(hosts)) return [];
  return hosts
    .filter((h): h is string => typeof h === "string")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * `ADVICE_ALLOWED_HOSTS` (comma-separated; replaces the default store host when set) plus the
 * trusted-hosts file.
 */
export function trustedAdviceHosts(): string[] {
  const env = process.env.ADVICE_ALLOWED_HOSTS?.trim();
  const base = env
    ? env.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
    : [...DEFAULT_ADVICE_ALLOWED_HOSTS];
  return [...new Set([...base, ...readTrustedHostsFile()])];
}
