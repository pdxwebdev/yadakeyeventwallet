export const glossaryTerms = [
  {
    term: "Wallet",
    definition:
      "A software application or hardware device that stores your private keys and allows you to interact with blockchains — send/receive tokens, sign transactions, connect to dApps.",
  },
  {
    term: "Private Key",
    definition:
      "A secret cryptographic code that proves ownership of funds and is used to sign transactions. Never share it.",
  },
  {
    term: "Public Key / Address",
    definition:
      "Derived from your private key — this is the address others can send funds to (like your bank account number).",
  },
  {
    term: "WIF (Wallet Import Format)",
    definition:
      "A standard format for encoding private keys (often used in QR codes or backups in this wallet).",
  },
  {
    term: "Key Rotation",
    definition:
      "Process of moving control of the wallet to the next key in a pre-defined sequence (used here for security after each transaction or initialization step).",
  },
  {
    term: "Bridge",
    definition:
      "A smart contract system that allows tokens to move between blockchains (in this app: original token → wrapped token and vice versa).",
  },
  {
    term: "Wrap / Unwrap",
    definition:
      "Wrapping converts a native or original token into a wrapped version usable on another chain or contract. Unwrapping reverses the process.",
  },
  {
    term: "Wrapped Token",
    definition:
      "A tokenized version of an asset (e.g. WETH, WYDA) that follows a standard (usually ERC-20) and can be used in DeFi protocols.",
  },
  {
    term: "Mint",
    definition:
      "Creating new tokens (usually restricted to contract owner or authorized roles).",
  },
  {
    term: "Burn",
    definition:
      "Permanently removing tokens from circulation by sending them to an inaccessible address.",
  },
  {
    term: "Owner (Contract Owner)",
    definition:
      "The address that has administrative privileges over a smart contract (upgrade, pause, withdraw, etc.). In this app — checked via getOwner().",
  },
  {
    term: "DeFi (Decentralized Finance)",
    definition:
      "Financial applications built on blockchains that operate without intermediaries — lending, swapping, liquidity provision, etc.",
  },
  {
    term: "DEX (Decentralized Exchange)",
    definition:
      "A platform (like PancakeSwap) that lets users swap tokens directly from their wallets via smart contracts.",
  },
  {
    term: "Liquidity Pool",
    definition:
      "A smart contract holding pairs of tokens that enables automated trading (used in AMMs like PancakeSwap).",
  },
  {
    term: "AMM (Automated Market Maker)",
    definition:
      "A system that uses mathematical formulas to price assets and provide liquidity instead of traditional order books.",
  },
  {
    term: "Slippage",
    definition:
      "The difference between the expected price of a trade and the actual executed price (common in low-liquidity pools).",
  },
  {
    term: "Gas Fee",
    definition:
      "The cost (in native token like BNB) paid to miners/validators to process a transaction on the blockchain.",
  },
  {
    term: "Smart Contract",
    definition:
      "Self-executing code stored on the blockchain that automatically enforces rules when conditions are met.",
  },
  {
    term: "dApp (Decentralized Application)",
    definition:
      "An application that runs on a blockchain and interacts with smart contracts (most wallets connect to dApps).",
  },
  {
    term: "Token Pair",
    definition:
      "In this app: mapping between an original token and its wrapped version on the bridge.",
  },
  {
    term: "Initialization (Key Event Log)",
    definition:
      "First transaction that registers the wallet’s key rotation sequence on-chain.",
  },
  {
    term: "Seed Phrase / Mnemonic",
    definition:
      "A 12–24 word phrase that can regenerate your private keys (not directly used in this QR-based wallet).",
  },
  {
    term: "Web3",
    definition:
      "The next generation of the internet built on decentralized protocols, blockchains, and user-owned data.",
  },
  // Add more terms as needed — keep explanations concise
];
