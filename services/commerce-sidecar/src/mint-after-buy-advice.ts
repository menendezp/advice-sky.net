import type { Hex } from "viem";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import {
  createCommerceSupabase,
  extractDirectiveTokenIdFromAdvice,
  normalizeEvmWallet,
} from "@agentic/commerce-agent";
import { erc721TransferEventAbi, skynetAdvisoryAbi } from "./skynet-advisory-abi.js";
import { openSeaItemUrl } from "./nft-phase2-placeholder.js";

/** Must match `TOTAL_DIRECTIVES` in SkynetAdvisory.sol (`directiveId < TOTAL_DIRECTIVES`). */
export const SKYNET_TOTAL_DIRECTIVES_EXCLUSIVE = 99;

export type NftMintOutcome =
  | { status: "skipped"; reason: string }
  | {
      status: "ok";
      transactionHash: Hex;
      /** ERC-721 id from mint tx logs; null if parsing failed. */
      onChainTokenId: number | null;
      openSeaUrl: string | null;
    }
  | { status: "failed"; error: string };

function directiveAndUriFromAdvice(
  advice: unknown,
): { directiveId: number; metadataUri: string } | null {
  const directiveId = extractDirectiveTokenIdFromAdvice(advice);
  if (directiveId === null) return null;
  if (
    !Number.isInteger(directiveId) ||
    directiveId < 0 ||
    directiveId >= SKYNET_TOTAL_DIRECTIVES_EXCLUSIVE
  ) {
    return null;
  }
  if (!advice || typeof advice !== "object") return null;
  const d = (advice as Record<string, unknown>).directive;
  if (!d || typeof d !== "object") return null;
  const uri = (d as Record<string, unknown>).metadata_uri;
  if (typeof uri !== "string" || !uri.trim()) return null;
  return { directiveId, metadataUri: uri.trim() };
}

function normalizePk(raw: string): `0x${string}` {
  const s = raw.trim();
  if (s.startsWith("0x")) return s as `0x${string}`;
  return (`0x${s}`) as `0x${string}`;
}

function chainFromEnvId(chainId: number) {
  if (chainId === 8453) return base;
  if (chainId === 84532) return baseSepolia;
  return null;
}

async function persistMintToSupabase(opts: {
  x402TxHash: string;
  mintTxHash: string | null;
  mintStatus: "ok" | "failed" | "pending";
  onChainTokenId: number | null;
  mintError: string | null;
}): Promise<void> {
  const sb = createCommerceSupabase();
  if (!sb) {
    console.warn(
      "[commerce-sidecar] Supabase unset — cannot persist mint columns (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    );
    return;
  }
  const { error } = await sb
    .from("advice_sale_events")
    .update({
      mint_tx_hash: opts.mintTxHash,
      mint_status: opts.mintStatus,
      on_chain_token_id: opts.onChainTokenId,
      mint_error: opts.mintError,
    })
    .eq("x402_tx_hash", opts.x402TxHash);
  if (error) {
    console.warn("[commerce-sidecar] advice_sale_events mint update:", error.message ?? error);
  }
}

/**
 * After a successful `buyAdvice`, optionally mint on SkynetAdvisory and update `advice_sale_events`.
 * Requires NFT_CONTRACT_ADDRESS, NFT_OWNER_PRIVATE_KEY, BASE_RPC_URL (or public default), NFT_CHAIN_ID.
 */
export async function mintSkynetDirectiveAfterBuyAdvice(input: {
  advice: unknown;
  payer: string | undefined;
  settlementTx: string;
}): Promise<NftMintOutcome> {
  const contract = process.env.NFT_CONTRACT_ADDRESS?.trim().toLowerCase();
  const pkRaw = process.env.NFT_OWNER_PRIVATE_KEY?.trim();
  const rpc =
    process.env.BASE_RPC_URL?.trim() ||
    (Number(process.env.NFT_CHAIN_ID ?? 8453) === 84532
      ? "https://sepolia.base.org"
      : "https://mainnet.base.org");

  if (!contract || !pkRaw) {
    return {
      status: "skipped",
      reason:
        "NFT_CONTRACT_ADDRESS_or_NFT_OWNER_PRIVATE_KEY_unset",
    };
  }
  if (!/^0x[0-9a-f]{40}$/.test(contract)) {
    return { status: "failed", error: "NFT_CONTRACT_ADDRESS_invalid" };
  }

  const chainId = Number.parseInt(String(process.env.NFT_CHAIN_ID ?? "8453").trim(), 10);
  if (!Number.isFinite(chainId)) {
    return { status: "skipped", reason: "NFT_CHAIN_ID_invalid" };
  }

  const chain = chainFromEnvId(chainId);
  if (!chain) {
    return {
      status: "skipped",
      reason: `NFT_CHAIN_ID_${chainId}_unsupported_use_8453_or_84532`,
    };
  }

  const parsed = directiveAndUriFromAdvice(input.advice);
  if (!parsed) {
    return {
      status: "skipped",
      reason:
        "missing_or_invalid_directive_for_mint_token_id_metadata_uri_or_outside_0_98",
    };
  }

  const to = normalizeEvmWallet(input.payer);
  if (!to) {
    return { status: "skipped", reason: "payer_address_missing_or_invalid" };
  }

  const x402 = (input.settlementTx ?? "").trim();
  if (!x402) {
    return { status: "skipped", reason: "settlement_tx_empty_cannot_match_advice_sale_events" };
  }

  let account;
  try {
    account = privateKeyToAccount(normalizePk(pkRaw));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "failed", error: `NFT_OWNER_PRIVATE_KEY_invalid: ${msg}` };
  }

  const transport = http(rpc);
  const client = createWalletClient({
    account,
    chain,
    transport,
  });
  const publicClient = createPublicClient({ chain, transport });

  try {
    const hash = await client.writeContract({
      address: contract as `0x${string}`,
      abi: skynetAdvisoryAbi,
      functionName: "mintDirective",
      args: [to as `0x${string}`, BigInt(parsed.directiveId), parsed.metadataUri],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      await persistMintToSupabase({
        x402TxHash: x402,
        mintTxHash: hash,
        mintStatus: "failed",
        onChainTokenId: null,
        mintError: "transaction_reverted",
      });
      return { status: "failed", error: "mint_transaction_reverted" };
    }

    const transfers = parseEventLogs({
      abi: erc721TransferEventAbi,
      logs: receipt.logs,
      eventName: "Transfer",
    });
    const minted = transfers.filter(
      (e) =>
        e.args.from === "0x0000000000000000000000000000000000000000" &&
        e.args.to?.toLowerCase() === to,
    );
    const lastMint = minted[minted.length - 1];
    const tokenIdBi = lastMint?.args.tokenId;
    let tokenNum: number | null = null;
    if (tokenIdBi !== undefined) {
      const n = Number(tokenIdBi);
      tokenNum = Number.isSafeInteger(n) ? n : null;
    }

    if (tokenNum === null) {
      console.warn(
        "[commerce-sidecar] could not parse Transfer tokenId from logs; check receipt",
        hash,
      );
    }

    await persistMintToSupabase({
      x402TxHash: x402,
      mintTxHash: hash,
      mintStatus: "ok",
      onChainTokenId: tokenNum,
      mintError: null,
    });

    const openSeaUrl =
      tokenNum !== null ? openSeaItemUrl(contract, tokenNum) : null;

    return {
      status: "ok",
      transactionHash: hash,
      onChainTokenId: tokenNum,
      openSeaUrl,
    };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await persistMintToSupabase({
      x402TxHash: x402,
      mintTxHash: null,
      mintStatus: "failed",
      onChainTokenId: null,
      mintError: errMsg.slice(0, 500),
    });
    return { status: "failed", error: errMsg };
  }
}
