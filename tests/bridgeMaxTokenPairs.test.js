import pkg from "hardhat";
const { ethers, upgrades, network } = pkg;
import { expect } from "chai";

const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";
const MAX_TOKEN_PAIRS = 10;

const buildPublicKeyBytes = (wallet) => {
  const uncompressed = wallet.signingKey.publicKey;
  const raw = Buffer.from(uncompressed.slice(2), "hex").slice(1);
  return ethers.hexlify(raw);
};

describe("Bridge MAX_TOKEN_PAIRS", () => {
  let bridge;
  let keyLogRegistry;
  let owner;
  let ownerWallet;

  beforeEach(async () => {
    [owner] = await ethers.getSigners();
    ownerWallet = ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(
      ethers.provider
    );

    const KeyLogRegistry = await ethers.getContractFactory(
      "KeyLogRegistry",
      owner
    );
    keyLogRegistry = await upgrades.deployProxy(
      KeyLogRegistry,
      [owner.address],
      {
        initializer: "initialize",
        kind: "uups",
      }
    );
    await keyLogRegistry.waitForDeployment();

    const Bridge = await ethers.getContractFactory("Bridge", owner);
    bridge = await upgrades.deployProxy(
      Bridge,
      [await keyLogRegistry.getAddress(), ethers.ZeroAddress],
      {
        initializer: "initialize",
        kind: "uups",
      }
    );
    await bridge.waitForDeployment();

    await keyLogRegistry.setAuthorizedCaller(await bridge.getAddress());

    const WrappedToken = await ethers.getContractFactory("WrappedToken", owner);
    const wrappedTokenImpl = await WrappedToken.deploy();
    await wrappedTokenImpl.waitForDeployment();

    const WrappedTokenBeacon = await ethers.getContractFactory(
      "WrappedTokenBeacon",
      owner
    );
    const beacon = await WrappedTokenBeacon.deploy(
      await wrappedTokenImpl.getAddress(),
      await bridge.getAddress()
    );
    await beacon.waitForDeployment();

    await bridge.setWrappedTokenBeacon(await beacon.getAddress());
  });

  it("reverts when registering more than MAX_TOKEN_PAIRS", async () => {
    expect(ownerWallet.address).to.equal(owner.address);

    const tokenPairs = Array.from({ length: MAX_TOKEN_PAIRS + 1 }, (_, i) => {
      const randomAddress = ethers.Wallet.createRandom().address;
      return {
        originalToken: randomAddress,
        tokenName: `Token ${i}`,
        tokenSymbol: `T${i}`,
        wrappedToken: ethers.ZeroAddress,
      };
    });

    const unconfirmed = {
      amount: 0n,
      publicKey: buildPublicKeyBytes(ownerWallet),
      prerotatedKeyHash: owner.address,
      twicePrerotatedKeyHash: ethers.ZeroAddress,
      prevPublicKeyHash: ethers.ZeroAddress,
      outputAddress: owner.address,
    };

    const nonce = await bridge.nonces(owner.address);
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const unconfirmedHash = ethers.keccak256(
      abiCoder.encode(
        [
          "address",
          "tuple(address,string,string,address)[]",
          "tuple(uint256,bytes,address,address,address,address)",
          "uint256",
        ],
        [
          ethers.ZeroAddress,
          tokenPairs.map((pair) => [
            pair.originalToken,
            pair.tokenName,
            pair.tokenSymbol,
            pair.wrappedToken,
          ]),
          [
            unconfirmed.amount,
            unconfirmed.publicKey,
            unconfirmed.prerotatedKeyHash,
            unconfirmed.twicePrerotatedKeyHash,
            unconfirmed.prevPublicKeyHash,
            unconfirmed.outputAddress,
          ],
          nonce,
        ]
      )
    );

    const unconfirmedSignature = await ownerWallet.signMessage(
      ethers.getBytes(unconfirmedHash)
    );

    const ctx = {
      token: ethers.ZeroAddress,
      fee: {
        token: ethers.ZeroAddress,
        fee: 0,
        expires: 0,
        signature: "0x",
      },
      newTokenPairs: tokenPairs,
      permits: [],
      unconfirmed,
      unconfirmedSignature,
      confirming: {
        amount: 0,
        publicKey: "0x",
        prerotatedKeyHash: ethers.ZeroAddress,
        twicePrerotatedKeyHash: ethers.ZeroAddress,
        prevPublicKeyHash: ethers.ZeroAddress,
        outputAddress: ethers.ZeroAddress,
      },
      confirmingSignature: "0x",
    };

    let error;
    try {
      await bridge.connect(ownerWallet).registerKeyPairWithTransfer(ctx);
    } catch (err) {
      error = err;
    }

    expect(error).to.not.equal(undefined);
    expect(error.message).to.include("max token pairs reached");

    const supported = await bridge.getSupportedTokens();
    expect(supported.length).to.equal(0);
  });
});
