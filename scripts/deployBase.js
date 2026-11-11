import pkg from "hardhat";
import fs from "fs";
import bs58 from "bs58";
import * as tinysecp256k1 from "tiny-secp256k1";
import {
  createParamsArrayFromObject,
  signatureFields,
} from "../src/utils/signature.js";

const { ethers, upgrades, network } = pkg;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OUT = "./deployments-base.local.json";
const MINT = ethers.parseEther("1000");

const walletFromWif = (wif) => {
  const decoded = bs58.decode(wif);
  const privateKey = decoded.subarray(1, 33);
  const wallet = new ethers.Wallet(ethers.hexlify(privateKey), ethers.provider);
  wallet.uncompressedPublicKey = ethers.hexlify(
    tinysecp256k1
      .pointFromScalar(Buffer.from(wallet.privateKey.slice(2), "hex"), false)
      .slice(1)
  );
  return wallet;
};

const load = () =>
  fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

const save = (deployments) => {
  fs.writeFileSync(OUT, JSON.stringify(deployments, null, 2));
};

async function main() {
  if (network.name !== "base") {
    throw new Error(`Refusing to deploy on ${network.name}`);
  }
  if (!process.env.WIF || !process.env.WIF2 || !process.env.WIF3) {
    throw new Error("WIF, WIF2, and WIF3 are required");
  }

  const deployer = walletFromWif(process.env.WIF);
  const next = walletFromWif(process.env.WIF2);
  const nextNext = walletFromWif(process.env.WIF3);
  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployer.address} has 0 Base ETH. Shortfall is the gas for this deploy.`
    );
  }

  const deployments = load();
  deployments.deployer = deployer.address;
  deployments.chainId = 8453;

  if (!deployments.keyLogRegistryAddress) {
    const KeyLogRegistry = await ethers.getContractFactory(
      "KeyLogRegistry",
      deployer
    );
    const registry = await KeyLogRegistry.deploy(deployer.address);
    await registry.waitForDeployment();
    deployments.keyLogRegistryAddress = await registry.getAddress();
    save(deployments);
  }

  if (!deployments.wrappedTokenImplementation) {
    const WrappedToken = await ethers.getContractFactory(
      "WrappedToken",
      deployer
    );
    const impl = await WrappedToken.deploy();
    await impl.waitForDeployment();
    deployments.wrappedTokenImplementation = await impl.getAddress();
    save(deployments);
  }

  if (!deployments.bridgeAddress) {
    const Bridge = await ethers.getContractFactory("Bridge", deployer);
    const bridge = await Bridge.deploy(
      deployments.keyLogRegistryAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );
    await bridge.waitForDeployment();
    deployments.bridgeAddress = await bridge.getAddress();
    save(deployments);
  }

  if (!deployments.beaconAddress) {
    const Beacon = await ethers.getContractFactory(
      "WrappedTokenBeacon",
      deployer
    );
    const beacon = await Beacon.deploy(
      deployments.wrappedTokenImplementation,
      deployments.bridgeAddress,
      deployer.address
    );
    await beacon.waitForDeployment();
    deployments.beaconAddress = await beacon.getAddress();
    save(deployments);
  }

  if (!deployments.factoryAddress) {
    const Factory = await ethers.getContractFactory(
      "WrappedTokenFactory",
      deployer
    );
    const factory = await Factory.deploy(
      deployments.beaconAddress,
      deployments.bridgeAddress
    );
    await factory.waitForDeployment();
    deployments.factoryAddress = await factory.getAddress();
    save(deployments);
  }

  const bridge = await ethers.getContractAt(
    "Bridge",
    deployments.bridgeAddress,
    deployer
  );
  if ((await bridge.wrappedTokenBeacon()) === ethers.ZeroAddress) {
    await (await bridge.setWrappedTokenBeacon(deployments.beaconAddress)).wait();
  }
  if ((await bridge.wrappedTokenFactory()) === ethers.ZeroAddress) {
    await (
      await bridge.setWrappedTokenFactory(deployments.factoryAddress)
    ).wait();
  }

  const registry = await ethers.getContractAt(
    "KeyLogRegistry",
    deployments.keyLogRegistryAddress,
    deployer
  );
  if ((await registry.authorizedCaller()) !== deployments.bridgeAddress) {
    await (await registry.setAuthorizedCaller(deployments.bridgeAddress)).wait();
  }

  if (!deployments.yadaERC20Address) {
    const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
    const wyda = await upgrades.deployProxy(
      MockERC20,
      ["Wrapped YadaCoin", "WYDA", deployments.bridgeAddress],
      { initializer: "initialize", kind: "uups" }
    );
    await wyda.waitForDeployment();
    deployments.yadaERC20Address = await wyda.getAddress();
    save(deployments);
  }

  if (!deployments.wydaMinted) {
    if ((await bridge.feeSigner()) !== deployer.address) {
      await (await bridge.setFeeSigner(deployer.address)).wait();
    }
    const nativeAmount = 1n;
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const feeHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [ethers.ZeroAddress, 0, expires]
      )
    );
    const feeSignature = await deployer.signMessage(ethers.getBytes(feeHash));
    const nonce = await bridge.nonces(deployer.address);
    const unconfirmed = {
      amount: 0,
      publicKey: deployer.uncompressedPublicKey,
      prerotatedKeyHash: next.address,
      twicePrerotatedKeyHash: nextNext.address,
      prevPublicKeyHash: ethers.ZeroAddress,
      outputAddress: next.address,
    };
    const messageHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(signatureFields, [
        deployments.yadaERC20Address,
        [],
        createParamsArrayFromObject(unconfirmed),
        nonce,
      ])
    );
    const signature = await deployer.signMessage(ethers.getBytes(messageHash));
    const tx = await bridge.registerKeyPairWithTransfer(
      {
        token: deployments.yadaERC20Address,
        fee: {
          token: ethers.ZeroAddress,
          fee: 0,
          expires,
          signature: feeSignature,
        },
        newTokenPairs: [],
        permits: [
          {
            token: ethers.ZeroAddress,
            amount: nativeAmount,
            recipients: [
              {
                recipientAddress: deployer.address,
                amount: nativeAmount,
                wrap: false,
                unwrap: false,
                mint: false,
                burn: false,
              },
            ],
            deadline: 0,
            v: 0,
            r: ethers.ZeroHash,
            s: ethers.ZeroHash,
          },
          {
            token: deployments.yadaERC20Address,
            amount: MINT,
            recipients: [
              {
                recipientAddress: deployer.address,
                amount: MINT,
                wrap: false,
                unwrap: false,
                mint: true,
                burn: false,
              },
            ],
            deadline: 0,
            v: 0,
            r: ethers.ZeroHash,
            s: ethers.ZeroHash,
          },
        ],
        unconfirmed,
        unconfirmedSignature: signature,
        confirming: {
          amount: 0,
          publicKey: "0x",
          prerotatedKeyHash: ethers.ZeroAddress,
          twicePrerotatedKeyHash: ethers.ZeroAddress,
          prevPublicKeyHash: ethers.ZeroAddress,
          outputAddress: ethers.ZeroAddress,
        },
        confirmingSignature: "0x",
      },
      { value: nativeAmount }
    );
    await tx.wait();
    deployments.wydaMinted = MINT.toString();
    save(deployments);
  }

  if (!deployments.poolAddress) {
    const Pool = await ethers.getContractFactory("YadaUsdcPool", deployer);
    const pool = await Pool.deploy(USDC, deployments.yadaERC20Address);
    await pool.waitForDeployment();
    deployments.poolAddress = await pool.getAddress();
    save(deployments);
  }

  const usdc = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"],
    USDC,
    deployer
  );
  const wyda = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"],
    deployments.yadaERC20Address,
    deployer
  );
  const usdcBalance = await usdc.balanceOf(deployer.address);
  const wydaBalance = await wyda.balanceOf(deployer.address);
  if (!deployments.seeded && usdcBalance > 0n && wydaBalance > 0n) {
    const wydaIn = wydaBalance < MINT ? wydaBalance : MINT;
    await (await usdc.approve(deployments.poolAddress, usdcBalance)).wait();
    await (await wyda.approve(deployments.poolAddress, wydaIn)).wait();
    const pool = await ethers.getContractAt(
      "YadaUsdcPool",
      deployments.poolAddress,
      deployer
    );
    await (await pool.addLiquidity(usdcBalance, wydaIn)).wait();
    deployments.seeded = true;
    deployments.reserveUsdc = usdcBalance.toString();
    deployments.reserveWyda = wydaIn.toString();
    save(deployments);
  }
  if (!deployments.reserveUsdc) {
    deployments.reserveUsdc = "0";
    deployments.reserveWyda = "0";
    deployments.seedNote =
      "Deployer has no Base USDC. Customer password-wallet USDC was not used.";
    save(deployments);
  }

  deployments.passwordWalletCalls = [
    `USDC.approve(${deployments.poolAddress}, amount)`,
    `YadaUsdcPool.swapUsdcForWyda(amountIn, minOut)`,
  ];
  save(deployments);
  console.log(JSON.stringify(deployments));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
