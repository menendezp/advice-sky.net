/**
 * Create or fetch a named CDP EVM account (Server Wallet).
 * Usage: npx tsx scripts/create-cdp-account.ts [account-name]
 * Requires CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET in env.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { CdpClient } from "@coinbase/cdp-sdk";

config({ path: resolve(process.cwd(), "services/commerce-sidecar/.env") });
config();

async function main() {
  const name = process.argv[2]?.trim() || process.env.CDP_AGENT_ACCOUNT_NAME?.trim();
  if (!name) {
    console.error("Usage: npx tsx scripts/create-cdp-account.ts <account-name>");
    console.error("Or set CDP_AGENT_ACCOUNT_NAME in the environment.");
    process.exit(1);
  }

  const cdp = new CdpClient();
  const account = await cdp.evm.getOrCreateAccount({ name });
  console.log("CDP_AGENT_ACCOUNT_NAME=", name);
  console.log("Address:", account.address);
  console.log("\nAdd to services/commerce-sidecar/.env:");
  console.log(`CDP_AGENT_ACCOUNT_NAME=${name}`);
  console.log("Fund this address with USDC on Base mainnet before buying advice.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
