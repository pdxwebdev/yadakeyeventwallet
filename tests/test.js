import { ethers } from "hardhat";
import { expect } from "chai";
import { createHDWallet, deriveSecurePath } from "../src/utils/hdWallet.js";

// We'll assume these ABIs are available in the same directory structure
const BRIDGE_ABI = (await import("../utils/abis/Bridge.json")).default.abi;
const KEYLOG_REGISTRY_ABI = (await import("../utils/abis/KeyLogRegistry.json")).default.abi;
const WRAPPED_TOKEN_ABI = (await import("../utils/abis/WrappedToken.json")).default.abi;
const ERC20_ABI = (await import("../utils/abis/MockERC20.json")).default.abi;

describe("Bridge DApp", () => {
  let provider;
  let deployer;
  let user;
  let bridge;
  let keyLogRegistry;
  let mockERC20;
  let wrappedToken;
  let yWrappedToken;
  let rootWallet;

  const BRIDGE_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
  const KEYLOG_REGISTRY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const WRAPPED_TOKEN_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
  const Y_WRAPPED_TOKEN_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
  const MOCK_ERC20_ADDRESS = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";

  const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";

  beforeAll(async () => {
    provider = ethers.provider;
    [deployer, user] = await ethers.getSigners();

    bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, deployer);
    keyLogRegistry = new ethers.Contract(KEYLOG_REGISTRY_ADDRESS, KEYLOG_REGISTRY_ABI, deployer);
    mockERC20 = new ethers.Contract(MOCK_ERC20_ADDRESS, ERC20_ABI, deployer);
    wrappedToken = new ethers.Contract(WRAPPED_TOKEN_ADDRESS, WRAPPED_TOKEN_ABI, deployer);
    yWrappedToken = new ethers.Contract(Y_WRAPPED_TOKEN_ADDRESS, WRAPPED_TOKEN_ABI, deployer);

    rootWallet = createHDWallet(HARDHAT_MNEMONIC);

    await bridge.setRelayer(deployer.address);
    const initialKey = await deriveSecurePath(rootWallet, "defaultPassword");
    user = new ethers.Wallet(ethers.hexlify(initialKey.privateKey), provider);

    await deployer.sendTransaction({
      to: user.address,
      value: ethers.parseEther("10")
    });
    await mockERC20.transfer(user.address, ethers.parseEther("100"));
  });

  const deriveNextKey = async (baseKey) => {
    const derivedKey = await deriveSecurePath(baseKey || rootWallet, "defaultPassword");
    return new ethers.Wallet(ethers.hexlify(derivedKey.privateKey), provider);
  };

  describe("Initialization", () => {
    it("should connect to Hardhat network and set up contracts", async () => {
      expect(await provider.getNetwork()).toHaveProperty("chainId", 31337);
      expect(await bridge.feeCollector()).toEqual(deployer.address);
      expect(await mockERC20.balanceOf(user.address)).toEqual(ethers.parseEther("100"));
    });
  });

  // ... rest of your test cases remain largely the same, just use await for async calls
});