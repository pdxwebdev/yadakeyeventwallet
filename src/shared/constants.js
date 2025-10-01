import { ethers } from "ethers";
import BridgeArtifact from "../utils/abis/Bridge.json";
import BridgeUpgradeArtifact from "../utils/abis/BridgeUpgrade.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import KeyLogRegistryUpgradeArtifact from "../utils/abis/KeyLogRegistryUpgrade.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import WrappedTokenUpgradeArtifact from "../utils/abis/WrappedTokenUpgrade.json";
import WrappedNativeTokenArtifact from "../utils/abis/WrappedNativeToken.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
export const BRIDGE_ABI = BridgeArtifact.abi;
export const BRIDGE_UPGRADE_ABI = BridgeUpgradeArtifact.abi;
export const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
export const KEYLOG_REGISTRY_UPGRADE_ABI = KeyLogRegistryUpgradeArtifact.abi;
export const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;
export const WRAPPED_TOKEN_UPGRADE_ABI = WrappedTokenUpgradeArtifact.abi;
export const WRAPPED_NATIVE_TOKEN_ABI = WrappedNativeTokenArtifact.abi;
export const ERC20_ABI = MockERC20Artifact.abi;

export const DEPLOY_ENV = "localhost"; //import.meta.env.VITE_DEPLOY_ENV;
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
  // {
  //   id: "yda",
  //   name: "YadaCoin",
  //   chainId: 657, // Ethereum mainnet
  //   providerUrl: "https://yadacoin.io", // Ethereum RPC URL
  // },
];

export const addresses = {
  keyLogRegistryAddress: "0xd6cf412EdA33F81b7C097DCc78E1AF08910f995c",
  bridgeAddress: "0xCD4158786120d0E150E934a2676Fd0c354Ce4594",
  wrappedTokenImplementation: "0x4b2d1bA6d99Ba1a3EA8128Cd74Dd4DC5Fdd3f09E",
  beaconAddress: "0x4b32afdac04F20E84baE73DeA4Ed04a45Db24603",
  factoryAddress: "0xc39e3414964Ef6ADCe070403E0dbb2dCA8D3cf1A",
  yadaERC20Address: "0x3f2B5081c576908316a5b1c5938b73CaFE02C6C0",
  configured: true,
};

export const deployed = true;
