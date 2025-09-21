import pkg from "hardhat";
import fs from "fs";
import bs58 from "bs58";
import * as shajs from "sha.js";
import * as tinysecp256k1 from "tiny-secp256k1";
import MockERC20Artifact from "../src/utils/abis/MockERC20.json" assert { type: "json" };
import WrappedTokenArtifact from "../src/utils/abis/WrappedToken.json" assert { type: "json" };
const { ethers, upgrades, network } = pkg;

const ERC20_ABI = MockERC20Artifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;

const NATIVE_ASSET_ADDRESS = "0x0000000000000000000000000000000000000000";

const readWIFKeyFromFile = (filePath) => {
  try {
    const wif = fs.readFileSync(filePath, "utf8").trim();
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
  if (network.name === "bscTestnet" && balance < ethers.parseEther("0.1")) {
    throw new Error(
      "Deployer wallet has insufficient BNB. Fund it using the BSC Testnet Faucet."
    );
  }

  if (network.name === "localhost") {
    // Fund deployer
    const [hardhatAccount] = await ethers.getSigners();
    const tx = await hardhatAccount.sendTransaction({
      to: deployer.address,
      value: ethers.parseEther("1000.0"),
    });
    await tx.wait();
    console.log(`Funded ${deployer.address} with 1000 ETH/BNB`);
  }

  // Deploy KeyLogRegistry
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
      "Using existing KeyLogRegistry:",
      deployments.keyLogRegistryAddress
    );
  } else {
    keyLogRegistry = await KeyLogRegistry.deploy();
    await keyLogRegistry.waitForDeployment();
    deployments.keyLogRegistryAddress = await keyLogRegistry.getAddress();
    console.log("KeyLogRegistry:", deployments.keyLogRegistryAddress);
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
    bridge = await upgrades.deployProxy(Bridge, [keyLogRegistryAddress], {
      initializer: "initialize",
      kind: "uups",
      deployer: deployer,
    });
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
  await bridge
    .connect(deployer)
    .setFeeSigner(
      network.name === "localhost"
        ? "0x903DE6eD93C63Ac5bc51e4dAB50ED2D36e2811BA"
        : "0x37B2b1400292Ee6Ee59a4550704D46311FBDc569"
    );
  console.log("Registering initial key log entry...");
  console.log("Deployer balance:", ethers.formatEther(balance));
  const gasCost = ethers.parseEther("0.1");
  balance = await ethers.provider.getBalance(keyData.currentSigner.address);

  const nonce = await bridge.nonces(deployer.address);
  console.log("Nonce:", nonce.toString());

  const unconfirmedMessageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "uint256"],
      [ethers.ZeroAddress, 0, keyData.nextSigner.address, nonce]
    )
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
      },
    ].filter((r) => r.amount > 0)
  );
  const firstpermits = [permitbnb];
  await bridge.connect(deployer).registerKeyPairWithTransfer(
    ethers.ZeroAddress, //token
    {
      token: ethers.ZeroAddress,
      fee: 0,
      expires: 0,
      signature: "0x",
    }, //fee
    [], //tokenpairs
    {
      amount: 0,
      signature: unconfirmedSignature,
      publicKey: keyData.currentSigner.uncompressedPublicKey,
      prerotatedKeyHash: keyData.nextSigner.address,
      twicePrerotatedKeyHash: keyData.nextNextSigner.address,
      prevPublicKeyHash: ethers.ZeroAddress,
      outputAddress: keyData.nextSigner.address,
      permits: firstpermits,
    },
    {
      amount: 0,
      signature: "0x",
      publicKey: "0x",
      prerotatedKeyHash: ethers.ZeroAddress,
      twicePrerotatedKeyHash: ethers.ZeroAddress,
      prevPublicKeyHash: ethers.ZeroAddress,
      outputAddress: ethers.ZeroAddress,
      permits: [],
    },
    { value: balance - gasCost }
  );
  console.log(
    `Initial key log entry registered with publicKeyHash: ${keyData.currentSigner.address}, outputAddress: ${keyData.nextSigner.address}`
  );

  const MockERC20 = await ethers.getContractFactory("MockERC20", nextDeployer);
  let yadaERC20;
  if (deployments.yadaERC20Address && !clean) {
    yadaERC20 = await MockERC20.attach(deployments.yadaERC20Address);
    console.log(
      "Using existing Yada Cross-chain ($WYDA):",
      deployments.yadaERC20Address
    );
  } else {
    yadaERC20 = await MockERC20.connect(nextDeployer).deploy(
      "Wrapped YadaCoin",
      "WYDA",
      ethers.parseEther("1000"),
      bridgeAddress // Pass bridgeAddress
    );
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
    mockPepe = await MockERC20.connect(nextDeployer).deploy(
      "Pepe",
      "PEPE",
      ethers.parseEther("1000"),
      bridgeAddress // Pass bridgeAddress
    );
    await mockPepe.waitForDeployment();
    deployments.mockPepeAddress = await mockPepe.getAddress();
    console.log("Mock PEPE:", deployments.mockPepeAddress);
  }
  const mockPepeAddress = deployments.mockPepeAddress;

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
      })),
      deadline: deadline,
      v: v,
      r: r,
      s: s,
    };
  }

  // Configure token pairs via Bridge
  if (!deployments.configured || clean) {
    const tokenPairs = [
      [yadaERC20Address, "Wrapped YadaCoin", "WYDA", true, ethers.ZeroAddress],
      [mockPepeAddress, "PEPE", "PEPE", false, ethers.ZeroAddress],
      [NATIVE_ASSET_ADDRESS, "BNB", "BNB", false, ethers.ZeroAddress],
    ];

    const supportedTokens = [
      yadaERC20Address,
      mockPepeAddress,
      NATIVE_ASSET_ADDRESS,
    ];
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
        },
      ].filter((r) => r.amount > 0)
    );
    if (permitbnb) {
      permits.push(permitbnb);
    }

    const nonce = await bridge.nonces(nextDeployer.address);
    console.log("Nonce:", nonce.toString());

    const unconfirmedMessageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [ethers.ZeroAddress, 0, keyData.nextNextSigner.address, nonce]
      )
    );
    const unconfirmedSignature = await nextDeployer.signMessage(
      ethers.getBytes(unconfirmedMessageHash)
    );

    const confirmingMessageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [ethers.ZeroAddress, 0, confirmingPrerotatedKeyHash, nonce + 1n]
      )
    );
    const confirmingSignature = await nextNextDeployer.signMessage(
      ethers.getBytes(confirmingMessageHash)
    );

    const unconfirmedKeyData = {
      amount: 0n,
      signature: unconfirmedSignature,
      publicKey: keyData.nextSigner.uncompressedPublicKey,
      prerotatedKeyHash: keyData.nextNextSigner.address,
      twicePrerotatedKeyHash: confirmingPrerotatedKeyHash,
      prevPublicKeyHash: keyData.currentSigner.address,
      outputAddress: keyData.nextNextSigner.address,
      hasRelationship: false,
      tokenSource: ethers.ZeroAddress,
      permits: permits,
    };

    const confirmingKeyData = {
      amount: 0n,
      signature: confirmingSignature,
      publicKey: keyData.nextNextSigner.uncompressedPublicKey,
      publicKeyHash: keyData.nextNextSigner.address,
      prerotatedKeyHash: confirmingPrerotatedKeyHash,
      twicePrerotatedKeyHash: confirmingTwicePrerotatedKeyHash,
      prevPublicKeyHash: keyData.nextSigner.address,
      outputAddress: confirmingPrerotatedKeyHash,
      hasRelationship: false,
      tokenSource: ethers.ZeroAddress,
      permits: [],
    };

    await bridge.connect(nextDeployer).registerKeyPairWithTransfer(
      ethers.ZeroAddress, //token
      {
        token: ethers.ZeroAddress,
        fee: 0,
        expires: 0,
        signature: "0x",
      }, //fee
      [], //tokenpairs
      unconfirmedKeyData,
      confirmingKeyData,
      { value: balance - gasCost }
    );
    console.log("Added all token pairs: $YDA, $PEPE, BNB");

    // deployments.wrappedTokenWMOCKAddress = await bridge.originalToWrapped(
    //   yadaERC20Address
    // );
    // deployments.wrappedTokenYMOCKAddress = await bridge.originalToWrapped(
    //   mockPepeAddress
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
