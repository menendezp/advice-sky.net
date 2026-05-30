/**
 * OpenSea URL helper + env summary for startup logs.
 * On-chain mint runs in `mint-after-buy-advice.ts` after `buyAdvice`, not inside the Edge route handler.
 */
export function openSeaItemUrl(contract: string, tokenId: number): string | null {
  const c = contract.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(c)) return null;
  return `https://opensea.io/item/base/${c}/${tokenId}`;
}

/** Loggable summary for startup diagnostics (secrets excluded). */
export function nftMintPhase2EnvSummary(): {
  nft_contract_address?: string;
  nft_chain_id?: number;
  open_sea_preview?: string;
} {
  const addr = process.env.NFT_CONTRACT_ADDRESS?.trim();
  const chainRaw =
    process.env.NFT_CHAIN_ID ?? process.env.NEXT_PUBLIC_NFT_CHAIN_ID;
  const parsed = chainRaw
    ? Number.parseInt(String(chainRaw).trim(), 10)
    : undefined;
  return {
    ...(addr ? { nft_contract_address: addr } : {}),
    ...(Number.isFinite(parsed) ? { nft_chain_id: parsed } : {}),
    ...(addr
      ? {
          open_sea_preview: openSeaItemUrl(addr, 1) ?? undefined,
        }
      : {}),
  };
}
