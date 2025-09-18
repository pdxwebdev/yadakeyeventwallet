import pkg from "hardhat";
import bs58 from "bs58";
import fs from "fs";
const { ethers, upgrades, network } = pkg;

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
  const proxyAddress = process.env.PROXY_ADDRESS;
  try {
    const deployer = createWalletFromWIF(wif);
    const BridgeV2 = await ethers.getContractFactory("Bridge2", deployer);

    await upgrades.upgradeProxy(proxyAddress, BridgeV2, {
      kind: "uups",
    });
    return { status: true };
  } catch (err) {
    return { status: false, message: err };
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
