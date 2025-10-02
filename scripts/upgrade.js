import pkg from "hardhat";
import bs58 from "bs58";
import fs from "fs";
const { ethers, network } = pkg;

const createWalletFromWIF = (wif) => {
  const decoded = bs58.decode(wif);
  if (decoded.length !== 34 && decoded.length !== 38) {
    throw new Error("Invalid WIF key length");
  }
  const privateKey = decoded.subarray(1, 33);
  return new ethers.Wallet(ethers.hexlify(privateKey), ethers.provider);
};

async function main() {
  const wif = process.env.WIF;

  if (!wif) {
    throw new Error("WIF environment variable not set");
  }

  const deploymentsFile = "./deployments.json";
  let deployments = fs.existsSync(deploymentsFile)
    ? JSON.parse(fs.readFileSync(deploymentsFile))
    : { tokenAddresses: {} };

  const deployer = createWalletFromWIF(wif);
  console.log("Upgrading with deployer:", deployer.address);

  let results = {};

  try {
    // Connect to the Bridge contract
    const proxyAddress = deployments.bridgeAddress;
    const bridgeContract = await ethers.getContractAt(
      "Bridge",
      proxyAddress,
      deployer
    );
    console.log(`Connected to Bridge contract at: ${proxyAddress}`);

    const keyLogRegistryContract = await ethers.getContractAt(
      "KeyLogRegistry",
      deployments.bridgeAddress,
      deployer
    );

    const keyLogOwner = await keyLogRegistryContract.owner();
    console.log("key log contract owner: ", keyLogOwner);

    // Verify deployer is the owner
    const bridgeOwner = await bridgeContract.owner();
    console.log("Bridge owner: ", bridgeOwner);
    if (bridgeOwner.toLowerCase() !== deployer.address.toLowerCase()) {
      throw new Error(
        `Deployer ${deployer.address} is not the owner of Bridge contract`
      );
    }

    // Deploy new implementation contracts
    const KeyLogRegistryV2 = await ethers.getContractFactory(
      "KeyLogRegistryUpgrade",
      deployer
    );
    console.log("Upgrading KeyLogRegistry proxy...");
    const keyLogRegistryV2Impl = await KeyLogRegistryV2.deploy();
    await keyLogRegistryV2Impl.waitForDeployment();
    const keyLogRegistryV2Address = await keyLogRegistryV2Impl.getAddress();

    const keyLogRegistry = await upgrades.upgradeProxy(
      deployments.keyLogRegistryAddress,
      KeyLogRegistryV2,
      {
        kind: "uups",
        deployer,
      }
    );
    await keyLogRegistry.waitForDeployment();
    console.log("KeyLogRegistry upgraded to:", keyLogRegistry.target);
    console.log(`Current proxy keylog`);
    console.log(
      `Deployed KeyLogRegistryV2 implementation at: ${keyLogRegistryV2Address}`
    );

    const BridgeV2 = await ethers.getContractFactory("BridgeUpgrade", deployer);
    const bridgeV2Impl = await BridgeV2.deploy();
    await bridgeV2Impl.waitForDeployment();
    const bridgeV2Address = await bridgeV2Impl.getAddress();
    console.log(`Deployed BridgeV2 implementation at: ${bridgeV2Address}`);
    // Upgrade Bridge
    const upgradedBridge = await upgrades.upgradeProxy(
      deployments.bridgeAddress,
      BridgeV2,
      {
        kind: "uups",
        deployer,
      }
    );
    await upgradedBridge.waitForDeployment();
    console.log(`Bridge upgraded at proxy: ${proxyAddress}`);
    console.log(`Upgrade bridge: ${upgradedBridge.target}`);
    results.bridge = { status: true, proxyAddress };

    const MockERC20Upgrade = await ethers.getContractFactory(
      "MockERC20Upgrade",
      deployer
    );
    const MockERC20UpgradeImpl = await MockERC20Upgrade.deploy();
    await MockERC20UpgradeImpl.waitForDeployment();
    const MockERC20UpgradeAddress = await MockERC20UpgradeImpl.getAddress();
    console.log(`Deployed BridgeV2 implementation at: ${bridgeV2Address}`);
    // Upgrade Bridge
    const upgradedBMockErc20 = await upgrades.upgradeProxy(
      deployments.yadaERC20Address,
      MockERC20Upgrade,
      {
        kind: "uups",
        deployer,
      }
    );
    await upgradedBMockErc20.waitForDeployment();
    console.log(`Upgrade bridge: ${upgradedBMockErc20.target}`);
    results.MockERC20 = { status: true, MockERC20UpgradeAddress };

    // Upgrade WrappedTokenFactory
    const WrappedTokenFactory = await ethers.getContractFactory(
      "WrappedTokenFactoryUpgrade",
      deployer
    );
    console.log("Upgrading KeyLogRegistry proxy...");
    const WrappedTokenFactoryImpl = await WrappedTokenFactory.deploy();
    await WrappedTokenFactoryImpl.waitForDeployment();
    const WrappedTokenFactoryAddress =
      await WrappedTokenFactoryImpl.getAddress();

    const wappedTokenFactory = await upgrades.upgradeProxy(
      deployments.factoryAddress,
      WrappedTokenFactory,
      {
        kind: "uups",
        deployer,
      }
    );
    await keyLogRegistry.waitForDeployment();

    // Upgrade WrappedTokenBeacon implementation
    console.log(`WrappedTokenBeacon at: ${deployments.beaconAddress}`);
    console.log("Upgrading WrappedTokenBeacon implementation...");

    // Connect to WrappedTokenBeacon and upgrade
    console.log("hello");
    const beacon = await ethers.getContractAt(
      "WrappedTokenBeacon",
      deployments.beaconAddress,
      deployer
    );
    const WrappedTokenV2 = await ethers.getContractFactory(
      "WrappedTokenUpgrade",
      deployer
    );
    const wrappedTokenV2 = await WrappedTokenV2.deploy();
    await wrappedTokenV2.waitForDeployment();
    const newImplementation = await wrappedTokenV2.getAddress();
    await (await beacon.upgradeTo(newImplementation)).wait();
    console.log(
      "Deployed WrappedTokenV2 implementation at:",
      newImplementation
    );

    // Verify the beacon's implementation
    const currentImplementation = await beacon.implementation();
    console.log(
      "Verified: Beacon now points to implementation:",
      currentImplementation
    );

    results.wrappedTokenBeacon = {
      status: true,
      beaconAddress: deployments.beaconAddress,
      newImplementation: newImplementation,
    };

    // Update deployments.json with new implementation address
    deployments.wrappedTokenImplementation = newImplementation;
    fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));
    console.log(
      "Updated deployments.json with new WrappedToken implementation"
    );

    return { status: true, results };
  } catch (err) {
    console.error("Upgrade failed:", err);
    return { status: false, message: err.message, results };
  }
}

main()
  .then((output) => {
    console.log(output);
  })
  .catch((error) => {
    console.error("Upgrade failed:", error);
    process.exit(1);
  });
