/**
 * Migration script: Deploy fresh Bridge + KeyLogRegistry + WrappedTokenFactory (all non-upgradeable),
 * deploy new WrappedTokenBeacon, and upgrade WYDA impl.
 *
 * What this does:
 *   1. Deploy new KeyLogRegistry (plain contract)
 *   2. Deploy new WrappedToken implementation
 *   3. Deploy new WrappedTokenBeacon (plain contract)
 *   4. Deploy new Bridge (plain contract), wired to KLR + beacon
 *   5. Deploy new WrappedTokenFactory (plain contract), wired to beacon + bridge
 *   6. Set authorizedCaller on KLR → new Bridge
 *   7. Transfer KLR ownership → new Bridge
 *   8. Upgrade WYDA (MockERC20) proxy impl → new MockERC20.sol  (signed by OLD owner)
 *   9. Call setBridge on WYDA → new Bridge            (signed by OLD owner)
 *   10. Update src/shared/constants.js with new addresses
 *   11. Write new addresses to deployments-migration.json
 *
 * Requirements:
 *   NEW_WIF=<new owner WIF>  — fresh wallet that will own the new system
 *                              Must be pre-funded with BNB for gas
 *   OLD_WIF=<old owner WIF>  — current bridge owner (0xB162DFa...)
 *                              Used only for WYDA upgrade steps
 *
 * Run:
 *   NEW_WIF=<wif> OLD_WIF=<wif> npx hardhat run scripts/migrate.js --network bscMainnet
 *
 * DRY RUN (no real txs):
 *   DRY_RUN=1 NEW_WIF=<wif> OLD_WIF=<wif> npx hardhat run scripts/migrate.js --network bscMainnet
 */

import pkg from "hardhat";
const { ethers } = pkg;
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = path.resolve(__dirname, "../src/shared/constants.js");

// ── config ─────────────────────────────────────────────────────────────────────
const WYDA_PROXY = "0xD84B7E8b295d9Fa9656527AC33Bf4F683aE7d2C4";
const OLD_BRIDGE = "0xBa61F5428aE4F43EE526aB5ED0d85018fA218577";
const DRY_RUN = !!process.env.DRY_RUN;
const OUTPUT_FILE = "./deployments-migration.json";

// ── helpers ────────────────────────────────────────────────────────────────────
function createWalletFromWIF(wif) {
  const decoded = bs58.decode(wif);
  if (decoded.length !== 34 && decoded.length !== 38)
    throw new Error("Invalid WIF length");
  const privateKey = decoded.subarray(1, 33);
  return new ethers.Wallet(ethers.hexlify(privateKey), ethers.provider);
}

async function deploy(name, signer, ...constructorArgs) {
  if (DRY_RUN) {
    console.log(
      `  [DRY RUN] Would deploy ${name}(${constructorArgs.join(", ")})`
    );
    return `<${name}>`;
  }
  console.log(`  Deploying ${name}...`);
  const Factory = await ethers.getContractFactory(name, signer);
  const contract = await Factory.deploy(...constructorArgs);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ✓ ${name}: ${addr}`);
  return addr;
}

async function sendTx(label, txPromise) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would send: ${label}`);
    return null;
  }
  console.log(`  Sending: ${label}`);
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`  ✓ ${label} — tx: ${receipt.hash}`);
  return receipt;
}

// ── main ───────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.NEW_WIF)
    throw new Error("NEW_WIF env var required (fresh wallet for new system)");
  if (!process.env.OLD_WIF)
    throw new Error(
      "OLD_WIF env var required (current bridge owner for WYDA upgrade)"
    );

  const newOwner = createWalletFromWIF(process.env.NEW_WIF);
  const oldOwner = createWalletFromWIF(process.env.OLD_WIF);
  const newOwnerAddr = await newOwner.getAddress();
  const oldOwnerAddr = await oldOwner.getAddress();

  console.log("\n=== YadaWallet Migration ===");
  console.log("New owner (deployer):", newOwnerAddr);
  console.log("Old owner (WYDA ops):", oldOwnerAddr);
  console.log("DRY_RUN:", DRY_RUN);

  // Verify old owner is the current WYDA bridge owner
  // WYDA proxy stores the bridge address; that bridge's owner must sign the upgrade
  const wydaCheck = new ethers.Contract(
    WYDA_PROXY,
    ["function bridge() view returns (address)"],
    ethers.provider
  );
  const wydaBridge = await wydaCheck.bridge();
  const wydaBridgeContract = new ethers.Contract(
    wydaBridge,
    ["function owner() view returns (address)"],
    ethers.provider
  );
  const currentOwner = await wydaBridgeContract.owner();
  if (currentOwner.toLowerCase() !== oldOwnerAddr.toLowerCase()) {
    throw new Error(
      `OLD_WIF address ${oldOwnerAddr} is not the WYDA bridge owner ${currentOwner} (bridge: ${wydaBridge})`
    );
  }
  console.log(
    `✓ OLD_WIF confirmed as WYDA bridge owner (bridge: ${wydaBridge})`
  );

  // Check new owner has enough BNB for gas
  const newOwnerBal = await ethers.provider.getBalance(newOwnerAddr);
  if (newOwnerBal === 0n && !DRY_RUN) {
    throw new Error(
      `NEW_WIF address ${newOwnerAddr} has 0 BNB — send gas money first`
    );
  }
  console.log(
    `✓ New owner BNB balance: ${ethers.formatEther(newOwnerBal)} BNB\n`
  );

  const deployer = newOwner; // alias for readability
  const deployerAddr = newOwnerAddr;

  const results = {};

  // ── 1. Deploy new KeyLogRegistry ─────────────────────────────────────────────
  console.log("── Step 1: Deploy new KeyLogRegistry ──");
  // constructor(address initialOwner)
  const klrAddr = await deploy("KeyLogRegistry", deployer, deployerAddr);
  results.keyLogRegistry = klrAddr;

  // ── 2. Deploy new WrappedToken implementation ────────────────────────────────
  console.log("\n── Step 2: Deploy new WrappedToken implementation ──");
  const wtImplAddr = await deploy("WrappedToken", deployer);
  results.wrappedTokenImpl = wtImplAddr;

  // ── 3. Deploy new WrappedTokenBeacon ─────────────────────────────────────────
  console.log("\n── Step 3: Deploy new WrappedTokenBeacon ──");
  // constructor(address implementation, address _bridgeAddress)
  // Bridge address not known yet — we pass a placeholder and update in step 3b,
  // OR we precompute the bridge address via nonce prediction.
  // Since Bridge is deployed next (step 4), predict its address now.
  const deployerNonce = await ethers.provider.getTransactionCount(deployerAddr);
  // Bridge deploy = nonce N  →  bridge address is predictable
  const futureBridgeAddr = ethers.getCreateAddress({
    from: deployerAddr,
    nonce: deployerNonce + 1,
  });
  console.log(`  Precomputed Bridge address: ${futureBridgeAddr}`);

  const beaconAddr = await deploy(
    "WrappedTokenBeacon",
    deployer,
    wtImplAddr,
    futureBridgeAddr,
    deployerAddr
  );
  results.wrappedTokenBeacon = beaconAddr;

  // ── 4. Deploy new Bridge ─────────────────────────────────────────────────────
  console.log("\n── Step 4: Deploy new Bridge ──");
  // constructor(address _keyLogRegistry, address _wrappedTokenBeacon, address _wrappedTokenFactory)
  // WrappedTokenFactory is deployed after Bridge (step 5), so pass address(0) for now
  // and call setWrappedTokenFactory once factory is deployed.
  const bridgeAddr = await deploy(
    "Bridge",
    deployer,
    klrAddr,
    beaconAddr,
    ethers.ZeroAddress
  );
  results.bridge = bridgeAddr;

  if (!DRY_RUN && bridgeAddr.toLowerCase() !== futureBridgeAddr.toLowerCase()) {
    console.warn(
      `  ⚠️  Bridge address ${bridgeAddr} differs from precomputed ${futureBridgeAddr}`
    );
    console.warn(
      "  Beacon bridgeAddress will be wrong — redeploy beacon with correct address."
    );
  } else {
    console.log("  ✓ Bridge address matches precomputed value");
  }

  // ── 5. Deploy new WrappedTokenFactory ────────────────────────────────────────
  console.log("\n── Step 5: Deploy new WrappedTokenFactory ──");
  // constructor(address _beacon, address _bridge)
  const factoryAddr = await deploy(
    "WrappedTokenFactory",
    deployer,
    beaconAddr,
    bridgeAddr
  );
  results.wrappedTokenFactory = factoryAddr;

  // Wire factory into bridge
  await sendTx(
    `bridge.setWrappedTokenFactory(${factoryAddr})`,
    (
      await ethers.getContractAt("Bridge", bridgeAddr, deployer)
    ).setWrappedTokenFactory(factoryAddr)
  );

  // ── 6. Set authorizedCaller on KeyLogRegistry → new Bridge ───────────────────
  console.log(
    "\n── Step 6: Set authorizedCaller on KeyLogRegistry → new Bridge ──"
  );
  await sendTx(
    `keyLogRegistry.setAuthorizedCaller(${bridgeAddr})`,
    (
      await ethers.getContractAt("KeyLogRegistry", klrAddr, deployer)
    ).setAuthorizedCaller(bridgeAddr)
  );

  // ── 7. Transfer KeyLogRegistry ownership → new Bridge ────────────────────────
  console.log("\n── Step 7: Transfer KeyLogRegistry ownership → new Bridge ──");
  // New KLR is fresh — OZ Ownable transferOwnership works directly (no key log check needed
  // since isValidOwnershipTransfer is only enforced by Bridge.transferOwnership, not KLR directly)
  await sendTx(
    `keyLogRegistry.transferOwnership(${bridgeAddr})`,
    (
      await ethers.getContractAt("KeyLogRegistry", klrAddr, deployer)
    ).transferOwnership(bridgeAddr)
  );

  // ── 8. Upgrade WYDA (MockERC20) proxy impl ───────────────────────────────────
  console.log(
    "\n── Step 8: Upgrade WYDA impl → new MockERC20 (via new bridge) ──"
  );
  const newMockERC20ImplAddr = await deploy("MockERC20", newOwner);
  results.wYDANewImpl = newMockERC20ImplAddr;

  // Step 8a: Point WYDA at the new bridge first (callable by old owner EOA via IBridge(oldBridge).getOwner())
  const wydaSetBridge = new ethers.Contract(
    WYDA_PROXY,
    ["function setBridge(address) external"],
    oldOwner
  );
  await sendTx(
    `wyda.setBridge(${bridgeAddr})`,
    wydaSetBridge.setBridge(bridgeAddr)
  );

  // Step 8b: Upgrade WYDA proxy directly (owner EOA is authorized via IBridge(bridge).getOwner())
  const wydaProxy = await ethers.getContractAt(
    "MockERC20",
    WYDA_PROXY,
    deployer
  );
  await sendTx(
    `wydaProxy.upgradeToAndCall(${newMockERC20ImplAddr})`,
    wydaProxy.upgradeToAndCall(newMockERC20ImplAddr, "0x")
  );

  results.wydaProxy = WYDA_PROXY;

  // ── 10. Update src/shared/constants.js ──────────────────────────────────────
  console.log("\n── Step 10: Update src/shared/constants.js ──");
  updateConstantsJs({
    keyLogRegistryAddress: klrAddr,
    bridgeAddress: bridgeAddr,
    wrappedTokenImplementation: wtImplAddr,
    beaconAddress: beaconAddr,
    factoryAddress: factoryAddr,
    yadaERC20Address: WYDA_PROXY,
  });

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log("\n=== Migration Complete ===");
  console.log(JSON.stringify(results, null, 2));
  if (!DRY_RUN) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\n✓ Addresses written to ${OUTPUT_FILE}`);
  }

  console.log(
    "\n── Manual steps remaining ──────────────────────────────────────────"
  );
  console.log(
    `1. Send BNB from old owner to new owner for gas (if not already done):`
  );
  console.log(`   from: ${oldOwnerAddr}  →  to: ${newOwnerAddr}`);
  console.log(
    `2. Register inception key log on new Bridge (new owner's first tx):`
  );
  console.log(
    `   bridge.registerKeyPairWithTransfer(...) with inception key data`
  );
  console.log(`3. Register token pairs on new Bridge`);
  console.log(`4. Verify all new contracts on BSCScan`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

function updateConstantsJs(addrs) {
  if (!fs.existsSync(CONSTANTS_PATH)) {
    console.warn(
      `  ⚠️  constants.js not found at ${CONSTANTS_PATH} — skipping`
    );
    return;
  }
  let src = fs.readFileSync(CONSTANTS_PATH, "utf8");

  // Replace the mainnet addresses block between the first `? {` and its closing `}`
  // We match the known keys so we don't accidentally clobber testnet/hardhat blocks.
  src = src.replace(
    /(DEPLOY_ENV === "mainnet"\s*\?\s*\{[^}]*keyLogRegistryAddress:\s*")[^"]*(",)/,
    `$1${addrs.keyLogRegistryAddress}$2`
  );
  src = src.replace(
    /(keyLogRegistryAddress:[^,]*,\s*bridgeAddress:\s*")[^"]*(",)/,
    `$1${addrs.bridgeAddress}$2`
  );
  src = src.replace(
    /(wrappedTokenImplementation:\s*\n?\s*")[^"]*(",)/,
    `$1${addrs.wrappedTokenImplementation}$2`
  );
  src = src.replace(
    /(beaconAddress:\s*")[^"]*(",)/,
    `$1${addrs.beaconAddress}$2`
  );
  src = src.replace(
    /(factoryAddress:\s*")[^"]*(",)/,
    `$1${addrs.factoryAddress}$2`
  );
  src = src.replace(
    /(yadaERC20Address:\s*")[^"]*(",)/,
    `$1${addrs.yadaERC20Address}$2`
  );

  fs.writeFileSync(CONSTANTS_PATH, src, "utf8");
  console.log(`  ✓ constants.js updated at ${CONSTANTS_PATH}`);
  console.log(`    bridgeAddress:           ${addrs.bridgeAddress}`);
  console.log(`    keyLogRegistryAddress:   ${addrs.keyLogRegistryAddress}`);
  console.log(`    beaconAddress:           ${addrs.beaconAddress}`);
  console.log(`    factoryAddress:          ${addrs.factoryAddress}`);
  console.log(
    `    wrappedTokenImpl:        ${addrs.wrappedTokenImplementation}`
  );
  console.log(
    `    yadaERC20Address:        ${addrs.yadaERC20Address} (unchanged)`
  );
}
