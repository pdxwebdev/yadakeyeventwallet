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
    [keyLogRegistryAddress], // Matches your initialize(address _keyLogRegistry)
    {
      initializer: "initialize",
      kind: "uups",
    }
  );
  await bridge.waitForDeployment();
  const bridgeAddress = await bridge.getAddress();
  console.log("Bridge:", bridgeAddress);

  // Deploy WrappedToken ($WMOCK)
  const WrappedTokenWMOCK = await ethers.getContractFactory("WrappedToken");
  const wrappedTokenWMOCK = await WrappedTokenWMOCK.deploy("Wrapped Mock", "WMOCK", bridgeAddress);
  await wrappedTokenWMOCK.waitForDeployment();
  const wrappedTokenWMOCKAddress = await wrappedTokenWMOCK.getAddress();
  console.log("WrappedToken ($WMOCK):", wrappedTokenWMOCKAddress);

  // Deploy WrappedToken ($YMOCK)
  const WrappedTokenYMOCK = await ethers.getContractFactory("WrappedToken");
  const wrappedTokenYMOCK = await WrappedTokenYMOCK.deploy("Yield Mock", "YMOCK", bridgeAddress);
  await wrappedTokenYMOCK.waitForDeployment();
  const wrappedTokenYMOCKAddress = await wrappedTokenYMOCK.getAddress();
  console.log("WrappedToken ($YMOCK):", wrappedTokenYMOCKAddress);

  // Deploy MockERC20 ($MOCK)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", ethers.parseEther("1000"));
  await mockERC20.waitForDeployment();
  const mockERC20Address = await mockERC20.getAddress();
  console.log("MockERC20 ($MOCK):", mockERC20Address);

  // Deploy MockERC20 ($MOCK2)
  const mockERC20_2 = await MockERC20.deploy("Mock Token 2", "MOCK2", ethers.parseEther("1000"));
  await mockERC20_2.waitForDeployment();
  const mockERC20_2Address = await mockERC20_2.getAddress();
  console.log("MockERC20 ($MOCK2):", mockERC20_2Address);

  // Configure contracts
  await keyLogRegistry.setAuthorizedCaller(bridgeAddress);
  console.log("Set KeyLogRegistry authorized caller to Bridge");

  await bridge.addTokenPair(mockERC20Address, wrappedTokenWMOCKAddress, true); // $MOCK -> $WMOCK (cross-chain)
  console.log("Added token pair: $MOCK -> $WMOCK (cross-chain)");
  await bridge.addTokenPair(mockERC20_2Address, wrappedTokenYMOCKAddress, false); // $MOCK2 -> $YMOCK (on-chain)
  console.log("Added token pair: $MOCK2 -> $YMOCK (on-chain)");

  // Verify deployment
  const feeCollector = await bridge.feeCollector();
  console.log("FeeCollector:", feeCollector);

  // Return addresses
  const addresses = {
    keyLogRegistry: keyLogRegistryAddress,
    bridge: bridgeAddress,
    wrappedTokenWMOCK: wrappedTokenWMOCKAddress,
    wrappedTokenYMOCK: wrappedTokenYMOCKAddress,
    mockERC20: mockERC20Address,
    mockERC20_2: mockERC20_2Address,
  };

  // Log React-friendly output
  console.log("\nCopy these into your React component:");
  console.log(`const BRIDGE_ADDRESS = "${bridgeAddress}";`);
  console.log(`const KEYLOG_REGISTRY_ADDRESS = "${keyLogRegistryAddress}";`);
  console.log(`const WRAPPED_TOKEN_ADDRESS = "${wrappedTokenWMOCKAddress}"; // $WMOCK`);
  console.log(`const Y_WRAPPED_TOKEN_ADDRESS = "${wrappedTokenYMOCKAddress}"; // $YMOCK`);
  console.log(`const MOCK_ERC20_ADDRESS = "${mockERC20Address}"; // $MOCK`);
  console.log(`const MOCK2_ERC20_ADDRESS = "${mockERC20_2Address}"; // $MOCK2`);

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