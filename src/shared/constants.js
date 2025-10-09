import { ethers } from "ethers";
import BridgeArtifact from "../utils/abis/Bridge.json";
import BridgeUpgradeArtifact from "../utils/abis/BridgeUpgrade.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import KeyLogRegistryUpgradeArtifact from "../utils/abis/KeyLogRegistryUpgrade.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import WrappedTokenUpgradeArtifact from "../utils/abis/WrappedTokenUpgrade.json";
import WrappedNativeTokenArtifact from "../utils/abis/WrappedNativeToken.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import MockERC20UpgradeArtifact from "../utils/abis/MockERC20Upgrade.json";
export const BRIDGE_ABI = BridgeArtifact.abi;
export const BRIDGE_UPGRADE_ABI = BridgeUpgradeArtifact.abi;
export const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
export const KEYLOG_REGISTRY_UPGRADE_ABI = KeyLogRegistryUpgradeArtifact.abi;
export const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;
export const WRAPPED_TOKEN_UPGRADE_ABI = WrappedTokenUpgradeArtifact.abi;
export const WRAPPED_NATIVE_TOKEN_ABI = WrappedNativeTokenArtifact.abi;
export const ERC20_ABI = MockERC20Artifact.abi;
export const ERC20_UPGRADE_ABI = MockERC20UpgradeArtifact.abi;

export const DEPLOY_ENV = "testnet"; //import.meta.env.VITE_DEPLOY_ENV;
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
        providerUrl: "http://localhost:8545", // BSC RPC URL,
        hardwareInstruction: "Select BSC on your device.",
      }
    : {
        id: "bsc",
        name: "Binance Smart Chain (BSC)",
        chainId: 97, // BSC mainnet
        isBridge: true, // Replace with actual BSC bridge address
        providerUrl: "https://data-seed-prebsc-1-s1.binance.org:8545", // BSC RPC URL
        hardwareInstruction: "Select BSC on your device.",
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
    hardwareInstruction: "Select YadaCoin on your device.",
  },
];

export const addresses = {
  keyLogRegistryAddress: "0x37c3dBF6c28abEAf4D21c66F9D47347bDf4f0D70",
  bridgeAddress: "0x21383ed1D118b5D691d19716a72e806D8Cc3947A",
  wrappedTokenImplementation: "0x47E7FE3537013E069c9BbA828288541f1c2a3f55",
  beaconAddress: "0x554A1c97a049F1d442cc876d569eB55737a4DCdc",
  factoryAddress: "0x76E9E0Fd7F1EeBA70221990E82BD4cD89c3C43BA",
  yadaERC20Address: "0x6147dBD0980f3203c14BCD667F547c1264911d7d",
  configured: true,
};

export const deployed = true;
