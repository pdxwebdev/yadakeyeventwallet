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
  const beaconAddress = "0x54De45901EE4202979cf0A2b131aC795B805AF8F";
  console.log("Upgrading WrappedToken implementation via beacon...");

  // Deploy new implementation
  const WrappedTokenV2 = await ethers.getContractFactory(
    "WrappedTokenUpgrade",
    deployer
  );
  const newImpl = await WrappedTokenV2.deploy();
  await newImpl.waitForDeployment();
  const newImplAddress = await newImpl.getAddress();
  console.log("New implementation deployed at:", newImplAddress);

  // Connect to beacon (owner is bridge's owner)
  const beacon = await ethers.getContractAt(
    "WrappedTokenBeacon",
    beaconAddress,
    deployer
  );

  console.log(await beacon.owner());
  console.log(deployer.address);
  //await beacon.setBridge("0xBa61F5428aE4F43EE526aB5ED0d85018fA218577");
  // Upgrade beacon to point to new implementation
  const tx = await beacon.upgradeTo(newImplAddress);
  await tx.wait();
  console.log("Beacon upgraded successfully!");

  // Verify
  const currentImpl = await beacon.implementation();
  console.log("Beacon now points to:", currentImpl);

  // Test on one proxy
  const proxyAddress = "0xCF4DC8Ae3275e4190e1B16d6e5aD5ac7cB972528";
  const token = await ethers.getContractAt("WrappedTokenUpgrade", proxyAddress);
  console.log("Version from proxy:", await token.getTestString());
  console.log("Version from proxy beacon:", await token.getTestStringBeacon());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Upgrade failed:", error);
    process.exit(1);
  });
