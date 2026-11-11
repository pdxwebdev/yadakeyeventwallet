require("@nomicfoundation/hardhat-ethers");
require("@openzeppelin/hardhat-upgrades");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config({ path: ".env.development" });

const config = {
  solidity: {
    version: "0.8.24",
    defaultNetwork: "hardhat",
    settings: {
      viaIR: false,
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      gasPrice: 20000000000,
      blockGasLimit: 100000000,
      allowUnlimitedContractSize: true,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 10,
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      gas: "auto",
    },
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/", // BSC Testnet RPC
      chainId: 97, // Optional, for validation
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 10,
      },
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: process.env.BASE_DEPLOYER_KEY ? [process.env.BASE_DEPLOYER_KEY] : [],
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
  etherscan: {
    apiKey: process.env.VITE_BSCSCAN_API_KEY,
  },
};

module.exports = config;
