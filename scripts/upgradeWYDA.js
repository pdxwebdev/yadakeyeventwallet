import pkg from "hardhat";
const { ethers, network } = pkg;
import bs58 from "bs58";

const CURRENT_WIF = process.env.WIF; // Current key (unconfirmed)

function createWalletFromWIF(wif) {
  const decoded = bs58.decode(wif);
  if (decoded.length !== 34 && decoded.length !== 38) {
    throw new Error("Invalid WIF key length");
  }
  const privateKey = decoded.subarray(1, 33);
  return new ethers.Wallet(ethers.hexlify(privateKey), ethers.provider);
}

async function main() {
  const deployer = createWalletFromWIF(CURRENT_WIF);
  const proxyAddress = "0x105A494F92f2C736f774A7ED0CFC6EA3CB6499B7"; // <-- REPLACE with your actual proxy address

  if (!ethers.isAddress(proxyAddress)) {
    throw new Error("Invalid proxy address provided");
  }

  console.log("Preparing upgrade for MockERC20 proxy at:", proxyAddress);

  // Get the contract factories
  const MockERC20Upgrade = await ethers.getContractFactory(
    "MockERC20Upgrade",
    deployer
  );

  // Optional: Validate the upgrade first (highly recommended)
  console.log("Validating upgrade safety...");
  await upgrades.validateUpgrade(proxyAddress, MockERC20Upgrade, {
    kind: "uups",
    //unsafeAllow: ["delegatecall"], // SafeERC20 inside OZ upgradeable libs can trigger this in older plugin versions
  });

  // Perform the upgrade
  console.log("Upgrading proxy...");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, MockERC20Upgrade, {
    kind: "uups",
    //unsafeAllow: ["delegatecall"], // Keep this if validation complains
  });

  console.log("Upgrade successful!");
  console.log("Proxy now points to new implementation");
  console.log(
    "New implementation address:",
    await upgrades.erc1967.getImplementationAddress(proxyAddress)
  );

  // Verify the new function works
  const mockErc20 = await ethers.getContractAt(
    "MockERC20Upgrade",
    proxyAddress,
    deployer
  );

  await mockErc20.setBridge("0x3471134Bf6478993545bdf5C2a170A2150caB0c3");
  const testString = await mockErc20.getTestString();
  console.log("Test function result:", testString); // Should print "Upgraded MockERC20 v7!"

  console.log("Done!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Upgrade failed:", error);
    process.exit(1);
  });
