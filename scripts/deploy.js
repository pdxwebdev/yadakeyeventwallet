import pkg from "hardhat";
const { ethers, upgrades } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // Deploy KeyLogRegistry
  const KeyLogRegistry = await ethers.getContractFactory("KeyLogRegistry");
  const keyLogRegistry = await KeyLogRegistry.deploy();
  await keyLogRegistry.waitForDeployment();
  const keyLogRegistryAddress = await keyLogRegistry.getAddress();
  console.log("KeyLogRegistry:", keyLogRegistryAddress);

  // Deploy Bridge as a proxy
  const Bridge = await ethers.getContractFactory("Bridge");
  const bridge = await upgrades.deployProxy(
    Bridge,
    [keyLogRegistryAddress],
    { initializer: "initialize", kind: "uups" }
  );
  await bridge.waitForDeployment();
  const bridgeAddress = await bridge.getAddress();
  console.log("Bridge:", bridgeAddress);

  // Deploy WrappedToken ($WMOCK)
  const WrappedTokenWMOCK = await ethers.getContractFactory("WrappedToken");
  const wrappedTokenWMOCK = await WrappedTokenWMOCK.deploy("Wrapped Mock", "WYDA", bridgeAddress);
  await wrappedTokenWMOCK.waitForDeployment();
  const wrappedTokenWMOCKAddress = await wrappedTokenWMOCK.getAddress();
  console.log("WrappedToken ($WYDA):", wrappedTokenWMOCKAddress);

  // Deploy WrappedToken ($YMOCK)
  const WrappedTokenYMOCK = await ethers.getContractFactory("WrappedToken");
  const wrappedTokenYMOCK = await WrappedTokenYMOCK.deploy("Yada PEPE", "YPEPE", bridgeAddress);
  await wrappedTokenYMOCK.waitForDeployment();
  const wrappedTokenYMOCKAddress = await wrappedTokenYMOCK.getAddress();
  console.log("WrappedToken ($YPEPE):", wrappedTokenYMOCKAddress);

  // Deploy YadaERC20 ($YDA)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const yadaERC20 = await MockERC20.deploy("Yada cross-chain", "YDA", ethers.parseEther("1000"));
  await yadaERC20.waitForDeployment();
  const yadaERC20Address = await yadaERC20.getAddress();
  console.log("Yada Cross-chain ($YDA):", yadaERC20Address);

  const mockPepe = await MockERC20.deploy("Pepe", "PEPE", ethers.parseEther("1000"));
  await mockPepe.waitForDeployment();
  const mockPepeAddress = await mockPepe.getAddress();
  console.log("Mock PEPE:", mockPepeAddress);

  // Deploy MockAggregatorV3 for PEPE
  const PriceFeedAggregatorV3 = await ethers.getContractFactory("PriceFeedAggregatorV3");
  const priceFeed = await PriceFeedAggregatorV3.deploy(ethers.parseUnits("100000.0", 8)); // e.g., $0.0001 per PEPE, 8 decimals
  await priceFeed.waitForDeployment();
  const priceFeedAddress = await priceFeed.getAddress();
  console.log("Price Feed (PEPE/USD):", priceFeedAddress);
  await bridge.setTokenPriceFeed(mockPepeAddress, priceFeedAddress);

  // Configure contracts
  await keyLogRegistry.setAuthorizedCaller(bridgeAddress);
  console.log("Set KeyLogRegistry authorized caller to Bridge");

  await bridge.addTokenPair(yadaERC20Address, wrappedTokenWMOCKAddress, true);
  console.log("Added token pair: $YDA -> $WYDA (cross-chain)");
  await bridge.addTokenPair(mockPepeAddress, wrappedTokenYMOCKAddress, false);
  console.log("Added token pair: $PEPE -> $YPEPE (on-chain)");

  // Set price feed for PEPE
  await bridge.setTokenPriceFeed(mockPepeAddress, priceFeedAddress);
  console.log("Set price feed for $PEPE");

  // Verify deployment
  const feeCollector = await bridge.feeCollector();
  console.log("FeeCollector:", feeCollector);

  // Return addresses
  const addresses = {
    keyLogRegistry: keyLogRegistryAddress,
    bridge: bridgeAddress,
    wrappedTokenWMOCK: wrappedTokenWMOCKAddress,
    wrappedTokenYMOCK: wrappedTokenYMOCKAddress,
    yadaERC20: yadaERC20Address,
    pepeERC20_2: mockPepeAddress,
    mockPriceFeed: priceFeedAddress,
  };

  console.log("\nCopy these into your React component:");
  console.log(`const BRIDGE_ADDRESS = "${bridgeAddress}";`);
  console.log(`const KEYLOG_REGISTRY_ADDRESS = "${keyLogRegistryAddress}";`);
  console.log(`const WRAPPED_TOKEN_ADDRESS = "${wrappedTokenWMOCKAddress}"; // $WYDA`);
  console.log(`const Y_WRAPPED_TOKEN_ADDRESS = "${wrappedTokenYMOCKAddress}"; // $YPEPE`);
  console.log(`const MOCK_ERC20_ADDRESS = "${yadaERC20Address}"; // $YDA`);
  console.log(`const MOCK2_ERC20_ADDRESS = "${mockPepeAddress}"; // $PEPE`);

  return addresses;
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