import pkg from "hardhat";
import fs from "fs";
import bs58 from "bs58";
import * as shajs from "sha.js";
import * as tinysecp256k1 from "tiny-secp256k1";
import MockERC20Artifact from "../src/utils/abis/MockERC20.json" assert { type: "json" };
import WrappedTokenArtifact from "../src/utils/abis/WrappedToken.json" assert { type: "json" };
import {
  createParamsArrayFromObject,
  signatureFields,
} from "../src/utils/signature.js";
const { ethers, upgrades, network } = pkg;

const ERC20_ABI = MockERC20Artifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;

const NATIVE_ASSET_ADDRESS = "0x0000000000000000000000000000000000000000";

const createWalletFromWIF = (wif) => {
  const decoded = bs58.decode(wif);
  if (decoded.length !== 34 && decoded.length !== 38) {
    throw new Error("Invalid WIF key length");
  }
  const privateKey = decoded.subarray(1, 33);
  return new ethers.Wallet(ethers.hexlify(privateKey), ethers.provider);
};

async function isContractDeployed(address) {
  if (!address || address === ethers.ZeroAddress) return false;
  const code = await ethers.provider.getCode(address);
  return code !== "0x";
}

async function generateKeyData(deployer, nextDeployer, nextNextDeployer) {
  const currentWallet = deployer;
  const nextWallet = nextDeployer;
  const nextNextWallet = nextNextDeployer;

  currentWallet.uncompressedPublicKey = ethers.hexlify(
    tinysecp256k1
      .pointFromScalar(
        Buffer.from(currentWallet.privateKey.slice(2), "hex"),
        false
      )
      .slice(1)
  );
  nextWallet.uncompressedPublicKey = ethers.hexlify(
    tinysecp256k1
      .pointFromScalar(
        Buffer.from(nextWallet.privateKey.slice(2), "hex"),
        false
      )
      .slice(1)
  );
  nextNextWallet.uncompressedPublicKey = ethers.hexlify(
    tinysecp256k1
      .pointFromScalar(
        Buffer.from(nextNextWallet.privateKey.slice(2), "hex"),
        false
      )
      .slice(1)
  );

  return {
    currentSigner: currentWallet,
    nextSigner: nextWallet,
    nextNextSigner: nextNextWallet,
  };
}

export async function main() {
  const wif = process.env.WIF;
  const wif2 = process.env.WIF2;
  const wif3 = process.env.WIF3;
  const confirmingPrerotatedKeyHash = process.env.CPRKH;
  const confirmingTwicePrerotatedKeyHash = process.env.CTPRKH;
  const clean = process.env.CLEAN;

  if (!wif || !wif2 || !wif3) {
    throw new Error("WIF, WIF2, or WIF3 environment variable not set");
  }

  const deploymentsFile = "./deployments.json";
  let deployments = fs.existsSync(deploymentsFile)
    ? JSON.parse(fs.readFileSync(deploymentsFile))
    : {};

  if (deployments.keyLogRegistryAddress && !clean) {
    const isDeployed = await isContractDeployed(
      deployments.keyLogRegistryAddress
    );
    if (isDeployed) {
      console.log("Using saved deployments");
      return { ...deployments };
    }
  }

  const deployer = createWalletFromWIF(wif);
  const nextDeployer = createWalletFromWIF(wif2);
  const nextNextDeployer = createWalletFromWIF(wif3);

  // Generate key data
  const keyData = await generateKeyData(
    deployer,
    nextDeployer,
    nextNextDeployer
  );
  console.log("Deploying with:", keyData.currentSigner.address);
  console.log("Next key wallet:", keyData.nextSigner.address);
  console.log("Next next key wallet:", keyData.nextNextSigner.address);
  let balance = await ethers.provider.getBalance(keyData.currentSigner.address);

  console.log("Deployer balance:", ethers.formatEther(balance));

  if (network.name === "localhost") {
    // Fund deployer
    const [hardhatAccount] = await ethers.getSigners();
    const tx2 = await hardhatAccount.sendTransaction({
      to: deployer.address,
      value: ethers.parseEther("1000.0"),
    });
    await tx2.wait();
    console.log(`Funded ${deployer.address} with 1000 ETH/BNB`);
  }

  // Deploy KeyLogRegistry as a UUPS proxy
  const KeyLogRegistry = await ethers.getContractFactory(
    "KeyLogRegistry",
    deployer
  );
  let keyLogRegistry;
  if (deployments.keyLogRegistryAddress && !clean) {
    keyLogRegistry = await KeyLogRegistry.attach(
      deployments.keyLogRegistryAddress
    );
    console.log(
      "Using existing KeyLogRegistry proxy:",
      deployments.keyLogRegistryAddress
    );
  } else {
    keyLogRegistry = await upgrades.deployProxy(
      KeyLogRegistry,
      [deployer.address], // Initialize with deployer as owner and bridge
      {
        initializer: "initialize",
        kind: "uups",
        deployer: deployer,
      }
    );
    await keyLogRegistry.waitForDeployment();
    deployments.keyLogRegistryAddress = await keyLogRegistry.getAddress();
    console.log("KeyLogRegistry proxy:", deployments.keyLogRegistryAddress);
  }
  const keyLogRegistryAddress = deployments.keyLogRegistryAddress;
  // Deploy Bridge
  const Bridge = await ethers.getContractFactory("Bridge", deployer);
  let bridge;
  if (deployments.bridgeAddress && !clean) {
    bridge = await ethers.getContractAt(
      "Bridge",
      deployments.bridgeAddress,
      deployer
    );
    console.log("Using existing Bridge proxy:", deployments.bridgeAddress);
  } else {
    bridge = await upgrades.deployProxy(
      Bridge,
      [keyLogRegistryAddress, ethers.ZeroAddress],
      {
        initializer: "initialize",
        kind: "uups",
        deployer: deployer,
      }
    );
    await bridge.waitForDeployment();
    deployments.bridgeAddress = await bridge.getAddress();
    console.log("Bridge proxy deployed to:", deployments.bridgeAddress);
  }
  const bridgeAddress = deployments.bridgeAddress;

  // Deploy WrappedToken implementation
  const WrappedToken = await ethers.getContractFactory(
    "WrappedToken",
    deployer
  );
  const wrappedTokenImpl = await WrappedToken.deploy();
  await wrappedTokenImpl.waitForDeployment();
  deployments.wrappedTokenImplementation = await wrappedTokenImpl.getAddress();
  console.log(
    "WrappedToken implementation:",
    deployments.wrappedTokenImplementation
  );
  // Deploy WrappedTokenBeacon
  const WrappedTokenBeacon = await ethers.getContractFactory(
    "WrappedTokenBeacon",
    deployer
  );
  let beacon;
  if (deployments.beaconAddress && !clean) {
    beacon = await WrappedTokenBeacon.attach(deployments.beaconAddress);
    console.log(
      "Using existing WrappedTokenBeacon:",
      deployments.beaconAddress
    );
  } else {
    beacon = await ethers.deployContract(
      "WrappedTokenBeacon",
      [deployments.wrappedTokenImplementation, deployments.bridgeAddress],
      {
        signer: deployer, // your ethers.Wallet or signer
      }
    );
    await beacon.waitForDeployment();
    const beaconAddress = await beacon.getAddress();
    const beaconContract = await ethers.getContractAt(
      "WrappedTokenBeacon",
      beaconAddress,
      deployer
    );

    console.log(deployments.bridgeAddress);
    console.log(deployments.wrappedTokenImplementation);
    const currentImplementation = await beaconContract.implementation();
    console.log(
      "WrappedTokenBeacon already initialized with implementation:",
      currentImplementation
    );

    const beaconOwner = await beaconContract.owner();
    console.log("beaconOwner: ", beaconOwner);
    await beacon.waitForDeployment();
    deployments.beaconAddress = await beacon.getAddress();
    console.log("WrappedTokenBeacon deployed to:", deployments.beaconAddress);
  }
  console.log("Beacon bridge address:", await beacon.bridgeAddress());
  const beaconAddress = deployments.beaconAddress;
  await bridge.connect(deployer).setWrappedTokenBeacon(beaconAddress);
  console.log("Updated Bridge with WrappedTokenBeacon address:", beaconAddress);

  // Deploy WrappedTokenFactory
  const WrappedTokenFactory = await ethers.getContractFactory(
    "WrappedTokenFactory",
    deployer
  );
  let factory;
  if (deployments.factoryAddress && !clean) {
    console.log(
      "Using existing WrappedTokenFactory:",
      deployments.factoryAddress
    );
  } else {
    factory = await upgrades.deployProxy(
      WrappedTokenFactory,
      [beaconAddress, deployer.address, deployments.bridgeAddress],
      {
        initializer: "initialize",
        kind: "uups",
        deployer: deployer,
      }
    );
    await factory.waitForDeployment();
    deployments.factoryAddress = await factory.getAddress();
    console.log("WrappedTokenFactory deployed to:", deployments.factoryAddress);
  }
  const factoryAddress = deployments.factoryAddress;
  // Set KeyLogRegistry authorized caller
  const currentAuthorized = await keyLogRegistry.authorizedCaller();
  if (currentAuthorized !== bridgeAddress) {
    await keyLogRegistry.connect(deployer).setAuthorizedCaller(bridgeAddress);
    console.log("Set KeyLogRegistry authorized caller to:", bridgeAddress);
  }
  await bridge
    .connect(deployer)
    .setFeeSigner(
      network.name === "localhost"
        ? "0x903DE6eD93C63Ac5bc51e4dAB50ED2D36e2811BA"
        : "0x37B2b1400292Ee6Ee59a4550704D46311FBDc569"
    );

  // Register initial key log entry
  console.log("Registering initial key log entry...");
  const gasCost = ethers.parseEther("0.0001");
  balance = await ethers.provider.getBalance(keyData.currentSigner.address);
  console.log("Deployer balance:", ethers.formatEther(balance));

  const nonce = await bridge.nonces(deployer.address);
  console.log("Nonce:", nonce.toString());
  const unconfirmedKeyData = {
    amount: 0,
    publicKey: keyData.currentSigner.uncompressedPublicKey,
    prerotatedKeyHash: keyData.nextSigner.address,
    twicePrerotatedKeyHash: keyData.nextNextSigner.address,
    prevPublicKeyHash: ethers.ZeroAddress,
    outputAddress: keyData.nextSigner.address,
  };
  const unconfirmedMessageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(signatureFields, [
      ethers.ZeroAddress,
      [],
      createParamsArrayFromObject(unconfirmedKeyData),
      nonce,
    ])
  );
  const unconfirmedSignature = await deployer.signMessage(
    ethers.getBytes(unconfirmedMessageHash)
  );

  const permitbnb = await generatePermit(
    ethers.ZeroAddress,
    deployer,
    balance - gasCost,
    [
      {
        recipientAddress: keyData.nextSigner.address,
        amount: balance - gasCost,
        wrap: false,
        unwrap: false,
        mint: false,
        burn: false,
      },
    ].filter((r) => r.amount > 0)
  );
  const firstpermits = [permitbnb];
  const tx1 = await bridge.connect(deployer).registerKeyPairWithTransfer(
    ethers.ZeroAddress,
    {
      token: ethers.ZeroAddress,
      fee: 0,
      expires: 0,
      signature: "0x",
    },
    [], // No token pairs in initial registration
    firstpermits,
    unconfirmedKeyData,
    unconfirmedSignature,
    {
      amount: 0,
      publicKey: "0x",
      prerotatedKeyHash: ethers.ZeroAddress,
      twicePrerotatedKeyHash: ethers.ZeroAddress,
      prevPublicKeyHash: ethers.ZeroAddress,
      outputAddress: ethers.ZeroAddress,
    },
    "0x",
    { value: balance - gasCost }
  );
  await tx1.wait();
  console.log(
    `Initial key log entry registered with publicKeyHash: ${keyData.currentSigner.address}, outputAddress: ${keyData.nextSigner.address}`
  );

  // Deploy MockERC20 contracts for non-native tokens
  const MockERC20 = await ethers.getContractFactory("MockERC20", nextDeployer);
  let yadaERC20;
  if (deployments.yadaERC20Address && !clean) {
    yadaERC20 = await MockERC20.attach(deployments.yadaERC20Address);
    console.log(
      "Using existing Yada Cross-chain ($WYDA):",
      deployments.yadaERC20Address
    );
  } else {
    yadaERC20 = await upgrades.deployProxy(
      MockERC20,
      ["Wrapped YadaCoin", "WYDA", deployments.bridgeAddress],
      {
        initializer: "initialize",
        kind: "uups",
        deployer: nextDeployer,
      }
    );
    await yadaERC20.waitForDeployment();
    deployments.yadaERC20Address = await yadaERC20.getAddress();
    console.log("Yada Cross-chain ($WYDA):", deployments.yadaERC20Address);
  }
  const yadaERC20Address = deployments.yadaERC20Address;

  async function generatePermit(
    tokenAddress,
    signer,
    amount,
    recipients,
    nonce
  ) {
    if (tokenAddress.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()) {
      return {
        token: tokenAddress,
        amount: amount,
        recipients: recipients.map((r) => ({
          recipientAddress: r.recipientAddress,
          amount: r.amount,
          wrap: r.wrap || false,
          unwrap: r.unwrap || false,
          mint: r.mint || false,
          burn: r.burn || false,
        })),
        deadline: 0,
        v: 0,
        r: ethers.ZeroHash,
        s: ethers.ZeroHash,
      };
    }

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const domain = {
      name: await new ethers.Contract(tokenAddress, ERC20_ABI, signer).name(),
      version: "1",
      chainId: chainId,
      verifyingContract: tokenAddress,
    };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const deadline = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
    const values = {
      owner: signer.address,
      spender: bridgeAddress,
      value: amount,
      nonce: nonce,
      deadline: deadline,
    };
    const signature = await signer.signTypedData(domain, types, values);
    const { v, r, s } = ethers.Signature.from(signature);
    return {
      token: tokenAddress,
      amount: amount,
      recipients: recipients.map((r) => ({
        recipientAddress: r.recipientAddress,
        amount: r.amount,
        wrap: r.wrap || false,
        unwrap: r.unwrap || false,
        mint: r.mint || false,
        burn: r.burn || false,
      })),
      deadline: deadline,
      v: v,
      r: r,
      s: s,
    };
  }

  // Configure token pairs
  if (!deployments.configured || clean) {
    const supportedTokens = [yadaERC20Address, NATIVE_ASSET_ADDRESS];
    const permits = await Promise.all(
      supportedTokens.map(async (tokenAddress) => {
        if (tokenAddress.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()) {
          return null;
        }
        try {
          const abi = ERC20_ABI;
          const tokenContract = new ethers.Contract(
            tokenAddress,
            abi,
            nextDeployer
          );
          const balance = await tokenContract.balanceOf(nextDeployer.address);
          if (balance > 0n) {
            const tokenNonce = await tokenContract.nonces(nextDeployer.address);
            const permit = await generatePermit(
              tokenAddress,
              nextDeployer,
              balance,
              [
                {
                  recipientAddress: confirmingPrerotatedKeyHash,
                  amount: balance,
                  wrap: false,
                  unwrap: false,
                  mint: false,
                  burn: false,
                },
              ],
              tokenNonce
            );
            if (permit) {
              return permit;
            } else {
              console.warn(`Permit not supported for token ${tokenAddress}`);
            }
          }
          return null;
        } catch (error) {
          console.warn(
            `Error generating permit for token ${tokenAddress}:`,
            error
          );
          return null;
        }
      })
    ).then((results) => results.filter((permit) => permit !== null));
    balance = await ethers.provider.getBalance(keyData.nextSigner.address);
    console.log("Balance for registerKeyPairWithTransfer: ", balance);
    const permitbnb = await generatePermit(
      ethers.ZeroAddress,
      keyData.nextSigner,
      balance - gasCost,
      [
        {
          recipientAddress: confirmingPrerotatedKeyHash,
          amount: balance - gasCost,
          wrap: false,
          unwrap: false,
          mint: false,
          burn: false,
        },
      ].filter((r) => r.amount > 0)
    );
    if (permitbnb) {
      permits.push(permitbnb);
    }

    const nonce = await bridge.nonces(nextDeployer.address);
    console.log("Nonce:", nonce.toString());
    const unconfirmedKeyData = {
      amount: 0n,
      publicKey: keyData.nextSigner.uncompressedPublicKey,
      prerotatedKeyHash: keyData.nextNextSigner.address,
      twicePrerotatedKeyHash: confirmingPrerotatedKeyHash,
      prevPublicKeyHash: keyData.currentSigner.address,
      outputAddress: keyData.nextNextSigner.address,
    };
    const unconfirmedMessageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(signatureFields, [
        ethers.ZeroAddress,
        [],
        createParamsArrayFromObject(unconfirmedKeyData),
        nonce,
      ])
    );
    const unconfirmedSignature = await nextDeployer.signMessage(
      ethers.getBytes(unconfirmedMessageHash)
    );

    const confirmingKeyData = {
      amount: 0n,
      publicKey: keyData.nextNextSigner.uncompressedPublicKey,
      prerotatedKeyHash: confirmingPrerotatedKeyHash,
      twicePrerotatedKeyHash: confirmingTwicePrerotatedKeyHash,
      prevPublicKeyHash: keyData.nextSigner.address,
      outputAddress: confirmingPrerotatedKeyHash,
    };
    const confirmingMessageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(signatureFields, [
        ethers.ZeroAddress,
        [],
        createParamsArrayFromObject(confirmingKeyData),
        nonce + 1n,
      ])
    );
    const confirmingSignature = await nextNextDeployer.signMessage(
      ethers.getBytes(confirmingMessageHash)
    );
    console.log(confirmingKeyData.prerotatedKeyHash);
    const tx = await bridge.connect(nextDeployer).registerKeyPairWithTransfer(
      ethers.ZeroAddress, //token
      {
        token: ethers.ZeroAddress,
        fee: 0,
        expires: 0,
        signature: "0x",
      }, //fee
      [], //tokenpairs
      permits,
      unconfirmedKeyData,
      unconfirmedSignature,
      confirmingKeyData,
      confirmingSignature,
      { value: balance - gasCost }
    );
    await tx.wait();
    console.log("Added all token pairs: $YDA, BNB");
    console.log("new keylog owner: ", await keyLogRegistry.owner());
    // deployments.wrappedTokenWMOCKAddress = await bridge.originalToWrapped(
    //   yadaERC20Address
    // );
    // deployments.wrappedNativeTokenAddress = await bridge.originalToWrapped(
    //   NATIVE_ASSET_ADDRESS
    // );

    deployments.configured = true;
  }

  fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));

  return deployments;
}

main()
  .then((output) => {
    console.log(output);
  })
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
