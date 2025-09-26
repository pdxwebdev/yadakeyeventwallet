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
  const deploymentsFile = "./deployments.json";
  let deployments = fs.existsSync(deploymentsFile)
    ? JSON.parse(fs.readFileSync(deploymentsFile))
    : { tokenAddresses: {} };
  const deployer = createWalletFromWIF(wif);
  console.log("Testing bridgeAddress: ", deployments.bridgeAddress);

  // Test bridge upgrade
  const bridgeContract = await ethers.getContractAt(
    "BridgeUpgrade",
    deployments.bridgeAddress,
    deployer
  );
  const bridgeUpgradeProof = await bridgeContract.testUpgrade();
  console.log(bridgeUpgradeProof);

  // Test key log registry upgrade
  console.log(
    "Testing keyLogRegistryAddress: ",
    deployments.keyLogRegistryAddress
  );
  const keyLogRegistryContract = await ethers.getContractAt(
    "KeyLogRegistryUpgrade",
    deployments.keyLogRegistryAddress,
    deployer
  );
  const keylogRegistryUpgradeProof =
    await keyLogRegistryContract.getTestString();
  console.log(keylogRegistryUpgradeProof);

  // Test Wrapped Token Factory upgrade
  const wrappedTokenFactoryContract = await ethers.getContractAt(
    "WrappedTokenFactoryUpgrade",
    deployments.factoryAddress,
    deployer
  );
  const wrappedTokenFactoryProof =
    await wrappedTokenFactoryContract.getTestString();
  console.log(wrappedTokenFactoryProof);

  //test wrapped token upgrade
  const supportedTokens = await bridgeContract.getSupportedTokens();
  console.log(supportedTokens);

  await Promise.all(
    supportedTokens.map(async (original) => {
      try {
        console.log("pair", original);
        const pair = await bridgeContract.tokenPairs(original);
        console.log(pair);

        const tokenProxy = await ethers.getContractAt(
          "WrappedTokenUpgrade", // note: use the upgraded ABI
          pair[1],
          deployer
        );
        const testString = await tokenProxy.getTestString();
        console.log("getTestString() output:", testString);
      } catch (erro) {
        console.log(erro);
      }
    })
  );
}

main()
  .then((output) => {
    console.log(output);
  })
  .catch((error) => {
    console.error("Upgrade failed:", error);
    process.exit(1);
  });
