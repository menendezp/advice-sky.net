/** ERC-721 `Transfer` — used to read minted `tokenId` from the receipt. */
export const erc721TransferEventAbi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

/** Minimal ABI for SkynetAdvisory.sol (open-edition mintDirective). Must match deployed contract. */
export const skynetAdvisoryAbi = [
  {
    type: "function",
    name: "mintDirective",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "directiveId", type: "uint256" },
      { name: "uri", type: "string" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
