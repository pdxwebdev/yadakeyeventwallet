import pkg from "hardhat";
const { ethers, upgrades, network } = pkg;
import { expect } from "chai";

describe("Bridge DApp", () => {
  let provider;
  let deployer;
  let other;
  let bridge;
  let keyLogRegistry;

  const expectRevert = async (promise) => {
    let error;
    try {
      await promise;
    } catch (err) {
      error = err;
    }
    expect(error).to.not.equal(undefined);
  };

  beforeEach(async () => {
    provider = ethers.provider;
    [deployer, other] = await ethers.getSigners();

    const KeyLogRegistry = await ethers.getContractFactory(
      "KeyLogRegistry",
      deployer
    );
    keyLogRegistry = await upgrades.deployProxy(
      KeyLogRegistry,
      [deployer.address],
      {
        initializer: "initialize",
        kind: "uups",
      }
    );
    await keyLogRegistry.waitForDeployment();

    const Bridge = await ethers.getContractFactory("Bridge", deployer);
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
  });

  describe("Initialization", () => {
    it("should connect to Hardhat network and set up contracts", async () => {
      const net = await provider.getNetwork();
      expect(net.chainId).to.equal(31337n);
      expect(await bridge.feeCollector()).to.equal(deployer.address);
      expect(await bridge.getOwner()).to.equal(deployer.address);
      expect(await bridge.keyLogRegistry()).to.equal(
        await keyLogRegistry.getAddress()
      );
      expect((await bridge.getSupportedTokens()).length).to.equal(0);
    });
  });

  describe("Admin setters", () => {
    it("updates fee signer and fee collector", async () => {
      const newSigner = ethers.Wallet.createRandom().address;
      const newCollector = ethers.Wallet.createRandom().address;

      await bridge.setFeeSigner(newSigner);
      await bridge.setFeeCollector(newCollector);

      expect(await bridge.feeSigner()).to.equal(newSigner);
      expect(await bridge.feeCollector()).to.equal(newCollector);
    });

    it("reverts when non-owner calls setters", async () => {
      const newSigner = ethers.Wallet.createRandom().address;
      const newCollector = ethers.Wallet.createRandom().address;
      const newBeacon = ethers.Wallet.createRandom().address;

      await expectRevert(bridge.connect(other).setFeeSigner(newSigner));
      await expectRevert(bridge.connect(other).setFeeCollector(newCollector));
      await expectRevert(
        bridge.connect(other).setWrappedTokenBeacon(newBeacon)
      );
    });

    it("reverts on zero address parameters", async () => {
      await expectRevert(bridge.setFeeSigner(ethers.ZeroAddress));
      await expectRevert(bridge.setFeeCollector(ethers.ZeroAddress));
      await expectRevert(bridge.setWrappedTokenBeacon(ethers.ZeroAddress));
    });
  });
});
