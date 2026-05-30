import type { Address, Hex, WalletClient } from "viem";
import type { X402EvmSigner } from "./x402-paid-fetch.js";

/**
 * Adapts a viem `WalletClient` (e.g. from wagmi) to the surface `@x402/evm/exact/client` expects.
 */
export function walletClientToX402Signer(walletClient: WalletClient): X402EvmSigner {
  const account = walletClient.account;
  if (!account) {
    throw new Error("WalletClient has no account — connect a wallet first");
  }
  const address =
    typeof account === "string"
      ? account
      : "address" in account
        ? account.address
        : (() => {
            throw new Error("Unsupported account type on WalletClient");
          })();

  return {
    address: address as Address,
    signTypedData: async (message) => {
      const sig = await walletClient.signTypedData({
        account,
        domain: message.domain,
        types: message.types,
        primaryType: message.primaryType,
        message: message.message,
      } as Parameters<WalletClient["signTypedData"]>[0]);
      return sig as Hex;
    },
  };
}
