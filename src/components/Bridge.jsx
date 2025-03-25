import React, { useState, useEffect } from "react";
import { ethers } from "ethers"; // v6
import "../App.css";
import BridgeArtifact from "../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import { createHDWallet, deriveSecurePath } from "../utils/hdWallet";

const BRIDGE_ABI = BridgeArtifact.abi;
const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;
const ERC20_ABI = MockERC20Artifact.abi;

const BRIDGE_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const KEYLOG_REGISTRY_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const WRAPPED_TOKEN_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
const MOCK_ERC20_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";

const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

function Bridge() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState("");
  const [status, setStatus] = useState("");
  const [feeCollector, setFeeCollector] = useState("");
  const [kdp, setKdp] = useState("defaultPassword");
  const [rootWallet, setRootWallet] = useState(null);
  const [currentKey, setCurrentKey] = useState(null);
  const [nextKey, setNextKey] = useState(null);
  const [lastPublicKeyHash, setLastPublicKeyHash] = useState(
    "0x0000000000000000000000000000000000000000"
  );

  const deriveNextKey = async (baseKey, localProvider, localRootWallet) => {
    if (!localRootWallet || !localProvider) {
      console.error("Root wallet or provider not available");
      return null;
    }
    const derivedKey = await deriveSecurePath(baseKey || localRootWallet, kdp);
    const signer = new ethers.Wallet(
      ethers.hexlify(derivedKey.privateKey),
      localProvider
    );
    return { key: derivedKey, signer };
  };

  useEffect(() => {
    const init = async () => {
      try {
        const localProvider = new ethers.JsonRpcProvider(
          "http://127.0.0.1:8545/",
          { chainId: 31337, name: "hardhat" }
        );
        const wallet =
          ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider);

        const hdWallet = createHDWallet(HARDHAT_MNEMONIC);
        const initialKey = await deriveSecurePath(hdWallet, "defaultPassword");
        const initialSigner = new ethers.Wallet(
          ethers.hexlify(initialKey.privateKey),
          localProvider
        );

        const walletNonce = await localProvider.getTransactionCount(
          wallet.address,
          "latest"
        );
        const ethAmount = ethers.parseEther("10");
        const ethTx = await wallet.sendTransaction({
          to: initialSigner.address,
          value: ethAmount,
          nonce: walletNonce,
        });
        await ethTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(ethAmount)} ETH to ${
            initialSigner.address
          }`
        );

        const mockERC20 = new ethers.Contract(
          MOCK_ERC20_ADDRESS,
          ERC20_ABI,
          wallet
        );
        const mockAmount = ethers.parseEther("100");
        const mockTx = await mockERC20.transfer(
          initialSigner.address,
          mockAmount
        );
        await mockTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(mockAmount)} $MOCK to ${
            initialSigner.address
          }`
        );

        const bridge = new ethers.Contract(
          BRIDGE_ADDRESS,
          BRIDGE_ABI,
          initialSigner
        );
        const collector = await bridge.feeCollector();

        setProvider(localProvider);
        setSigner(initialSigner);
        setAccount(initialSigner.address);
        setFeeCollector(collector);
        setRootWallet(hdWallet);
        setStatus("Connected to Hardhat: " + initialSigner.address);

        await registerInitialKeyLogPair(
          initialKey,
          initialSigner,
          localProvider,
          hdWallet
        );
      } catch (error) {
        setStatus("Error connecting to Hardhat: " + error.message);
        console.error("Init error:", error);
      }
    };
    init();
  }, []);

  const registerInitialKeyLogPair = async (
    initialKey,
    initialSigner,
    localProvider,
    localRootWallet
  ) => {
    const bridge = new ethers.Contract(
      BRIDGE_ADDRESS,
      BRIDGE_ABI,
      initialSigner
    );
    const keyLogRegistry = new ethers.Contract(
      KEYLOG_REGISTRY_ADDRESS,
      KEYLOG_REGISTRY_ABI,
      initialSigner
    );
    const mockERC20 = new ethers.Contract(
      MOCK_ERC20_ADDRESS,
      ERC20_ABI,
      initialSigner
    );
    try {
      const signerNonce = await localProvider.getTransactionCount(
        initialSigner.address,
        "latest"
      );
      const bridgeNonce = await bridge.nonces(initialSigner.address);

      let unconfirmedPrevPublicKeyHash =
        "0x0000000000000000000000000000000000000000";
      const currentIndex = await keyLogRegistry.getCurrentIndex(
        initialSigner.address
      );
      if (currentIndex > 0) {
        const lastEntry = await keyLogRegistry.keyLogs(
          initialSigner.address,
          currentIndex - 1n
        );
        if (lastEntry.isOnChain) {
          unconfirmedPrevPublicKeyHash = lastEntry.publicKeyHash;
        }
      }

      const publicKey = ethers.hexlify(initialKey.publicKey);
      const { key: nextKey, signer: nextSigner } = await deriveNextKey(
        initialKey,
        localProvider,
        localRootWallet
      );
      const { key: nextNextKey, signer: nextNextSigner } = await deriveNextKey(
        nextKey,
        localProvider,
        localRootWallet
      );
      const { key: nextNextNextKey, signer: nextNextNextSigner } =
        await deriveNextKey(nextNextKey, localProvider, localRootWallet);

      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [MOCK_ERC20_ADDRESS, 0, initialSigner.address, bridgeNonce.toString()]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature = await initialSigner.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const confirmingMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          MOCK_ERC20_ADDRESS,
          ethers.parseEther("0"),
          "0x" +
            ethers.keccak256(ethers.hexlify(nextNextKey.publicKey)).slice(-40),
          (bridgeNonce + 1n).toString(),
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await initialSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      const confirmingPublicKey = ethers.hexlify(nextKey.publicKey);
      const unconfirmedPublicKeyHash =
        "0x" + ethers.keccak256(publicKey).slice(-40);
      const confirmingPrevPublicKeyHash = unconfirmedPublicKeyHash;

      const tx = await bridge.wrapPair(
        MOCK_ERC20_ADDRESS,
        ethers.parseEther("0"),
        unconfirmedSignature,
        publicKey,
        "0x" + ethers.keccak256(ethers.hexlify(nextKey.publicKey)).slice(-40),
        "0x" +
          ethers.keccak256(ethers.hexlify(nextNextKey.publicKey)).slice(-40),
        unconfirmedPrevPublicKeyHash,
        initialSigner.address,
        true,
        ethers.parseEther("0"),
        confirmingSignature,
        confirmingPublicKey,
        "0x" +
          ethers.keccak256(ethers.hexlify(nextNextKey.publicKey)).slice(-40),
        "0x" +
          ethers
            .keccak256(ethers.hexlify(nextNextNextKey.publicKey))
            .slice(-40),
        confirmingPrevPublicKeyHash,
        "0x" +
          ethers.keccak256(ethers.hexlify(nextNextKey.publicKey)).slice(-40),
        false,
        { nonce: signerNonce }
      );
      await localProvider.send("evm_mine", []);
      await tx.wait();

      const nextAddress = nextSigner.address;
      const mockBalance = await mockERC20.balanceOf(initialSigner.address);
      if (mockBalance > 0) {
        const mockTransferTx = await mockERC20.transfer(
          nextAddress,
          mockBalance
        );
        await mockTransferTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(
            mockBalance
          )} $MOCK to ${nextAddress}`
        );
      }

      const ethBalance = await localProvider.getBalance(initialSigner.address);
      if (ethBalance > ethers.parseEther("0.1")) {
        const ethToTransfer = ethBalance - ethers.parseEther("0.1");
        const ethTransferTx = await initialSigner.sendTransaction({
          to: nextAddress,
          value: ethToTransfer,
        });
        await ethTransferTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(
            ethToTransfer
          )} ETH to ${nextAddress}`
        );
      }

      setCurrentKey(nextKey);
      setNextKey(nextNextKey);
      setLastPublicKeyHash(
        "0x" + ethers.keccak256(confirmingPublicKey).slice(-40)
      );
      setSigner(nextSigner);
      setAccount(nextAddress);
      setStatus("Initial key log pair registered");
    } catch (error) {
      console.error("Wrap pair failed:", error);
      setStatus("Wrap pair failed: " + error.message);
    }
  };

  const wrapLocal = async () => {
    if (!provider || !signer || !rootWallet) {
      setStatus("Provider, signer, or root wallet not initialized");
      return;
    }

    try {
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const mockERC20 = new ethers.Contract(
        MOCK_ERC20_ADDRESS,
        ERC20_ABI,
        signer
      );

      const amountToWrap = ethers.parseEther("10");

      const mockBalance = await mockERC20.balanceOf(account);
      console.log("Account $MOCK Balance:", ethers.formatEther(mockBalance));
      if (mockBalance < amountToWrap) {
        setStatus("Insufficient $MOCK balance");
        return;
      }

      const ethBalance = await provider.getBalance(account);
      console.log("Account ETH Balance:", ethers.formatEther(ethBalance));
      if (ethBalance < ethers.parseEther("0.1")) {
        setStatus("Insufficient ETH balance for gas");
        return;
      }

      const approveTx = await mockERC20.approve(BRIDGE_ADDRESS, amountToWrap);
      console.log("Approval Tx Hash:", approveTx.hash);
      await approveTx.wait();
      const allowance = await mockERC20.allowance(account, BRIDGE_ADDRESS);
      console.log("Allowance after approval:", ethers.formatEther(allowance));

      const currentIndex = await keyLogRegistry.getCurrentIndex(account);
      console.log("Current Index:", currentIndex.toString());

      let prevEntry;
      let prevPublicKeyHash = "0x0000000000000000000000000000000000000000";
      if (currentIndex > 0) {
        prevEntry = await keyLogRegistry.keyLogs(account, currentIndex - 1n);
        if (!prevEntry.isOnChain) {
          setStatus("Previous key log entry is not on-chain");
          return;
        }
        prevPublicKeyHash = prevEntry.publicKeyHash;
        console.log("Previous Entry:", {
          publicKeyHash: prevEntry.publicKeyHash,
          prerotatedKeyHash: prevEntry.prerotatedKeyHash,
          twicePrerotatedKeyHash: prevEntry.twicePrerotatedKeyHash,
        });
      }

      let derivedKey = await deriveSecurePath(rootWallet, kdp);
      let currentDerivedKey,
        nextDerivedKey,
        nextNextDerivedKey,
        nextNextNextDerivedKey;

      for (let i = 0; i < currentIndex; i++) {
        derivedKey = (await deriveNextKey(derivedKey, provider, rootWallet))
          .key;
      }
      currentDerivedKey = derivedKey;
      nextDerivedKey = (
        await deriveNextKey(currentDerivedKey, provider, rootWallet)
      ).key;
      nextNextDerivedKey = (
        await deriveNextKey(nextDerivedKey, provider, rootWallet)
      ).key;
      nextNextNextDerivedKey = (
        await deriveNextKey(nextNextDerivedKey, provider, rootWallet)
      ).key;

      const currentPublicKeyHash =
        "0x" +
        ethers
          .keccak256(ethers.hexlify(currentDerivedKey.publicKey))
          .slice(-40);
      const nextPublicKeyHash =
        "0x" +
        ethers.keccak256(ethers.hexlify(nextDerivedKey.publicKey)).slice(-40);
      const nextNextPublicKeyHash =
        "0x" +
        ethers
          .keccak256(ethers.hexlify(nextNextDerivedKey.publicKey))
          .slice(-40);
      const nextNextNextPublicKeyHash =
        "0x" +
        ethers
          .keccak256(ethers.hexlify(nextNextNextDerivedKey.publicKey))
          .slice(-40);

      console.log("Derived Keys:", {
        currentPublicKeyHash,
        nextPublicKeyHash,
        nextNextPublicKeyHash,
        nextNextNextPublicKeyHash,
      });

      if (currentIndex > 0) {
        const currentPublicKeyHashLower = currentPublicKeyHash.toLowerCase();
        const prevPrerotatedKeyHashLower =
          prevEntry.prerotatedKeyHash.toLowerCase();
        if (currentPublicKeyHashLower !== prevPrerotatedKeyHashLower) {
          console.error(
            "Mismatch: currentPublicKeyHash",
            currentPublicKeyHash,
            "does not match prevEntry.prerotatedKeyHash",
            prevEntry.prerotatedKeyHash
          );
          setStatus("Key derivation mismatch with on-chain state");
          return;
        }
      }

      const nonce = await bridge.nonces(signer.address);
      console.log("Bridge Nonce:", nonce.toString());

      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [MOCK_ERC20_ADDRESS, amountToWrap, account, nonce.toString()]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const confirmingMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [MOCK_ERC20_ADDRESS, 0, nextNextPublicKeyHash, (nonce + 1n).toString()]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await signer.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      const tx = await bridge.wrapPair(
        MOCK_ERC20_ADDRESS,
        amountToWrap,
        unconfirmedSignature,
        ethers.hexlify(currentDerivedKey.publicKey),
        nextPublicKeyHash,
        nextNextPublicKeyHash,
        prevPublicKeyHash,
        account,
        true,
        0,
        confirmingSignature,
        ethers.hexlify(nextDerivedKey.publicKey),
        nextNextPublicKeyHash,
        nextNextNextPublicKeyHash,
        currentPublicKeyHash,
        nextNextPublicKeyHash,
        false
      );
      console.log("Wrap Tx Hash:", tx.hash);
      await provider.send("evm_mine", []);
      await tx.wait();

      const nextSigner = new ethers.Wallet(
        ethers.hexlify(nextDerivedKey.privateKey),
        provider
      );
      const nextAddress = nextSigner.address;
      const remainingMockBalance = await mockERC20.balanceOf(account);
      if (remainingMockBalance > 0) {
        const mockTransferTx = await mockERC20.transfer(
          nextAddress,
          remainingMockBalance
        );
        await mockTransferTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(
            remainingMockBalance
          )} $MOCK to ${nextAddress}`
        );
      }

      const remainingEthBalance = await provider.getBalance(account);
      if (remainingEthBalance > ethers.parseEther("0.1")) {
        const ethToTransfer = remainingEthBalance - ethers.parseEther("0.1");
        const ethTransferTx = await signer.sendTransaction({
          to: nextAddress,
          value: ethToTransfer,
        });
        await ethTransferTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(
            ethToTransfer
          )} ETH to ${nextAddress}`
        );
      }

      setCurrentKey(nextDerivedKey);
      setNextKey(nextNextDerivedKey);
      setLastPublicKeyHash(nextPublicKeyHash);
      setSigner(nextSigner);
      setAccount(nextAddress);
      setStatus(`Wrapped 10 $MOCK to $WMOCK for ${nextAddress}`);
    } catch (error) {
      console.error("Wrap local failed:", error);
      setStatus("Wrap local failed: " + error.message);
    }
  };

  const unwrapLocal = async () => {
    if (!provider || !signer || !rootWallet) {
      setStatus("Provider, signer, or root wallet not initialized");
      return;
    }

    try {
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const wrappedToken = new ethers.Contract(
        WRAPPED_TOKEN_ADDRESS,
        WRAPPED_TOKEN_ABI,
        signer
      );
      const mockERC20 = new ethers.Contract(
        MOCK_ERC20_ADDRESS,
        ERC20_ABI,
        signer
      );

      const amountToUnwrap = ethers.parseEther("5");

      // Check balances
      const wmockBalance = await wrappedToken.balanceOf(account);
      console.log("Account $WMOCK Balance:", ethers.formatEther(wmockBalance));
      if (wmockBalance < amountToUnwrap) {
        setStatus("Insufficient $WMOCK balance");
        return;
      }

      const ethBalance = await provider.getBalance(account);
      console.log("Account ETH Balance:", ethers.formatEther(ethBalance));
      if (ethBalance < ethers.parseEther("0.1")) {
        setStatus("Insufficient ETH balance for gas");
        return;
      }

      // Approve bridge to burn $WMOCK
      const approveTx = await wrappedToken.approve(
        BRIDGE_ADDRESS,
        amountToUnwrap
      );
      console.log("Approval Tx Hash:", approveTx.hash);
      await approveTx.wait();
      const allowance = await wrappedToken.allowance(account, BRIDGE_ADDRESS);
      console.log("Allowance after approval:", ethers.formatEther(allowance));

      const currentIndex = await keyLogRegistry.getCurrentIndex(account);
      console.log("Current Index:", currentIndex.toString());

      let prevEntry;
      let prevPublicKeyHash = "0x0000000000000000000000000000000000000000";
      if (currentIndex > 0) {
        prevEntry = await keyLogRegistry.keyLogs(account, currentIndex - 1n);
        if (!prevEntry.isOnChain) {
          setStatus("Previous key log entry is not on-chain");
          return;
        }
        prevPublicKeyHash = prevEntry.publicKeyHash;
        console.log("Previous Entry:", {
          publicKeyHash: prevEntry.publicKeyHash,
          prerotatedKeyHash: prevEntry.prerotatedKeyHash,
          twicePrerotatedKeyHash: prevEntry.twicePrerotatedKeyHash,
        });
      }

      let derivedKey = await deriveSecurePath(rootWallet, kdp);
      let currentDerivedKey,
        nextDerivedKey,
        nextNextDerivedKey,
        nextNextNextDerivedKey;

      for (let i = 0; i < currentIndex; i++) {
        derivedKey = (await deriveNextKey(derivedKey, provider, rootWallet))
          .key;
      }
      currentDerivedKey = derivedKey;
      nextDerivedKey = (
        await deriveNextKey(currentDerivedKey, provider, rootWallet)
      ).key;
      nextNextDerivedKey = (
        await deriveNextKey(nextDerivedKey, provider, rootWallet)
      ).key;
      nextNextNextDerivedKey = (
        await deriveNextKey(nextNextDerivedKey, provider, rootWallet)
      ).key;

      const currentPublicKeyHash =
        "0x" +
        ethers
          .keccak256(ethers.hexlify(currentDerivedKey.publicKey))
          .slice(-40);
      const nextPublicKeyHash =
        "0x" +
        ethers.keccak256(ethers.hexlify(nextDerivedKey.publicKey)).slice(-40);
      const nextNextPublicKeyHash =
        "0x" +
        ethers
          .keccak256(ethers.hexlify(nextNextDerivedKey.publicKey))
          .slice(-40);
      const nextNextNextPublicKeyHash =
        "0x" +
        ethers
          .keccak256(ethers.hexlify(nextNextNextDerivedKey.publicKey))
          .slice(-40);

      console.log("Derived Keys:", {
        currentPublicKeyHash,
        nextPublicKeyHash,
        nextNextPublicKeyHash,
        nextNextNextPublicKeyHash,
      });

      if (currentIndex > 0) {
        const currentPublicKeyHashLower = currentPublicKeyHash.toLowerCase();
        const prevPrerotatedKeyHashLower =
          prevEntry.prerotatedKeyHash.toLowerCase();
        if (currentPublicKeyHashLower !== prevPrerotatedKeyHashLower) {
          console.error(
            "Mismatch: currentPublicKeyHash",
            currentPublicKeyHash,
            "does not match prevEntry.prerotatedKeyHash",
            prevEntry.prerotatedKeyHash
          );
          setStatus("Key derivation mismatch with on-chain state");
          return;
        }
      }

      const nonce = await bridge.nonces(signer.address);
      console.log("Bridge Nonce:", nonce.toString());

      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [WRAPPED_TOKEN_ADDRESS, amountToUnwrap, account, nonce.toString()]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const confirmingMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          WRAPPED_TOKEN_ADDRESS,
          0,
          nextNextPublicKeyHash,
          (nonce + 1n).toString(),
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await signer.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      const unconfirmedParams = {
        amount: amountToUnwrap,
        signature: unconfirmedSignature,
        publicKey: ethers.hexlify(currentDerivedKey.publicKey),
        prerotatedKeyHash: nextPublicKeyHash,
        twicePrerotatedKeyHash: nextNextPublicKeyHash,
        prevPublicKeyHash: prevPublicKeyHash,
        targetAddress: account,
        hasRelationship: true,
      };

      const confirmingParams = {
        amount: ethers.parseEther("0"),
        signature: confirmingSignature,
        publicKey: ethers.hexlify(nextDerivedKey.publicKey),
        prerotatedKeyHash: nextNextPublicKeyHash,
        twicePrerotatedKeyHash: nextNextNextPublicKeyHash,
        prevPublicKeyHash: currentPublicKeyHash,
        targetAddress: nextNextPublicKeyHash,
        hasRelationship: false,
      };

      const tx = await bridge.unwrapPair(
        WRAPPED_TOKEN_ADDRESS,
        unconfirmedParams,
        confirmingParams
      );
      console.log("Unwrap Tx Hash:", tx.hash);
      await provider.send("evm_mine", []);
      await tx.wait();

      // Transfer balances to next key
      const nextSigner = new ethers.Wallet(
        ethers.hexlify(nextDerivedKey.privateKey),
        provider
      );
      const nextAddress = nextSigner.address;

      const remainingWmockBalance = await wrappedToken.balanceOf(account);
      if (remainingWmockBalance > 0) {
        const wmockTransferTx = await wrappedToken.transfer(
          nextAddress,
          remainingWmockBalance
        );
        await wmockTransferTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(
            remainingWmockBalance
          )} $WMOCK to ${nextAddress}`
        );
      }

      const remainingMockBalance = await mockERC20.balanceOf(account);
      if (remainingMockBalance > 0) {
        const mockTransferTx = await mockERC20.transfer(
          nextAddress,
          remainingMockBalance
        );
        await mockTransferTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(
            remainingMockBalance
          )} $MOCK to ${nextAddress}`
        );
      }

      const remainingEthBalance = await provider.getBalance(account);
      if (remainingEthBalance > ethers.parseEther("0.1")) {
        const ethToTransfer = remainingEthBalance - ethers.parseEther("0.1");
        const ethTransferTx = await signer.sendTransaction({
          to: nextAddress,
          value: ethToTransfer,
        });
        await ethTransferTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(
            ethToTransfer
          )} ETH to ${nextAddress}`
        );
      }

      setCurrentKey(nextDerivedKey);
      setNextKey(nextNextDerivedKey);
      setLastPublicKeyHash(nextPublicKeyHash);
      setSigner(nextSigner);
      setAccount(nextAddress);
      setStatus(`Unwrapped 5 $WMOCK to $MOCK for ${nextAddress}`);
    } catch (error) {
      console.error("Unwrap local failed:", error);
      setStatus("Unwrap local failed: " + error.message);
    }
  };

  const setupContracts = async () => {
    setStatus("Setup Contracts not implemented yet");
  };

  const wrapCrossChain = async () => {
    setStatus("Wrap Cross-Chain not implemented yet");
  };

  const unwrapCrossChain = async () => {
    setStatus("Unwrap Cross-Chain not implemented yet");
  };

  return (
    <div className="App">
      <h1>Bridge DApp (Hardhat Test)</h1>
      <p>{status}</p>
      <p>Fee Collector: {feeCollector}</p>
      {account && (
        <>
          <button onClick={setupContracts}>Setup Contracts</button>
          <button onClick={wrapLocal}>Wrap 10 $MOCK</button>
          <button onClick={unwrapLocal}>Unwrap 5 $WMOCK</button>
          <button onClick={wrapCrossChain}>Wrap 10 $MOCK (Cross-Chain)</button>
          <button onClick={unwrapCrossChain}>
            Unwrap 5 $WMOCK (Cross-Chain)
          </button>
        </>
      )}
    </div>
  );
}

export default Bridge;
