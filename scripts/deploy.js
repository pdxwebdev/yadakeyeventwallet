import pkg from "hardhat";
import fs from 'fs';
const { ethers, upgrades } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const deploymentsFile = "./deployments.json";
  let deployments = fs.existsSync(deploymentsFile)
    ? JSON.parse(fs.readFileSync(deploymentsFile))
    : {};

  // Deploy KeyLogRegistry
  const KeyLogRegistry = await ethers.getContractFactory("KeyLogRegistry");
  let keyLogRegistry;
  if (deployments.keyLogRegistry) {
    keyLogRegistry = await KeyLogRegistry.attach(deployments.keyLogRegistry);
    console.log("Using existing KeyLogRegistry:", deployments.keyLogRegistry);
  } else {
    keyLogRegistry = await KeyLogRegistry.deploy();
    await keyLogRegistry.waitForDeployment();
    deployments.keyLogRegistry = await keyLogRegistry.getAddress();
    console.log("KeyLogRegistry:", deployments.keyLogRegistry);
  }
  const keyLogRegistryAddress = deployments.keyLogRegistry;

  // Deploy Bridge
  const Bridge = await ethers.getContractFactory("Bridge");
  let bridge;
  if (deployments.bridge) {
    bridge = await ethers.getContractAt("Bridge", deployments.bridge, deployer);
    console.log("Using existing Bridge proxy:", deployments.bridge);
  } else {
    bridge = await upgrades.deployProxy(Bridge, [keyLogRegistryAddress], {
      initializer: "initialize",
      kind: "uups",
    });
    await bridge.waitForDeployment();
    deployments.bridge = await bridge.getAddress();
    console.log("Bridge:", deployments.bridge);
  }
  const bridgeAddress = deployments.bridge;

  // Deploy TokenPairWrapper
  const TokenPairWrapper = await ethers.getContractFactory("TokenPairWrapper");
  let tokenPairWrapper;
  if (deployments.tokenPairWrapper) {
    tokenPairWrapper = await TokenPairWrapper.attach(deployments.tokenPairWrapper);
    console.log("Using existing TokenPairWrapper:", deployments.tokenPairWrapper);
  } else {
    tokenPairWrapper = await TokenPairWrapper.deploy(bridgeAddress, keyLogRegistryAddress);
    await tokenPairWrapper.waitForDeployment();
    deployments.tokenPairWrapper = await tokenPairWrapper.getAddress();
    console.log("TokenPairWrapper:", deployments.tokenPairWrapper);
  }
  const tokenPairWrapperAddress = deployments.tokenPairWrapper;

  // Update output
  console.log(`export const TOKEN_PAIR_WRAPPER_ADDRESS = "${tokenPairWrapperAddress}";`);

  // Deploy WrappedToken ($WYDA)
  const WrappedToken = await ethers.getContractFactory("WrappedToken");
  let wrappedTokenWMOCK;
  if (deployments.wrappedTokenWMOCK) {
    wrappedTokenWMOCK = await WrappedToken.attach(deployments.wrappedTokenWMOCK);
    console.log("Using existing WrappedToken ($WYDA):", deployments.wrappedTokenWMOCK);
  } else {
    wrappedTokenWMOCK = await WrappedToken.deploy("Wrapped Mock", "WYDA", bridgeAddress);
    await wrappedTokenWMOCK.waitForDeployment();
    deployments.wrappedTokenWMOCK = await wrappedTokenWMOCK.getAddress();
    console.log("WrappedToken ($WYDA):", deployments.wrappedTokenWMOCK);
  }
  const wrappedTokenWMOCKAddress = deployments.wrappedTokenWMOCK;

  // Deploy WrappedToken ($YPEPE)
  let wrappedTokenYMOCK;
  if (deployments.wrappedTokenYMOCK) {
    wrappedTokenYMOCK = await WrappedToken.attach(deployments.wrappedTokenYMOCK);
    console.log("Using existing WrappedToken ($YPEPE):", deployments.wrappedTokenYMOCK);
  } else {
    wrappedTokenYMOCK = await WrappedToken.deploy("Yada PEPE", "YPEPE", bridgeAddress);
    await wrappedTokenYMOCK.waitForDeployment();
    deployments.wrappedTokenYMOCK = await wrappedTokenYMOCK.getAddress();
    console.log("WrappedToken ($YPEPE):", deployments.wrappedTokenYMOCK);
  }
  const wrappedTokenYMOCKAddress = deployments.wrappedTokenYMOCK;

  // Deploy YadaERC20 ($YDA)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  let yadaERC20;
  if (deployments.yadaERC20) {
    yadaERC20 = await MockERC20.attach(deployments.yadaERC20);
    console.log("Using existing Yada Cross-chain ($YDA):", deployments.yadaERC20);
  } else {
    yadaERC20 = await MockERC20.deploy("Yada cross-chain", "YDA", ethers.parseEther("1000"));
    await yadaERC20.waitForDeployment();
    deployments.yadaERC20 = await yadaERC20.getAddress();
    console.log("Yada Cross-chain ($YDA):", deployments.yadaERC20);
  }
  const yadaERC20Address = deployments.yadaERC20;

  // Deploy Mock PEPE
  let mockPepe;
  if (deployments.pepeERC20_2) {
    mockPepe = await MockERC20.attach(deployments.pepeERC20_2);
    console.log("Using existing Mock PEPE:", deployments.pepeERC20_2);
  } else {
    mockPepe = await MockERC20.deploy("Pepe", "PEPE", ethers.parseEther("1000"));
    await mockPepe.waitForDeployment();
    deployments.pepeERC20_2 = await mockPepe.getAddress();
    console.log("Mock PEPE:", deployments.pepeERC20_2);
  }
  const mockPepeAddress = deployments.pepeERC20_2;

  // Deploy Mock Price Feed
  const PriceFeedAggregatorV3 = await ethers.getContractFactory("PriceFeedAggregatorV3");
  let priceFeed;
  if (deployments.mockPriceFeed) {
    priceFeed = await PriceFeedAggregatorV3.attach(deployments.mockPriceFeed);
    console.log("Using existing Price Feed (PEPE/USD):", deployments.mockPriceFeed);
  } else {
    priceFeed = await PriceFeedAggregatorV3.deploy(ethers.parseUnits("100000.0", 8));
    await priceFeed.waitForDeployment();
    deployments.mockPriceFeed = await priceFeed.getAddress();
    console.log("Price Feed (PEPE/USD):", deployments.mockPriceFeed);
  }
  const priceFeedAddress = deployments.mockPriceFeed;

  // Configure contracts (only if not already configured)
  if (!deployments.configured) {
    await keyLogRegistry.setAuthorizedCaller(bridgeAddress);
    console.log("Set KeyLogRegistry authorized caller to Bridge");

    // Configure Bridge (only owner can call these)
    await bridge.addTokenPair(yadaERC20Address, wrappedTokenWMOCKAddress, true);
    console.log("Added token pair: $YDA -> $WYDA (cross-chain)");

    await bridge.addTokenPair(mockPepeAddress, wrappedTokenYMOCKAddress, false);
    console.log("Added token pair: $PEPE -> $YPEPE (on-chain)");

    await bridge.setTokenPriceFeed(mockPepeAddress, priceFeedAddress);
    console.log("Set price feed for $PEPE");

    deployments.configured = true;
  }

  // Verify deployment
  const feeCollector = await bridge.feeCollector();
  console.log("FeeCollector:", feeCollector);

  // Save deployments
  fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));

  // Output for React
  console.log("\nCopy these into your React component:");
  console.log(`export const BRIDGE_ADDRESS = "${bridgeAddress}";`);
  console.log(`export const KEYLOG_REGISTRY_ADDRESS = "${keyLogRegistryAddress}";`);
  console.log(`export const TOKEN_PAIR_WRAPPER_ADDRESS = "${tokenPairWrapperAddress}";`);
  console.log(`export const WRAPPED_TOKEN_ADDRESS = "${wrappedTokenWMOCKAddress}"; // $WYDA`);
  console.log(`export const Y_WRAPPED_TOKEN_ADDRESS = "${wrappedTokenYMOCKAddress}"; // $YPEPE`);
  console.log(`export const MOCK_ERC20_ADDRESS = "${yadaERC20Address}"; // $YDA`);
  console.log(`export const MOCK2_ERC20_ADDRESS = "${mockPepeAddress}"; // $PEPE`);

  return deployments;
}

main()
  .then((addresses) => {
    console.log("Deployed:", addresses);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });