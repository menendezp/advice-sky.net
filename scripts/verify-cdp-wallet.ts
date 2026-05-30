/**
 * Verify CDP credentials and print token balances for the agent EVM account.
 * Usage: npx tsx scripts/verify-cdp-wallet.ts
 * Requires CDP_* env vars (load from services/commerce-sidecar/.env via dotenv in cwd or export).
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { CdpClient } from "@coinbase/cdp-sdk";

config({ path: resolve(process.cwd(), "services/commerce-sidecar/.env") });
config();

async function main() {
  const name = process.env.CDP_AGENT_ACCOUNT_NAME;
  if (!name) {
    console.error("Set CDP_AGENT_ACCOUNT_NAME");
    process.exit(1);
  }

  const network = process.env.CDP_VERIFY_NETWORK ?? "base";
  const cdp = new CdpClient();
  const account = await cdp.evm.getAccount({ name });
  const scoped = await account.useNetwork(
    network as "base" | "base-sepolia" | "ethereum",
  );
  const balances = await scoped.listTokenBalances({});
  console.log("Account name:", name);
  console.log("Address:", account.address);
  console.log("Network:", network);
  console.log("Balances:", JSON.stringify(balances, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
