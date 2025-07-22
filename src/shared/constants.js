import { ethers } from "ethers";
import BridgeArtifact from "../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import TokenPairWrapperArtifact from "../utils/abis/TokenPairWrapper.json"
export const BRIDGE_ADDRESS = "0xb9F6BC8dCbcb300846474730881c2e82B7464cbC";
export const KEYLOG_REGISTRY_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
export const TOKEN_PAIR_WRAPPER_ADDRESS = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
export const WRAPPED_TOKEN_ADDRESS = "0x0165878A594ca255338adfa4d48449f69242Eb8F"; // $WYDA
export const Y_WRAPPED_TOKEN_ADDRESS = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853"; // $YPEPE
export const MOCK_ERC20_ADDRESS = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6"; // $YDA
export const MOCK2_ERC20_ADDRESS = "0xD17D034ae70d6Ac448D066bfF87D84993E521FDc"; // $PEPE
export const BRIDGE_ABI = BridgeArtifact.abi;
export const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
export const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;
export const ERC20_ABI = MockERC20Artifact.abi;
export const TOKEN_PAIR_WRAPPER_ABI = TokenPairWrapperArtifact.abi;

export const localProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/", {
  chainId: 31337,
  name: "hardhat",
});


export const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

export const BLOCKCHAINS = [
  {
    id: 'bsc',
    name: 'Binance Smart Chain (BSC)',
    chainId: 31337, // BSC mainnet
    bridgeAddress: BRIDGE_ADDRESS, // Replace with actual BSC bridge address
    keyLogRegistryAddress: '0xYourBSCKeyLogRegistryAddressHere',
    providerUrl: 'http://localhost:8545', // BSC RPC URL
  },
  // {
  //   id: 'eth',
  //   name: 'Ethereum',
  //   chainId: 1, // Ethereum mainnet
  //   bridgeAddress: BRIDGE_ADDRESS, // Replace with actual ETH bridge address
  //   keyLogRegistryAddress: '0xYourETHKeyLogRegistryAddressHere',
  //   providerUrl: 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY', // Ethereum RPC URL
  // },
  {
    id: 'yda',
    name: 'YadaCoin',
    chainId: 657, // Ethereum mainnet
    providerUrl: 'https://yadacoin.io', // Ethereum RPC URL
  },
];
  
  