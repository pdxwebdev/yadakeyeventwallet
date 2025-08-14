import pkg from "hardhat";
import fs from 'fs';
import bs58 from 'bs58';
import * as shajs from "sha.js";
import * as tinysecp256k1 from "tiny-secp256k1";
import MockERC20Artifact from "../src/utils/abis/MockERC20.json" assert { type: "json" };
import WrappedTokenArtifact from "../src/utils/abis/WrappedToken.json" assert { type: "json" };
const { ethers, upgrades } = pkg;

const ERC20_ABI = MockERC20Artifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;

const NATIVE_ASSET_ADDRESS = "0x0000000000000000000000000000000000000000";

const readWIFKeyFromFile = (filePath) => {
  try {
    const wif = fs.readFileSync(filePath, 'utf8').trim();
    if (!wif) {
      throw new Error("WIF key file is empty");
    }
    const decoded = bs58.decode(wif);
    if (decoded.length !== 34 && decoded.length !== 38) {
      throw new Error("Invalid WIF key length");
    }
    const privateKey = decoded.subarray(1, 33);
    return ethers.hexlify(privateKey);
  } catch (error) {
    throw new Error(`Failed to read or parse WIF key: ${error.message}`);
  }
};

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
  return code !== '0x';
}

async function generateKeyData(deployer, nextDeployer, nextNextDeployer) {
  const currentWallet = deployer;
  const nextWallet = nextDeployer;
  const nextNextWallet = nextNextDeployer;

  currentWallet.uncompressedPublicKey = ethers.hexlify(tinysecp256k1.pointFromScalar(Buffer.from(currentWallet.privateKey.slice(2), 'hex'), false).slice(1));
  nextWallet.uncompressedPublicKey = ethers.hexlify(tinysecp256k1.pointFromScalar(Buffer.from(nextWallet.privateKey.slice(2), 'hex'), false).slice(1));
  nextNextWallet.uncompressedPublicKey = ethers.hexlify(tinysecp256k1.pointFromScalar(Buffer.from(nextNextWallet.privateKey.slice(2), 'hex'), false).slice(1));

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
    const isDeployed = await isContractDeployed(deployments.keyLogRegistryAddress);
    if (isDeployed) {
      console.log('Using saved deployments');
      return { ...deployments };
    }
  }

  const deployer = createWalletFromWIF(wif);
  const nextDeployer = createWalletFromWIF(wif2);
  const nextNextDeployer = createWalletFromWIF(wif3);
  console.log("Deploying with:", deployer.address);
  console.log("Next key wallet:", nextDeployer.address);
  console.log("Next next key wallet:", nextNextDeployer.address);

  // Fund deployer
  const [hardhatAccount] = await ethers.getSigners();
  const tx = await hardhatAccount.sendTransaction({
    to: deployer.address,
    value: ethers.parseEther("1000.0"),
  });
  await tx.wait();
  console.log(`Funded ${deployer.address} with 1000 ETH/BNB`);

  // Deploy KeyLogRegistry
  const KeyLogRegistry = await ethers.getContractFactory("KeyLogRegistry", deployer);
  let keyLogRegistry;
  if (deployments.keyLogRegistryAddress && !clean) {
    keyLogRegistry = await KeyLogRegistry.attach(deployments.keyLogRegistryAddress);
    console.log("Using existing KeyLogRegistry:", deployments.keyLogRegistryAddress);
  } else {
    keyLogRegistry = await KeyLogRegistry.deploy();
    await keyLogRegistry.waitForDeployment();
    deployments.keyLogRegistryAddress = await keyLogRegistry.getAddress();
    console.log("KeyLogRegistry:", deployments.keyLogRegistryAddress);
  }
  const keyLogRegistryAddress = deployments.keyLogRegistryAddress;

  // Deploy Mock BNB/USD Price Feed
  const PriceFeedAggregatorV3 = await ethers.getContractFactory("PriceFeedAggregatorV3", deployer);
  let bnbPriceFeed;
  if (deployments.bnbPriceFeedAddress && !clean) {
    bnbPriceFeed = await PriceFeedAggregatorV3.attach(deployments.bnbPriceFeedAddress);
    console.log("Using existing BNB/USD Price Feed:", deployments.bnbPriceFeedAddress);
  } else {
    bnbPriceFeed = await PriceFeedAggregatorV3.deploy(ethers.parseUnits("500.0", 8)); // Mock BNB price: $500, 8 decimals
    await bnbPriceFeed.waitForDeployment();
    deployments.bnbPriceFeedAddress = await bnbPriceFeed.getAddress();
    console.log("BNB/USD Price Feed:", deployments.bnbPriceFeedAddress);
  }
  const bnbPriceFeedAddress = deployments.bnbPriceFeedAddress;

  // Deploy Bridge
  const Bridge = await ethers.getContractFactory("Bridge", deployer);
  let bridge;
  if (deployments.bridgeAddress && !clean) {
    bridge = await ethers.getContractAt("Bridge", deployments.bridgeAddress, deployer);
    console.log("Using existing Bridge proxy:", deployments.bridgeAddress);
  } else {
    bridge = await upgrades.deployProxy(
      Bridge,
      [keyLogRegistryAddress, bnbPriceFeedAddress], // Pass _keyLogRegistry and _ethPriceFeed
      {
        initializer: "initialize",
        kind: "uups",
        deployer: deployer,
      }
    );
    await bridge.waitForDeployment();
    deployments.bridgeAddress = await bridge.getAddress();
    console.log("Bridge deployed to:", deployments.bridgeAddress);
  }
  const bridgeAddress = deployments.bridgeAddress;

  // Set KeyLogRegistry authorized caller
  const currentAuthorized = await keyLogRegistry.authorizedCaller();
  if (currentAuthorized !== bridgeAddress) {
    await keyLogRegistry.connect(deployer).setAuthorizedCaller(bridgeAddress);
    console.log("Set KeyLogRegistry authorized caller to:", bridgeAddress);
  }

  // Generate key data
  const keyData = await generateKeyData(deployer, nextDeployer, nextNextDeployer);
  const balance = await ethers.provider.getBalance(keyData.currentSigner.address);
  console.log("Registering initial key log entry...");
  console.log("Deployer balance:", ethers.formatEther(balance));
  await bridge.connect(deployer).registerKeyWithTransfer(
    keyData.currentSigner.uncompressedPublicKey,
    keyData.currentSigner.address,
    keyData.nextSigner.address,
    keyData.nextNextSigner.address,
    ethers.ZeroAddress,
    keyData.nextSigner.address,
    false,
    [],
    { value: balance - 5285124941591474n }
  );
  console.log(`Initial key log entry registered with publicKeyHash: ${keyData.currentSigner.address}, outputAddress: ${keyData.nextSigner.address}`);

  // Deploy Mock Tokens and Price Feed
  const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
  let yadaERC20;
  if (deployments.yadaERC20Address && !clean) {
    yadaERC20 = await MockERC20.attach(deployments.yadaERC20Address);
    console.log("Using existing Yada Cross-chain ($WYDA):", deployments.yadaERC20Address);
  } else {
    yadaERC20 = await MockERC20.connect(deployer).deploy("Wrapped YadaCoin", "WYDA", ethers.parseEther("1000"));
    await yadaERC20.waitForDeployment();
    deployments.yadaERC20Address = await yadaERC20.getAddress();
    console.log("Yada Cross-chain ($WYDA):", deployments.yadaERC20Address);
  }
  const yadaERC20Address = deployments.yadaERC20Address;

  let mockPepe;
  if (deployments.mockPepeAddress && !clean) {
    mockPepe = await MockERC20.attach(deployments.mockPepeAddress);
    console.log("Using existing Mock PEPE:", deployments.mockPepeAddress);
  } else {
    mockPepe = await MockERC20.connect(deployer).deploy("Pepe", "PEPE", ethers.parseEther("1000"));
    await mockPepe.waitForDeployment();
    deployments.mockPepeAddress = await mockPepe.getAddress();
    console.log("Mock PEPE:", deployments.mockPepeAddress);
  }
  const mockPepeAddress = deployments.mockPepeAddress;

  let priceFeed;
  if (deployments.mockPriceFeedAddress && !clean) {
    priceFeed = await PriceFeedAggregatorV3.attach(deployments.mockPriceFeedAddress);
    console.log("Using existing Price Feed (PEPE/USD):", deployments.mockPriceFeedAddress);
  } else {
    priceFeed = await PriceFeedAggregatorV3.deploy(ethers.parseUnits("100000.0", 8));
    await priceFeed.waitForDeployment();
    deployments.mockPriceFeedAddress = await priceFeed.getAddress();
    console.log("Price Feed (PEPE/USD):", deployments.mockPriceFeedAddress);
  }
  const priceFeedAddress = deployments.mockPriceFeedAddress;

  async function generatePermit(tokenAddress, signer, amount, nonce) {
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
    return { v, r, s, deadline };
  }

  // Configure token pairs via Bridge
  if (!deployments.configured || clean) {
    const tokenPairs = [
      [yadaERC20Address, "Wrapped YadaCoin", "WYDA", true, ethers.ZeroAddress, ethers.ZeroAddress],
      [mockPepeAddress, "PEPE", "PEPE", false, ethers.ZeroAddress, priceFeedAddress],
      [NATIVE_ASSET_ADDRESS, "BNB", "BNB", false, ethers.ZeroAddress, bnbPriceFeedAddress] // Use BNB/USD price feed
    ];

    const nonce = await bridge.nonces(nextDeployer.address);
    console.log("Nonce:", nonce.toString());

    const supportedTokens = [yadaERC20Address, mockPepeAddress, NATIVE_ASSET_ADDRESS];
    const permits = await Promise.all(
      supportedTokens.map(async (tokenAddress) => {
        if (tokenAddress.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()) {
          return null;
        }
        try {
          const abi = ERC20_ABI;
          const tokenContract = new ethers.Contract(tokenAddress, abi, deployer);
          const balance = await tokenContract.balanceOf(deployer.address);
          if (balance > 0n) {
            const tokenNonce = await tokenContract.nonces(deployer.address);
            const permit = await generatePermit(tokenAddress, deployer, balance, tokenNonce);
            if (permit) {
              return {
                token: tokenAddress,
                amount: balance,
                deadline: permit.deadline,
                v: permit.v,
                r: permit.r,
                s: permit.s,
                recipient: nextDeployer.address,
              };
            } else {
              console.warn(`Permit not supported for token ${tokenAddress}`);
            }
          }
          return null;
        } catch (error) {
          console.warn(`Error generating permit for token ${tokenAddress}:`, error);
          return null;
        }
      })
    ).then(results => results.filter(permit => permit !== null));

    const unconfirmedMessageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address,string,string,bool,address,address)[]", "address", "uint256"],
        [tokenPairs, keyData.nextSigner.address, nonce]
      )
    );
    const unconfirmedSignature = await nextDeployer.signMessage(ethers.getBytes(unconfirmedMessageHash));

    const confirmingMessageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address,string,string,bool,address,address)[]", "address", "uint256"],
        [tokenPairs, keyData.nextSigner.address, nonce + 1n]
      )
    );
    const confirmingSignature = await nextNextDeployer.signMessage(ethers.getBytes(confirmingMessageHash));

    const unconfirmedKeyData = {
      signature: unconfirmedSignature,
      publicKey: keyData.nextSigner.uncompressedPublicKey,
      publicKeyHash: keyData.nextSigner.address,
      prerotatedKeyHash: keyData.nextNextSigner.address,
      twicePrerotatedKeyHash: confirmingPrerotatedKeyHash,
      prevPublicKeyHash: keyData.currentSigner.address,
      outputAddress: keyData.nextNextSigner.address,
      hasRelationship: false,
      permits: permits,
    };

    const confirmingKeyData = {
      signature: confirmingSignature,
      publicKey: keyData.nextNextSigner.uncompressedPublicKey,
      publicKeyHash: keyData.nextNextSigner.address,
      prerotatedKeyHash: confirmingPrerotatedKeyHash,
      twicePrerotatedKeyHash: confirmingTwicePrerotatedKeyHash,
      prevPublicKeyHash: keyData.nextSigner.address,
      outputAddress: confirmingPrerotatedKeyHash,
      hasRelationship: false,
      permits: [],
    };

    await bridge.connect(nextDeployer).addMultipleTokenPairsAtomic(
      tokenPairs,
      unconfirmedKeyData,
      confirmingKeyData,
      { value: ethers.parseEther("999") }
    );
    console.log("Added all token pairs: $YDA, $PEPE, BNB");

    deployments.wrappedTokenWMOCKAddress = await bridge.originalToWrapped(yadaERC20Address);
    deployments.wrappedTokenYMOCKAddress = await bridge.originalToWrapped(mockPepeAddress);
    deployments.wrappedNativeTokenAddress = await bridge.originalToWrapped(NATIVE_ASSET_ADDRESS);

    deployments.configured = true;
  }

  fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));

  return deployments;
}

main().then((output) => {
  console.log(output);
}).catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});