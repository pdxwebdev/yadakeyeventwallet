import pkg from "hardhat";
import bs58 from "bs58";
import fs from "fs";
import * as tinysecp256k1 from "tiny-secp256k1";
import {
  createParamsArrayFromObject,
  signatureFields,
} from "../src/utils/signature.js";
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils/deploy.js";
const { ethers, network } = pkg;
import KeyLogRegistryArtifact from "../src/utils/abis/KeyLogRegistry.json" with { type: "json" };
export const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;

// Load deployments
const deploymentsFile = "./deployments.json";
if (!fs.existsSync(deploymentsFile)) {
  throw new Error("deployments.json not found. Run deploy first.");
}
const deployments = JSON.parse(fs.readFileSync(deploymentsFile));
function reviveBigInts(obj) {
  if (typeof obj === "string") {
    // Check if it's a numeric string (integer, possibly very large)
    if (/^-?\d+$/.test(obj)) {
      try {
        return BigInt(obj);
      } catch (e) {
        // If too large for BigInt (extremely unlikely), fall back to string
        return obj;
      }
    }
    return obj; // regular string
  }

  if (Array.isArray(obj)) {
    return obj.map(reviveBigInts);
  }

  if (obj && typeof obj === "object") {
    const revived = {};
    for (const [key, value] of Object.entries(obj)) {
      revived[key] = reviveBigInts(value);
    }
    return revived;
  }

  return obj; // number, boolean, null, etc.
}
// Environment variables
const CURRENT_WIF = process.env.WIF; // Current key (unconfirmed)
const CONFIRMING_WIF = process.env.CONFIRMING_WIF; // Next key (confirming) - required for secure upgrade
const confirmingPrerotatedKeyHash = process.env.CPRKH;
const confirmingTwicePrerotatedKeyHash = process.env.CTPRKH;
let permits = JSON.parse(process.env.PERMITS)
permits = reviveBigInts(permits);
console.log(permits)

if (!CURRENT_WIF) {
  throw new Error("WIF environment variable not set (current key)");
}

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
  console.log("Upgrading with current key:", deployer.address);

  const bridgeProxyAddress = deployments.bridgeAddress;
  if (!bridgeProxyAddress) {
    throw new Error("bridgeAddress not found in deployments.json");
  }

  // Connect to current Bridge proxy
  let bridge2 = await ethers.getContractAt(
    "Bridge",
    bridgeProxyAddress,
    deployer
  );
  console.log("Connected to Bridge proxy at:", bridgeProxyAddress);

  // Deploy new Bridge implementation
  const BridgeNew = await ethers.getContractFactory("BridgeUpgrade", deployer);
  const newImpl = await BridgeNew.deploy();
  await newImpl.waitForDeployment();
  const newImplAddress = await newImpl.getAddress();
  console.log("Deployed new Bridge implementation at:", newImplAddress);

  // Check if the current implementation supports upgradeWithKeyRotation
  const currentCode = await ethers.provider.getCode(bridgeProxyAddress);
  const iface = new ethers.Interface([
    "function upgradeWithKeyRotation(address,Params,bytes,Params,bytes)",
  ]);
  const selector = iface.getFunction("upgradeWithKeyRotation")?.selector;

  let supportsKeyRotationUpgrade = false;
  try {
    const bridgeNewABI = await ethers.getContractAt(
      "BridgeUpgrade",
      bridgeProxyAddress
    );
    await bridgeNewABI.getTestString(); // This will succeed if upgraded
    console.log("Detected UPGRADED Bridge (getTestString() exists)");
    supportsKeyRotationUpgrade = true;

    // Reattach bridge with new ABI for the rest of the script
    bridge = await ethers.getContractAt(
      "BridgeUpgrade",
      bridgeProxyAddress,
      deployer
    );
  } catch (err) {
    console.log(err);
    console.log(
      "Legacy Bridge detected (getTestString() not found) — using old ABI"
    );
    // Keep using original bridge (old ABI) — safe for legacy upgrade
    supportsKeyRotationUpgrade = false;
  }

  if (true) {
    console.log("Using SECURE upgradeWithKeyRotation method");

    if (!CONFIRMING_WIF) {
      throw new Error(
        "CONFIRMING_WIF required for secure key-rotation upgrade"
      );
    }

    const confirmingWallet = createWalletFromWIF(CONFIRMING_WIF);
    console.log("Confirming key address:", confirmingWallet.address);

    deployer.uncompressedPublicKey = ethers.hexlify(
      tinysecp256k1
        .pointFromScalar(
          Buffer.from(deployer.privateKey.slice(2), "hex"),
          false
        )
        .slice(1)
    );
    confirmingWallet.uncompressedPublicKey = ethers.hexlify(
      tinysecp256k1
        .pointFromScalar(
          Buffer.from(confirmingWallet.privateKey.slice(2), "hex"),
          false
        )
        .slice(1)
    );
    // Build Params structs
    const currentPublicKey = deployer.signingKey.publicKey.slice(2); // remove 0x04 prefix
    const confirmingPublicKey = confirmingWallet.signingKey.publicKey.slice(2);

    const keyLogRegistry = new ethers.Contract(
      deployments.keyLogRegistryAddress,
      KEYLOG_REGISTRY_ABI,
      deployer
    );
    const publicKey = Buffer.from(
      deployer.signingKey.publicKey.slice(2),
      "hex"
    ).slice(1);
    const log = await keyLogRegistry.buildFromPublicKey(publicKey);
    console.log(log[log.length - 1].publicKeyHash);
    console.log(log[log.length - 1].prerotatedKeyHash === deployer.address);
    console.log(log[log.length - 1].twicePrerotatedKeyHash === confirmingWallet.address);

    const bridge = await ethers.getContractAt(
      "BridgeUpgrade",
      bridgeProxyAddress,
      deployer
    );
    const nonce = await bridge.nonces(deployer.address);
    console.log("Current nonce:", nonce.toString());

    const unconfirmedParams = {
      amount: 0,
      publicKey: deployer.uncompressedPublicKey,
      prerotatedKeyHash: confirmingWallet.address, // fill if known, or set correctly
      twicePrerotatedKeyHash: confirmingPrerotatedKeyHash,
      prevPublicKeyHash: log[log.length - 1].publicKeyHash,
      outputAddress: confirmingWallet.address, // typically next key
    };

    const confirmingParams = {
      amount: 0,
      publicKey: confirmingWallet.uncompressedPublicKey,
      prerotatedKeyHash: confirmingPrerotatedKeyHash,
      twicePrerotatedKeyHash: confirmingTwicePrerotatedKeyHash,
      prevPublicKeyHash: deployer.address,
      outputAddress: confirmingPrerotatedKeyHash,
    };
    console.log("about to hash");
    console.log(newImplAddress);
    console.log(confirmingWallet.address);
    console.log(confirmingWallet.uncompressedPublicKey);
    console.log(confirmingPrerotatedKeyHash)
    console.log(confirmingTwicePrerotatedKeyHash)
    // Hash messages
    const unconfirmedHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(signatureFields, [
        newImplAddress,
        [],
        createParamsArrayFromObject(unconfirmedParams),
        nonce,
      ])
    );
    console.log("done unconfirmed hash");
    const confirmingHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(signatureFields, [
        newImplAddress,
        [],
        createParamsArrayFromObject(confirmingParams),
        nonce + 1n,
      ])
    );
    console.log("done confirmed hash");

    // Sign
    const unconfirmedSig = await deployer.signMessage(
      ethers.getBytes(unconfirmedHash)
    );
    const confirmingSig = await confirmingWallet.signMessage(
      ethers.getBytes(confirmingHash)
    );

    // Execute secure upgrade
    const balance = await ethers.provider.getBalance(deployer.address);
    const tx = await bridge.upgradeWithKeyRotation(
      newImplAddress,
      {
        token: ethers.ZeroAddress,
        fee: 0,
        expires: 0,
        signature: "0x"
      },
      permits,
      unconfirmedParams,
      unconfirmedSig,
      confirmingParams,
      confirmingSig
    );
    const receipt = await tx.wait();
    console.log(await bridge.getTestString());
    console.log("Secure upgrade transaction sent:", tx.hash);
    console.log("Secure upgrade confirmed in block:", receipt.blockNumber);

    return { status: true };
  } else {
    console.log("Using LEGACY owner-based UUPS upgrade");

    // Verify ownership
    const owner = await bridge2.owner();
    console.log("Current owner:", owner);
    console.log("Current deployer:", deployer.address);
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
      throw new Error(
        "Deployer is not the owner - cannot perform legacy upgrade"
      );
    }
    const BridgeOld = await ethers.getContractFactory("Bridge", deployer);
    await upgrades.forceImport(bridgeProxyAddress, BridgeOld, { kind: "uups" });

    // 2️⃣ Get the upgraded factory
    const BridgeUpgrade2 = await ethers.getContractFactory("BridgeUpgrade", deployer);

    // 3️⃣ Upgrade the proxy (OpenZeppelin will deploy new implementation internally)
    const upgraded = await upgrades.upgradeProxy(
      bridgeProxyAddress,
      BridgeUpgrade2,
      { kind: "uups" }
    );

    // 4️⃣ Required in ethers v6
    await upgraded.waitForDeployment();

    // 5️⃣ Reattach new ABI
    const bridge = await ethers.getContractAt("BridgeUpgrade", bridgeProxyAddress);

    // ✅ Check version
    console.log(await bridge.getTestString());

    // 6️⃣ Check implementation slot
    const bridgeImplAddress = await upgrades.erc1967.getImplementationAddress(bridgeProxyAddress);
    const code = await ethers.provider.getCode(bridgeImplAddress);
    console.log(bridgeImplAddress)
    console.log(code.includes("_authorizeUpgrade") ? "Has authorizeUpgrade" : "No authorizeUpgrade");


  }

  fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));
  console.log("deployments.json updated with new implementation address");

  console.log("Upgrade complete!");
    return { status: true };
}

main()
  .then((output) => {
    console.log(output);
  })
  .catch((error) => {
    console.log(permits);
    console.error("Upgrade failed:", error);
    process.exit(1);
  });
