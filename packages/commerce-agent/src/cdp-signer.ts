import type { EvmServerAccount } from "@coinbase/cdp-sdk";
import type { Address, Hex } from "viem";

/**
 * Adapts a CDP server wallet account to the minimal surface @x402/evm ExactEvmScheme expects.
 */
export function cdpAccountToX402Signer(account: EvmServerAccount) {
  return {
    address: account.address as Address,
    signTypedData: async (message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => {
      const sig = await account.signTypedData({
        domain: message.domain,
        types: message.types,
        primaryType: message.primaryType,
        message: message.message,
      });
      return sig as Hex;
    },
  };
}
