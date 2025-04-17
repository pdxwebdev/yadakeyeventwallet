import { ethers } from "ethers";
import BridgeArtifact from "../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import TokenPairWrapperArtifact from "../utils/abis/TokenPairWrapper.json"
export const BRIDGE_ADDRESS = "0x4389aa2eF04B4b6c0E1F0b677ea0516A45C4af8F";
export const KEYLOG_REGISTRY_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
export const TOKEN_PAIR_WRAPPER_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
export const WRAPPED_TOKEN_ADDRESS = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707"; // $WYDA
export const Y_WRAPPED_TOKEN_ADDRESS = "0x0165878A594ca255338adfa4d48449f69242Eb8F"; // $YPEPE
export const MOCK_ERC20_ADDRESS = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853"; // $YDA
export const MOCK2_ERC20_ADDRESS = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6"; // $PEPE
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