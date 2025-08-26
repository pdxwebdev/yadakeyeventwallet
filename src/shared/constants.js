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

// export const localProvider = new ethers.JsonRpcProvider(
//   "http://127.0.0.1:8545/",
//   {
//     chainId: 31337,
//     name: "hardhat",
//   }
// );

export const localProvider = new ethers.JsonRpcProvider(
  "https://data-seed-prebsc-1-s1.binance.org:8545/",
  {
    chainId: 97,
    name: "testnet",
  },
  { batchMaxCount: 1 }
);

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
  keyLogRegistryAddress: "0x004BC68e79049c8e0Aa280eBd42538636B67F3bC",
  bnbPriceFeedAddress: "0xf88FE1FA514a6095Fb4aff38c62313881c4589EF",
  bridgeAddress: "0x23A92A8723Fc5b7C0Cc65F3A9b605BBdF83d341F",
  yadaERC20Address: "0x507ec961bcEB7d7B0a00cda59b00FF8b91098b9f",
  mockPepeAddress: "0x0F0A32626372C1349bb904E5985eE231B7ea3b51",
  mockPriceFeedAddress: "0x3aF5296884E38390c718a87410A7DF40c74b7c0C",
  wrappedTokenWMOCKAddress: "0x2eE9302eeA46167204E152280B05ce6E9663e65D",
  wrappedTokenYMOCKAddress: "0x4f92961233f648f54f5F7564c1b81D505437de57",
  wrappedNativeTokenAddress: "0x658Fa987cD034B96fDeb32571195C88119E49496",
};

export const deployed = true;
