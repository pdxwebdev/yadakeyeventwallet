require("@nomicfoundation/hardhat-ethers");
require("@openzeppelin/hardhat-upgrades");

const config = {
  solidity: {
    version: "0.8.24",
    defaultNetwork: "hardhat",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        "*": {
          "*": ["evm.bytecode"],
        },
      },
      evmVersion: "istanbul", // Use a recent EVM version
      metadata: {
        useLiteralContent: true, // Optional: Reduces metadata size
      },
      debug: {
        revertStrings: "strip", // Disable revert strings
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      gasPrice: 20000000000,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 10,
      },
      localhost: {
        url: "http://127.0.0.1:8545",
      },
    },
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/", // BSC Testnet RPC
      chainId: 97, // Optional, for validation
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 10,
      },
    },
    bscMainnet: {
      url: "https://bsc-dataseed1.binance.org/", // BSC Testnet RPC
      chainId: 56, // Optional, for validation
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 10,
      },
    },
  },
};

module.exports = config;
