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
  const proxyAddress = "0xD84B7E8b295d9Fa9656527AC33Bf4F683aE7d2C4"; // <-- REPLACE with your actual proxy address

  if (!ethers.isAddress(proxyAddress)) {
    throw new Error("Invalid proxy address provided");
  }

  const mockErc20 = await ethers.getContractAt(
    "MockERC20Upgrade",
    proxyAddress,
    deployer
  );
  console.log(await mockErc20.owner());
  console.log(deployer.address);
  await mockErc20.setBridge("0xBa61F5428aE4F43EE526aB5ED0d85018fA218577");
  const testString = await mockErc20.getTestString();
  console.log("Test function result:", testString); // Should print "Upgraded MockERC20 v7!"

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

  console.log("Done!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Upgrade failed:", error);
    process.exit(1);
  });
