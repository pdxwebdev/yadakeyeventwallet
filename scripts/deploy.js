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
  const bridge = await upgrades.deployProxy(Bridge, [keyLogRegistryAddress], {
    initializer: "initialize",
    kind: "uups",
  });
  await bridge.waitForDeployment();
  const bridgeAddress = await bridge.getAddress();
  console.log("Bridge:", bridgeAddress);

  // Deploy WrappedToken
  const WrappedToken = await ethers.getContractFactory("WrappedToken");
  const wrappedToken = await WrappedToken.deploy("Wrapped Mock", "WMOCK", bridgeAddress);
  await wrappedToken.waitForDeployment();
  const wrappedTokenAddress = await wrappedToken.getAddress();
  console.log("WrappedToken:", wrappedTokenAddress);

  // Deploy MockERC20
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", ethers.parseEther("1000"));
  await mockERC20.waitForDeployment();
  const mockERC20Address = await mockERC20.getAddress();
  console.log("MockERC20:", mockERC20Address);

  // Configure contracts
  await keyLogRegistry.setAuthorizedCaller(bridgeAddress);
  console.log("Set KeyLogRegistry authorized caller to Bridge");

  await bridge.addTokenPair(mockERC20Address, wrappedTokenAddress, false);
  console.log("Added token pair to Bridge");
  // Verify deployment
  const feeCollector = await bridge.feeCollector();
  console.log("FeeCollector:", feeCollector);

  // Return addresses
  const addresses = {
    keyLogRegistry: keyLogRegistryAddress,
    bridge: bridgeAddress,
    wrappedToken: wrappedTokenAddress,
    mockERC20: mockERC20Address,
  };

  // Log React-friendly output
  console.log("\nCopy these into your React component:");
  console.log(`const BRIDGE_ADDRESS = "${bridgeAddress}";`);
  console.log(`const KEYLOG_REGISTRY_ADDRESS = "${keyLogRegistryAddress}";`);
  console.log(`const WRAPPED_TOKEN_ADDRESS = "${wrappedTokenAddress}";`);
  console.log(`const MOCK_ERC20_ADDRESS = "${mockERC20Address}";`);

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