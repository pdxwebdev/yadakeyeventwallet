/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

// src/pages/AdminPanel.jsx
import { useState, useEffect } from "react";
import { Button, TextInput, Checkbox, Group } from "@mantine/core";
import { ethers } from "ethers";
import BridgeArtifact from "../utils/abis/Bridge.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import TokenPairWrapperArtifact from "../utils/abis/TokenPairWrapper.json";
import { createHDWallet, deriveSecurePath } from "../utils/hdWallet";
import { deriveNextKey, getKeyState } from "../shared/keystate";
import { localProvider } from "../shared/constants";

const BRIDGE_ABI = BridgeArtifact.abi;
const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;
const ERC20_ABI = MockERC20Artifact.abi;
const TOKEN_PAIR_WRAPPER_ABI = TokenPairWrapperArtifact.abi;

function AdminPanel() {
  const [originalToken, setOriginalToken] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [isCrossChain, setIsCrossChain] = useState(false);
  const [mintBurnAddress, setMintBurnAddress] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [burnAmount, setBurnAmount] = useState("");
  const [status, setStatus] = useState("");
  const [log, setLog] = useState([]);
  const [kdp] = useState("defaultPassword");
  const [feeCollector, setFeeCollector] = useState("");

  const wallet =
    ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider);

  useEffect(() => {
    const init = async () => {
      try {
        const hdWallet = createHDWallet(HARDHAT_MNEMONIC);
        const bridge = new ethers.Contract(
          contractAddresses.bridgeAddress,
          BRIDGE_ABI,
          wallet
        );
        const keyLogRegistry = new ethers.Contract(
          contractAddresses.keyLogRegistryAddress,
          KEYLOG_REGISTRY_ABI,
          wallet
        );
        const initialKey = await deriveSecurePath(hdWallet, kdp);

        const log = await keyLogRegistry.buildFromPublicKey(
          initialKey.uncompressedPublicKey.slice(1)
        );
        setLog(() => log);
        const keyState = await getKeyState(hdWallet, log, kdp);

        if (log.length === 0) {
          let walletNonce = await localProvider.getTransactionCount(
            wallet.address,
            "latest"
          );

          const mockERC20 = new ethers.Contract(
            contractAddresses.yadaERC20Address,
            ERC20_ABI,
            wallet
          );
          const mock2ERC20 = new ethers.Contract(
            contractAddresses.mockPepeAddress,
            ERC20_ABI,
            wallet
          );
          const largeApprovalAmount = ethers.parseEther("1000000");

          const mockApprovalTx = await mockERC20.approve(
            contractAddresses.bridgeAddress,
            largeApprovalAmount,
            { nonce: walletNonce }
          );
          await mockApprovalTx.wait();
          walletNonce++;

          const mock2ApprovalTx = await mock2ERC20.approve(
            contractAddresses.bridgeAddress,
            largeApprovalAmount,
            { nonce: walletNonce }
          );
          await mock2ApprovalTx.wait();
          walletNonce++;

          const ethForCurrent = ethers.parseEther("4");
          const ethTxCurrent = await wallet.sendTransaction({
            to: keyState.nextDerivedKey.signer.address,
            value: ethForCurrent,
            nonce: walletNonce,
          });
          await ethTxCurrent.wait();
          walletNonce++;

          const currentOwner = await bridge.owner();
          const currentRelayer = await bridge.relayer();
          console.log("Current Bridge owner:", currentOwner);
          console.log("Current Relayer:", currentRelayer);
          console.log("Wallet address:", wallet.address);

          // Ensure Bridge is authorized in KeyLogRegistry
          const currentAuthorizedCaller =
            await keyLogRegistry.authorizedCaller();
          if (
            currentAuthorizedCaller.toLowerCase() !==
            contractAddresses.bridgeAddress.toLowerCase()
          ) {
            console.log("Authorizing Bridge contract as caller...");
            const authTx = await keyLogRegistry.setAuthorizedCaller(
              contractAddresses.bridgeAddress,
              { nonce: walletNonce }
            );
            await authTx.wait();
            walletNonce++;
          }

          if (
            currentOwner.toLowerCase() === wallet.address.toLowerCase() &&
            currentRelayer.toLowerCase() !== wallet.address.toLowerCase()
          ) {
            console.log("Setting wallet as relayer...");
            const relayerTx = await bridge.setRelayer(wallet.address, {
              nonce: walletNonce,
            });
            await relayerTx.wait();
            walletNonce++;
          } else {
            console.log("Skipping setRelayer: not owner or already set.");
          }

          const authTx = await keyLogRegistry.setAuthorizedCaller(
            contractAddresses.bridgeAddress,
            { nonce: walletNonce }
          );
          await authTx.wait();
          walletNonce++;

          const inceptionTx = await keyLogRegistry.registerKeyLog(
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
            keyState.currentDerivedKey.signer.address,
            keyState.nextDerivedKey.signer.address,
            keyState.nextNextDerivedKey.signer.address,
            "0x0000000000000000000000000000000000000000", // First key, no prev
            keyState.nextDerivedKey.signer.address,
            false,
            { nonce: walletNonce }
          );
          await inceptionTx.wait();

          const updatedLog = await keyLogRegistry.buildFromPublicKey(
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
          );
          setLog(() => updatedLog);
          setStatus("Initialization complete with 3 key rotations");
        } else {
          const collector = await bridge.feeCollector();
          setFeeCollector(collector);
          setStatus("Loaded existing key state");
        }
      } catch (error) {
        setStatus("Error during initialization: " + error.message);
        console.error("Init error:", error);
      }
    };
    init();
  }, []);

  const deployWrappedToken = async () => {
    try {
      const factory = new ethers.ContractFactory(
        WrappedTokenArtifact.abi,
        WrappedTokenArtifact.bytecode,
        wallet
      );

      const wrappedTokenContract = await factory.deploy(
        tokenName || `${tokenSymbol} Wrapped Token`,
        tokenSymbol,
        contractAddresses.bridgeAddress
      );

      await wrappedTokenContract.waitForDeployment();
      return wrappedTokenContract.target;
    } catch (error) {
      throw new Error(`Failed to deploy wrapped token: ${error.message}`);
    }
  };

  const ensureOwnership = async (bridge, currentOwner, newOwner) => {
    const owner = await bridge.owner();
    console.log("Current Bridge owner:", owner);
    console.log("Target new owner:", newOwner);

    if (owner.toLowerCase() !== newOwner.toLowerCase()) {
      console.log(`Transferring ownership from ${owner} to ${newOwner}`);
      const tx = await bridge.transferOwnership(newOwner);
      await tx.wait();
      console.log("Ownership transferred. New owner:", await bridge.owner());
    } else {
      console.log("Target is already the owner, no transfer needed.");
    }
  };

  const ensureAuthorizedCaller = async (keyLogRegistry, caller) => {
    console.log("Ensuring authorized caller:", caller);
    const tx = await keyLogRegistry.setAuthorizedCaller(caller);
    await tx.wait();
    console.log(`Authorized caller ${caller} set in KeyLogRegistry`);
  };

  const MANAGER_ABI = [
    "function addTokenPairAtomic(address originalToken, string tokenName, string tokenSymbol, bool isCrossChain, bytes currentPubKey, address currentSigner, address nextSigner, address nextNextSigner, address prevSigner, bytes nextPubKey, address nextNextNextSigner) external payable",
  ];

  const addTokenPair = async () => {
    try {
      if (!tokenSymbol) {
        setStatus("Please enter a token symbol");
        return;
      }

      const hdWallet = createHDWallet(HARDHAT_MNEMONIC);
      const keyState = await getKeyState(hdWallet, log, kdp);
      const wrapper = new ethers.Contract(
        deployments.tokenPairWrapper,
        WRAPPER_ABI,
        wallet
      );

      setStatus("Preparing atomic token pair addition...");
      const ethToSend = ethers.parseEther("8");
      const nonce = await localProvider.getTransactionCount(
        wallet.address,
        "pending"
      );

      const tx = await wrapper.addTokenPairAtomic(
        originalToken,
        tokenName,
        tokenSymbol,
        isCrossChain,
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
        keyState.currentDerivedKey.signer.address,
        keyState.nextDerivedKey.signer.address,
        keyState.nextNextDerivedKey.signer.address,
        keyState.prevDerivedKey.signer.address,
        keyState.nextDerivedKey.key.uncompressedPublicKey.slice(1),
        keyState.nextNextNextDerivedKey.signer.address,
        { nonce, value: ethToSend }
      );
      await tx.wait();

      setStatus(
        "Token pair added successfully with key rotation and ETH funding"
      );
    } catch (error) {
      setStatus(`Error: ${error.message}`);
      console.error("Atomic add token pair error:", error);
    }
  };

  const mintWYDA = async () => {
    try {
      if (!mintBurnAddress || !mintAmount) {
        setStatus("Please enter both address and amount for minting");
        return;
      }

      const hdWallet = createHDWallet(HARDHAT_MNEMONIC);
      const keyState = await getKeyState(hdWallet, log, kdp);
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        keyState.currentDerivedKey.signer
      );
      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        keyState.currentDerivedKey.signer
      );
      const keyLogRegistryWithWallet = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        wallet
      );

      const amount = ethers.parseEther(mintAmount);
      const tx = await bridge.mintWrappedToken(
        contractAddresses.wrappedTokenWMOCKAddress,
        mintBurnAddress,
        amount
      );
      await tx.wait();

      // Authorize the current signer for KeyLogRegistry
      setStatus("Authorizing current signer in KeyLogRegistry...");
      await ensureAuthorizedCaller(
        keyLogRegistryWithWallet,
        keyState.currentDerivedKey.signer.address
      );

      // Debug key state and log before rotation
      console.log("Key state before rotation:", {
        prev: keyState.prevDerivedKey
          ? keyState.prevDerivedKey.signer.address
          : "0x0",
        current: keyState.currentDerivedKey.signer.address,
        next: keyState.nextDerivedKey.signer.address,
        nextNext: keyState.nextNextDerivedKey.signer.address,
        nextNextNext: keyState.nextNextNextDerivedKey.signer.address,
      });
      console.log("Current log length:", log.length);
      console.log("Last log entry:", log[log.length - 1]);

      // Sync log with contract state
      const currentLog = await keyLogRegistryWithWallet.buildFromPublicKey(
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
      );
      setLog(() => currentLog);

      // Register current key if not already in log
      let nonce = await localProvider.getTransactionCount(
        keyState.currentDerivedKey.signer.address,
        "latest"
      );
      setStatus("Registering key...");
      const inceptionTx = await keyLogRegistry.registerKeyLog(
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
        keyState.currentDerivedKey.signer.address,
        keyState.nextDerivedKey.signer.address,
        keyState.nextNextDerivedKey.signer.address,
        keyState.prevDerivedKey.signer.address,
        keyState.nextDerivedKey.signer.address,
        false,
        { nonce }
      );
      await inceptionTx.wait();
      nonce++;

      // Rotate to next key
      setStatus("Rotating key...");
      keyState.nextNextNextDerivedKey = await deriveNextKey(
        keyState.nextNextDerivedKey.key,
        kdp
      );
      const rotateTx = await keyLogRegistry.registerKeyLog(
        keyState.nextDerivedKey.key.uncompressedPublicKey.slice(1),
        keyState.nextDerivedKey.signer.address,
        keyState.nextNextDerivedKey.signer.address,
        keyState.nextNextNextDerivedKey.signer.address,
        keyState.currentDerivedKey.signer.address, // Now registered
        keyState.nextNextDerivedKey.signer.address,
        false,
        { nonce }
      );
      await rotateTx.wait();

      // Authorize the new signer in KeyLogRegistry
      setStatus("Authorizing new signer in KeyLogRegistry...");
      await ensureAuthorizedCaller(
        keyLogRegistryWithWallet,
        keyState.nextDerivedKey.signer.address
      );

      // Fund the new key with ETH
      const ethToSend = ethers.parseEther("4");
      const ethTx = await wallet.sendTransaction({
        to: keyState.nextDerivedKey.signer.address,
        value: ethToSend,
        nonce: await localProvider.getTransactionCount(
          wallet.address,
          "latest"
        ),
      });
      await ethTx.wait();

      setStatus("Fetching updated key log...");
      const updatedLog = await keyLogRegistryWithWallet.buildFromPublicKey(
        keyState.nextDerivedKey.key.uncompressedPublicKey.slice(1)
      );
      setLog(() => updatedLog);

      setStatus(
        `Successfully minted ${mintAmount} WYDA to ${mintBurnAddress} with key rotation and ETH funding`
      );
      setMintAmount("");
      setMintBurnAddress("");
    } catch (error) {
      setStatus(`Mint error: ${error.message}`);
      console.error("Mint error:", error);
    }
  };

  const burnWYDA = async () => {
    try {
      if (!mintBurnAddress || !burnAmount) {
        setStatus("Please enter both address and amount for burning");
        return;
      }

      const wrappedToken = new ethers.Contract(
        contractAddresses.wrappedTokenWMOCKAddress,
        WRAPPED_TOKEN_ABI,
        wallet
      );

      const amount = ethers.parseEther(burnAmount);
      const tx = await wrappedToken.burn(mintBurnAddress, amount);
      await tx.wait();

      setStatus(
        `Successfully burned ${burnAmount} WYDA from ${mintBurnAddress}`
      );
      setBurnAmount("");
      setMintBurnAddress("");
    } catch (error) {
      setStatus(`Burn error: ${error.message}`);
      console.error("Burn error:", error);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Admin Panel</h1>

      <h2>Create Token Pair</h2>
      <Group direction="column" spacing="md">
        <TextInput
          label="Original Token Address"
          value={originalToken}
          onChange={(e) => setOriginalToken(e.target.value)}
          placeholder="0x..."
          required
        />
        <TextInput
          label="Wrapped Token Symbol"
          value={tokenSymbol}
          onChange={(e) => setTokenSymbol(e.target.value)}
          placeholder="e.g., WMOCK"
          required
        />
        <TextInput
          label="Wrapped Token Name (optional)"
          value={tokenName}
          onChange={(e) => setTokenName(e.target.value)}
          placeholder="e.g., Wrapped Mock Token"
        />
        <Checkbox
          label="Is Cross-Chain"
          checked={isCrossChain}
          onChange={(e) => setIsCrossChain(e.target.checked)}
        />
        <Button onClick={addTokenPair} disabled={log.length === 0}>
          Create and Add Token Pair
        </Button>
      </Group>

      <h2>Mint/Burn WYDA</h2>
      <Group direction="column" spacing="md">
        <TextInput
          label="User Address"
          value={mintBurnAddress}
          onChange={(e) => setMintBurnAddress(e.target.value)}
          placeholder="0x..."
          required
        />
        <TextInput
          label="Mint Amount (in WYDA)"
          value={mintAmount}
          onChange={(e) => setMintAmount(e.target.value)}
          placeholder="e.g., 100"
          type="number"
        />
        <Button onClick={mintWYDA} disabled={log.length === 0}>
          Mint WYDA
        </Button>
        <TextInput
          label="Burn Amount (in WYDA)"
          value={burnAmount}
          onChange={(e) => setBurnAmount(e.target.value)}
          placeholder="e.g., 100"
          type="number"
        />
        <Button onClick={burnWYDA} disabled={log.length === 0}>
          Burn WYDA
        </Button>
      </Group>

      {status && <p>{status}</p>}
      {feeCollector && <p>Fee Collector: {feeCollector}</p>}
    </div>
  );
}

export default AdminPanel;
