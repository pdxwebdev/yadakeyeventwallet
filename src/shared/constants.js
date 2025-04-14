import { ethers } from "ethers";
export const BRIDGE_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
export const KEYLOG_REGISTRY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const TOKEN_PAIR_WRAPPER_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
export const WRAPPED_TOKEN_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"; // $WYDA
export const Y_WRAPPED_TOKEN_ADDRESS = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707"; // $YPEPE
export const MOCK_ERC20_ADDRESS = "0x0165878A594ca255338adfa4d48449f69242Eb8F"; // $YDA
export const MOCK2_ERC20_ADDRESS = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853"; // $PEPE

export const localProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/", {
  chainId: 31337,
  name: "hardhat",
});


export const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";