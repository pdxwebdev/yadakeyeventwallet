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

export const DEPLOY_ENV = "testnet";
export let localProvider =
  DEPLOY_ENV === "localhost"
    ? new ethers.JsonRpcProvider("http://127.0.0.1:8545/", {
        chainId: 31337,
        name: "hardhat",
      })
    : new ethers.JsonRpcProvider(
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
  DEPLOY_ENV === "localhost"
    ? {
        id: "bsc",
        name: "Binance Smart Chain (BSC)",
        chainId: 31337, // BSC mainnet
        isBridge: true, // Replace with actual BSC bridge address
        providerUrl: "http://localhost:8545", // BSC RPC URL
      }
    : {
        id: "bsc",
        name: "Binance Smart Chain (BSC)",
        chainId: 97, // BSC mainnet
        isBridge: true, // Replace with actual BSC bridge address
        providerUrl: "https://data-seed-prebsc-1-s1.binance.org:8545", // BSC RPC URL
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
  keyLogRegistryAddress: "0x4b38324D201BeFA2F7919b22A11e2aA9Da953040",
  bnbPriceFeedAddress: "0xC67B66a3F8039dEe3bCaE89807D7b3cCD0388142",
  bridgeAddress: "0xa0Cd4D9C5cd2B5517c1fdB04d166163B2d0726CE",
  yadaERC20Address: "0xe8258Ab1e50B19d7293873CB055E5E386284c683",
  mockPepeAddress: "0x01250BF5499FA6F171C473Bf7D76BA7Ad53D8232",
  mockPriceFeedAddress: "0xdE8C47154108A42bCC44f951631ca779574e731d",
  configured: true,
};

export const deployed = true;
