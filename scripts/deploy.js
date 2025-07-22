import pkg from "hardhat";
import fs from 'fs';
import bs58 from 'bs58';
import * as shajs from "sha.js";
import * as tinysecp256k1 from "tiny-secp256k1";
const { ethers, upgrades } = pkg;

// Function to read and parse WIF key from a file
const readWIFKeyFromFile = (filePath) => {
  try {
    // const wif = fs.readFileSync(filePath, 'utf8').trim();
    // if (!wif) {
    //   throw new Error("WIF key file is empty");
    // }
    const wif = 'L44MBqEgnbSKVJz6BVC7ke7G7MaKEV4zhfXZNoAMX4vBSYNLgc5Q'
    // Decode WIF key (Base58)
    const decoded = bs58.decode(wif);
    if (decoded.length !== 34 && decoded.length !== 38) {
      throw new Error("Invalid WIF key length");
    }

    // Extract private key (remove version byte and checksum)
    const privateKey = decoded.subarray(1, 33); // First 32 bytes after version byte
    return ethers.hexlify(privateKey); // Convert to hex for ethers
  } catch (error) {
    throw new Error(`Failed to read or parse WIF key: ${error.message}`);
  }
};

// Generate a secure derivation path (optional, if still needed for other purposes)
const generateSHA256 = async (input) => {
  return new shajs.sha256().update(input).digest("hex");
};

// Function to create a wallet from WIF
const createWalletFromWIF = (wifFilePath) => {
  const privateKey = readWIFKeyFromFile(wifFilePath);
  return new ethers.Wallet(privateKey, ethers.provider);
};

async function main() {
  // Path to the WIF key file
  const wifFilePath = "./privateKey.wif"; // Adjust to your file path

  // Create wallet from WIF
  const deployer = createWalletFromWIF(wifFilePath);
  console.log("Deploying with:", deployer.address);

  // Fund the derived account
  const [hardhatAccount] = await ethers.getSigners(); // Get a funded Hardhat account
  const tx = await hardhatAccount.sendTransaction({
    to: deployer.address,
    value: ethers.parseEther("1000.0"), // Send 1 ETH to the derived account
  });
  await tx.wait();
  console.log(`Funded ${deployer.address} with 1 ETH`);

  // Second wallet (if needed, provide another WIF file or reuse logic)
  const testAccount2 = createWalletFromWIF("./privateKey2.wif"); // Adjust to another WIF file
  const tx2 = await hardhatAccount.sendTransaction({
    to: testAccount2.address,
    value: ethers.parseEther("1000.0"), // Send 1 ETH to the derived account
  });
  await tx2.wait();

  // Fund another address
  const tx3 = await hardhatAccount.sendTransaction({
    to: '0x6302D4F75c297FC0cf3742b5f38543Ce2d70Ed9b',
    value: ethers.parseEther("1000.0"), // Send 1 ETH
  });
  await tx3.wait();

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

    // Transfer ownership to the derived account used in the React app
    console.log("Transferring KeyLogRegistry ownership to derived address:", deployer.address);
    await (await keyLogRegistry.transferOwnership(deployer.address)).wait();
    console.log("KeyLogRegistry ownership transferred to:", deployer.address);
    console.log("New KeyLogRegistry owner:", await keyLogRegistry.owner());
  }
  const keyLogRegistryAddress = deployments.keyLogRegistry;

  // Deploy Bridge
  const Bridge = await ethers.getContractFactory("Bridge", deployer); // Explicitly use deployer
  let bridge;
  if (deployments.bridge) {
    bridge = await ethers.getContractAt("Bridge", deployments.bridge, deployer);
    console.log("Using existing Bridge proxy:", deployments.bridge);
  } else {
    bridge = await upgrades.deployProxy(
      Bridge,
      [keyLogRegistryAddress],
      {
        initializer: "initialize",
        kind: "uups",
        deployer: deployer, // Ensure deployer is used
      }
    );
    await bridge.waitForDeployment();
    deployments.bridge = await bridge.getAddress();
    console.log("Bridge deployed to:", deployments.bridge);
    console.log("Bridge owner:", await bridge.owner());
    // Verify ownership
    if ((await bridge.owner()) !== deployer.address) {
      console.log("Transferring Bridge ownership to:", deployer.address);
      await (await bridge.connect(deployer).transferOwnership(deployer.address)).wait();
      console.log("New Bridge owner:", await bridge.owner());
    }
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

  // Output for React
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
    console.log("Using existing Yada Cross-chain ($WYDA):", deployments.yadaERC20);
    // Check if deployer has tokens; if not, transfer from original minter
    const wydaBalance = await yadaERC20.balanceOf(deployer.address);
    if (wydaBalance < ethers.parseEther("1000")) {
      const [hardhatAccount] = await ethers.getSigners();
      const hardhatWydaBalance = await yadaERC20.balanceOf(hardhatAccount.address);
      if (hardhatWydaBalance >= ethers.parseEther("1000")) {
        await yadaERC20.connect(hardhatAccount).transfer(deployer.address, ethers.parseEther("1000"));
        console.log(`Transferred 1000 WYDA from ${hardhatAccount.address} to ${deployer.address}`);
      } else {
        throw new Error(`No sufficient WYDA balance in ${hardhatAccount.address}`);
      }
    }
  } else {
    yadaERC20 = await MockERC20.connect(deployer).deploy("Yada cross-chain", "WYDA", ethers.parseEther("1000"));
    await yadaERC20.waitForDeployment();
    deployments.yadaERC20 = await yadaERC20.getAddress();
    console.log("Yada Cross-chain ($WYDA):", deployments.yadaERC20);
  }
  const yadaERC20Address = deployments.yadaERC20;

  // Verify WYDA balance
  const wydaBalance = await yadaERC20.balanceOf(deployer.address);
  console.log(`WYDA balance of ${deployer.address}: ${ethers.formatEther(wydaBalance)} WYDA`);

  // Deploy Mock PEPE
  let mockPepe;
  if (deployments.pepeERC20_2) {
    mockPepe = await MockERC20.attach(deployments.pepeERC20_2);
    console.log("Using existing Mock PEPE:", deployments.pepeERC20_2);
    // Check if deployer has tokens; if not, transfer from original minter
    const pepeBalance = await mockPepe.balanceOf(deployer.address);
    if (pepeBalance < ethers.parseEther("1000")) {
      const [hardhatAccount] = await ethers.getSigners();
      const hardhatPepeBalance = await mockPepe.balanceOf(hardhatAccount.address);
      if (hardhatPepeBalance >= ethers.parseEther("1000")) {
        await mockPepe.connect(hardhatAccount).transfer(deployer.address, ethers.parseEther("1000"));
        console.log(`Transferred 1000 PEPE from ${hardhatAccount.address} to ${deployer.address}`);
      } else {
        throw new Error(`No sufficient PEPE balance in ${hardhatAccount.address}`);
      }
    }
  } else {
    mockPepe = await MockERC20.connect(deployer).deploy("Pepe", "PEPE", ethers.parseEther("1000"));
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
    // Connect keyLogRegistry to deployer to ensure the owner calls the function
    await keyLogRegistry.connect(deployer).setAuthorizedCaller(bridgeAddress);
    console.log("Set KeyLogRegistry authorized caller to Bridge");

    // Configure Bridge (only owner can call these)
    await bridge.connect(deployer).addTokenPair(yadaERC20Address, wrappedTokenWMOCKAddress, true);
    console.log("Added token pair: $YDA -> $WYDA (cross-chain)");

    await bridge.connect(deployer).addTokenPair(mockPepeAddress, wrappedTokenYMOCKAddress, false);
    console.log("Added token pair: $PEPE -> $YPEPE (on-chain)");

    await bridge.connect(deployer).setTokenPriceFeed(mockPepeAddress, priceFeedAddress);
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

  // After deploying the Bridge
  const bridge2 = await ethers.getContractAt("Bridge", deployments.bridge, deployer);
  console.log("Bridge proxy address:", deployments.bridge);
  console.log("Bridge owner:", await bridge2.owner());
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