import pkg from "hardhat";
const { ethers, upgrades } = pkg;
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
  // Replace with your actual WrappedTokenFactory proxy address
  const factoryProxyAddress = "0x707C03d34957bF600C17b8596BD48438E2B2a58f";

  console.log("Upgrading WrappedTokenFactory proxy at:", factoryProxyAddress);

  // Get signer (must be the current owner — bridge owner via delegation)
  console.log("Using deployer:", deployer.address);

  // Get factory
  const WrappedTokenFactoryUpgrade = await ethers.getContractFactory(
    "WrappedTokenFactoryUpgrade",
    deployer
  );

  const BridgeOld = await ethers.getContractFactory(
    "WrappedTokenFactoryUpgrade",
    deployer
  );
  await upgrades.forceImport(factoryProxyAddress, BridgeOld, { kind: "uups" });
  // Optional: Validate upgrade safety first
  console.log("Validating upgrade...");
  await upgrades.validateUpgrade(
    factoryProxyAddress,
    WrappedTokenFactoryUpgrade,
    {
      kind: "uups",
    }
  );

  // Perform the UUPS upgrade
  console.log("Upgrading proxy...");
  const upgradedFactory = await upgrades.upgradeProxy(
    factoryProxyAddress,
    WrappedTokenFactoryUpgrade,
    {
      kind: "uups",
    }
  );

  console.log("Upgrade successful!");
  console.log("Proxy address (unchanged):", upgradedFactory.target);

  // Verify new function works
  await upgradedFactory.setBridge("0xBa61F5428aE4F43EE526aB5ED0d85018fA218577");
  const testString = await upgradedFactory.getTestString();
  console.log("Test result:", testString); // Should print "Upgraded WrappedTokenFactory v5!"

  // Optional: Test setBridge
  // await upgradedFactory.setBridge("0xNewBridgeAddress");

  console.log("WrappedTokenFactory upgrade complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Upgrade failed:", error);
    process.exit(1);
  });
