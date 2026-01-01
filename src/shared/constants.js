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

export const DEPLOY_ENV = "localhost"; //import.meta.env.VITE_DEPLOY_ENV;
export let localProvider =
  DEPLOY_ENV === "mainnet"
    ? new ethers.JsonRpcProvider(
        "https://bsc-dataseed1.binance.org/", // BSC Mainnet RPC URL
        {
          chainId: 56, // BSC Mainnet chain ID
          name: "mainnet",
        },
        { batchMaxCount: 1 }
      )
    : DEPLOY_ENV === "testnet"
    ? new ethers.JsonRpcProvider(
        "https://data-seed-prebsc-1-s1.binance.org:8545/",
        {
          chainId: 97,
          name: "testnet",
        },
        { batchMaxCount: 1 }
      )
    : new ethers.JsonRpcProvider("http://127.0.0.1:8545/", {
        chainId: 31337,
        name: "hardhat",
      });
export let localSwapProvider =
  DEPLOY_ENV === "mainnet"
    ? new ethers.JsonRpcProvider(
        "https://bscrpc.pancakeswap.finance/", // BSC Mainnet RPC URL
        {
          chainId: 56, // BSC Mainnet chain ID
          name: "mainnet",
        },
        { batchMaxCount: 1 }
      )
    : DEPLOY_ENV === "testnet"
    ? new ethers.JsonRpcProvider(
        "https://data-seed-prebsc-1-s1.binance.org:8545/",
        {
          chainId: 97,
          name: "testnet",
        },
        { batchMaxCount: 1 }
      )
    : new ethers.JsonRpcProvider("http://127.0.0.1:8545/", {
        chainId: 31337,
        name: "hardhat",
      });

export const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

export const BLOCKCHAINS = [
  DEPLOY_ENV === "mainnet"
    ? {
        id: "bsc",
        name: "Binance Smart Chain (BSC)",
        chainId: 56, // BSC Mainnet
        isBridge: true,
        providerUrl: "https://bsc-dataseed1.binance.org/", // BSC Mainnet RPC URL
        hardwareInstruction: "Select BSC on your device.",
        color: "yellow",
        isKeyEventLog: true,
      }
    : DEPLOY_ENV === "testnet"
    ? {
        id: "bsc",
        name: "Binance Smart Chain (BSC)",
        chainId: 97, // BSC mainnet
        isBridge: true, // Replace with actual BSC bridge address
        providerUrl: "https://data-seed-prebsc-1-s1.binance.org:8545", // BSC RPC URL
        hardwareInstruction: "Select BSC on your device.",
        color: "yellow",
        isKeyEventLog: true,
      }
    : {
        id: "bsc",
        name: "Binance Smart Chain (BSC)",
        chainId: 31337, // BSC mainnet
        isBridge: true, // Replace with actual BSC bridge address
        providerUrl: "http://localhost:8545", // BSC RPC URL,
        hardwareInstruction: "Select BSC on your device.",
        color: "yellow",
        isKeyEventLog: true,
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
    color: "teal",
    isKeyEventLog: true,
  },
  {
    id: "btc",
    name: "Bitcoin",
    chainId: 657, // Ethereum mainnet
    providerUrl: "https://blockchain.info", // Ethereum RPC URL
    hardwareInstruction: "Bitcoin coming soon!",
    color: "orange",
    isKeyEventLog: false,
    disabled: true,
  },
];

export const addresses =
  DEPLOY_ENV === "mainnet"
    ? {
        keyLogRegistryAddress: "0x123772E8c6fA9A64eBFFD17Adadde6f7a89b73f4",
        bridgeAddress: "0x3471134Bf6478993545bdf5C2a170A2150caB0c3",
        wrappedTokenImplementation:
          "0x469ae1ca5fedB3f3a0151BD4cc6291F4b6B98953",
        beaconAddress: "0x54De45901EE4202979cf0A2b131aC795B805AF8F",
        factoryAddress: "0x707C03d34957bF600C17b8596BD48438E2B2a58f",
        yadaERC20Address: "0x105A494F92f2C736f774A7ED0CFC6EA3CB6499B7",
        configured: true,
      }
    : {
        keyLogRegistryAddress: "0x37c3dBF6c28abEAf4D21c66F9D47347bDf4f0D70",
        bridgeAddress: "0x21383ed1D118b5D691d19716a72e806D8Cc3947A",
        wrappedTokenImplementation:
          "0x47E7FE3537013E069c9BbA828288541f1c2a3f55",
        beaconAddress: "0x554A1c97a049F1d442cc876d569eB55737a4DCdc",
        factoryAddress: "0x76E9E0Fd7F1EeBA70221990E82BD4cD89c3C43BA",
        yadaERC20Address: "0x6147dBD0980f3203c14BCD667F547c1264911d7d",
        configured: true,
      };

export const deployed = false;

export const PANCAKE_ROUTER_ADDRESS =
  "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // PancakeSwap V2 Router
export const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"; // BSC USDT
export const PANCAKESWAP_V2_FACTORY =
  "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
export const INIT_CODE_HASH =
  "0x00fb7f630766e6a3661694c255c275e23d2c7f538d16a7f3b0a0d4d5f0b8d8d8"; // BSC mainnet

export const LP_ADDRESS = "0xb48F5Da9C91280D2063975Ac0b06D0893DdDc815";

export const PANCAKE_ROUTER_ABI = [
  // === Swap Functions ===
  "function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)",

  // === Liquidity ===
  "function addLiquidityETH (address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB, uint liquidity)",
  "function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) returns (uint amountToken, uint amountETH)",
  "function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB)",

  // === CRITICAL: Add this line ===
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
];
