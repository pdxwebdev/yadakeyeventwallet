import pkg from "hardhat";
const { ethers } = pkg;
import bs58 from "bs58";

const CURRENT_WIF = process.env.WIF; // Current bridge owner key

function createWalletFromWIF(wif) {
  const decoded = bs58.decode(wif);
  if (decoded.length !== 34 && decoded.length !== 38) {
    throw new Error("Invalid WIF key length");
  }
  const privateKey = decoded.subarray(1, 33);
  return new ethers.Wallet(ethers.hexlify(privateKey), ethers.provider);
}

async function main() {
  if (!CURRENT_WIF) {
    throw new Error("WIF environment variable not set");
  }

  const deployer = createWalletFromWIF(CURRENT_WIF);
  console.log("Using deployer (bridge owner):", deployer.address);

  const beaconAddress = "0x54De45901EE4202979cf0A2b131aC795B805AF8F"; // <-- REPLACE with your actual WrappedTokenBeacon address

  console.log("Upgrading WrappedTokenBeacon at:", beaconAddress);

  // Step 1: Deploy new implementation
  const WrappedTokenBeaconUpgrade = await ethers.getContractFactory(
    "WrappedTokenBeaconUpgrade",
    deployer
  );

  const newImpl = await WrappedTokenBeaconUpgrade.deploy(
    "0x3471134Bf6478993545bdf5C2a170A2150caB0c3",
    "0x3471134Bf6478993545bdf5C2a170A2150caB0c3"
  );
  await newImpl.waitForDeployment();
  const newImplAddress = await newImpl.getAddress();
  console.log("New implementation deployed at:", newImplAddress);

  // Step 2: Connect to beacon with the bridge owner signer
  const beacon = await ethers.getContractAt(
    "WrappedTokenBeaconUpgrade", // Use new ABI to access new functions
    beaconAddress,
    deployer
  );

  // Optional: Test current owner
  const currentOwner = await beacon.owner();
  console.log("Current beacon owner:", currentOwner);

  // Step 3: Upgrade the beacon
  console.log("Upgrading beacon to new implementation...");
  const tx = await beacon.upgradeTo(newImplAddress);
  await tx.wait();
  console.log("Beacon upgrade transaction successful:", tx.hash);

  // Verify
  const currentImpl = await beacon.implementation();
  console.log("Beacon now points to:", currentImpl);

  // Optional: Test setBridge if you added it
  await beacon.setBridge("0xBa61F5428aE4F43EE526aB5ED0d85018fA218577");

  console.log("WrappedTokenBeacon upgrade complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Upgrade failed:", error);
    process.exit(1);
  });
