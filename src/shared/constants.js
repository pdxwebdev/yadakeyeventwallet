import { ethers } from "ethers";
import BridgeArtifact from "../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import WrappedNativeTokenArtifact from "../utils/abis/WrappedNativeToken.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import TokenPairWrapperArtifact from "../utils/abis/TokenPairWrapper.json";
export const BRIDGE_ABI = BridgeArtifact.abi;
export const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
export const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;
export const WRAPPED_NATIVE_TOKEN_ABI = WrappedNativeTokenArtifact.abi;
export const ERC20_ABI = MockERC20Artifact.abi;
export const TOKEN_PAIR_WRAPPER_ABI = TokenPairWrapperArtifact.abi;

export const localProvider = new ethers.JsonRpcProvider(
  "http://127.0.0.1:8545/",
  {
    chainId: 31337,
    name: "hardhat",
  }
);

// export const localProvider = new ethers.JsonRpcProvider(
//   "https://data-seed-prebsc-1-s1.binance.org:8545/",
//   {
//     chainId: 97,
//     name: "testnet",
//   },
//   { batchMaxCount: 1 }
// );

export const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

export const BLOCKCHAINS = [
  {
    id: "bsc",
    name: "Binance Smart Chain (BSC)",
    chainId: 31337, // BSC mainnet
    isBridge: true, // Replace with actual BSC bridge address
    providerUrl: "http://localhost:8545", // BSC RPC URL
  },
  // {
  //   id: "bsc",
  //   name: "Binance Smart Chain (BSC)",
  //   chainId: 97, // BSC mainnet
  //   isBridge: true, // Replace with actual BSC bridge address
  //   providerUrl: "https://data-seed-prebsc-1-s1.binance.org:8545", // BSC RPC URL
  // },
  // {
  //   id: 'eth',
  //   name: 'Ethereum',
  //   chainId: 1, // Ethereum mainnet
  //   bridgeAddress: contractAddresses.bridgeAddress, // Replace with actual ETH bridge address
  //   keyLogRegistryAddress: '0xYourETHKeyLogRegistryAddressHere',
  //   providerUrl: 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY', // Ethereum RPC URL
  // },
  {
    id: "yda",
    name: "YadaCoin",
    chainId: 657, // Ethereum mainnet
    providerUrl: "https://yadacoin.io", // Ethereum RPC URL
  },
];

export const addresses = {
  keyLogRegistryAddress: "0x044997d045B79646F8A5a01FE2DD2eEE8d4414b2",
  bnbPriceFeedAddress: "0xA8C6A4791ef1a9DEE5369b545f3A0DdB793ae09C",
  bridgeAddress: "0x6A74e17ABccc8fD428Ffc53D54D687BA79085ED6",
  yadaERC20Address: "0x4535ad8254B68e9c6BD4Aa1566598Baa21E49172",
  mockPepeAddress: "0xf3f79697D07330649410ccA61cCEB518522726C2",
  mockPriceFeedAddress: "0xC4863aAFCe747cd4755393eBf3466C595c95b487",
  configured: true,
};

export const deployed = false;
