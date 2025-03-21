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

// Update these from deploy.js
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
  const [lastPublicKeyHash, setLastPublicKeyHash] = useState(
    "0x0000000000000000000000000000000000000000"
  );

  useEffect(() => {
    const init = async () => {
      try {
        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/", {
          chainId: 31337,
          name: "hardhat",
        });
        const wallet =
          ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(provider);

        const hdWallet = createHDWallet(HARDHAT_MNEMONIC);
        setRootWallet(hdWallet);
        const initialKey = await deriveSecurePath(hdWallet, "defaultPassword");
        const privateKeyHex = ethers.hexlify(
          initialKey.privateKey instanceof Uint8Array
            ? initialKey.privateKey
            : ethers.getBytes(initialKey.privateKey)
        );
        const initialSigner = new ethers.Wallet(privateKeyHex, provider);

        const walletNonce = await provider.getTransactionCount(
          wallet.address,
          "latest"
        );
        const ethAmount = ethers.parseEther("1.0");
        const tx = await wallet.sendTransaction({
          to: initialSigner.address,
          value: ethAmount,
          nonce: walletNonce,
        });
        await tx.wait();

        const bridge = new ethers.Contract(
          BRIDGE_ADDRESS,
          BRIDGE_ABI,
          initialSigner
        );
        console.log(
          "Bridge runner:",
          bridge.runner ? await bridge.runner.getAddress() : "No runner"
        );
        console.log("Bridge target:", bridge.target);

        const collector = await bridge.feeCollector();

        setProvider(provider);
        setSigner(initialSigner);
        setAccount(initialSigner.address);
        setFeeCollector(collector);
        setStatus("Connected to Hardhat: " + initialSigner.address);

        await registerInitialKeyLogPair(initialKey, initialSigner, provider);
      } catch (error) {
        setStatus("Error connecting to Hardhat: " + error.message);
        console.error("Init error:", error);
      }
    };
    init();
  }, []);

  const deriveNextKey = async () => {
    if (!rootWallet || !provider) return null;
    const nextKey = await deriveSecurePath(currentKey || rootWallet, kdp);
    const nextSigner = new ethers.Wallet(
      ethers.hexlify(nextKey.privateKey),
      provider
    );
    setCurrentKey(nextKey);
    setSigner(nextSigner);
    return { key: nextKey, signer: nextSigner };
  };

  const registerInitialKeyLogPair = async (
    initialKey,
    initialSigner,
    provider
  ) => {
    const bridge = new ethers.Contract(
      BRIDGE_ADDRESS,
      BRIDGE_ABI,
      initialSigner
    );
    console.log(
      "Bridge runner:",
      bridge.runner ? await bridge.runner.getAddress() : "No runner"
    );
    console.log("Bridge target:", bridge.target);

    if (!bridge.runner) {
      throw new Error("Runner not attached to bridge contract");
    }

    try {
      const feeCollector = await bridge.feeCollector();
      console.log("Fee collector:", feeCollector);

      const signerNonce = await provider.getTransactionCount(
        initialSigner.address,
        "latest"
      );
      const bridgeNonce = await bridge.nonces(initialSigner.address);
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        initialSigner
      );

      // Check existing key logs
      let currentIndex;
      try {
        currentIndex = await keyLogRegistry.getCurrentIndex(
          initialSigner.address
        );
        console.log("Current index:", currentIndex.toString());
      } catch (error) {
        console.warn("getCurrentIndex failed, defaulting to 0:", error);
        currentIndex = 0n;
      }

      let unconfirmedPrevPublicKeyHash =
        "0x0000000000000000000000000000000000000000";
      let shouldRegister = false;

      if (currentIndex > 0n) {
        const lastEntry = await keyLogRegistry.keyLogs(
          initialSigner.address,
          currentIndex - 1n
        );
        console.log("Last key log entry:", lastEntry);
        unconfirmedPrevPublicKeyHash = lastEntry.publicKeyHash; // For UNCONFIRMED event
        console.log("Key log already exists, skipping initial registration");
        setStatus("Key log already exists for " + initialSigner.address);
        return; // Exit if a key log exists
      } else {
        console.log(
          "No existing key log, proceeding with initial registration"
        );
        shouldRegister = true;
      }

      if (!shouldRegister) return;

      const signingKey = new ethers.SigningKey(initialSigner.privateKey);
      const publicKey = ethers.hexlify(signingKey.publicKey);
      const nextKey = await deriveSecurePath(initialKey, kdp);
      const nextSigner = new ethers.Wallet(
        ethers.hexlify(
          nextKey.privateKey instanceof Uint8Array
            ? nextKey.privateKey
            : ethers.getBytes(nextKey.privateKey)
        ),
        provider
      );
      const nextNextKey = await deriveSecurePath(nextKey, kdp);
      const nextNextSigner = new ethers.Wallet(
        ethers.hexlify(
          nextNextKey.privateKey instanceof Uint8Array
            ? nextNextKey.privateKey
            : ethers.getBytes(nextNextKey.privateKey)
        ),
        provider
      );
      const nextNextNextKey = await deriveSecurePath(nextNextKey, kdp);
      const nextNextNextSigner = new ethers.Wallet(
        ethers.hexlify(
          nextNextNextKey.privateKey instanceof Uint8Array
            ? nextNextNextKey.privateKey
            : ethers.getBytes(nextNextNextKey.privateKey)
        ),
        provider
      );

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
          0,
          nextNextSigner.address,
          (bridgeNonce + 1n).toString(),
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await initialSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      const nextSigningKey = new ethers.SigningKey(nextSigner.privateKey);
      const confirmingPublicKeyRaw = nextSigningKey.publicKey; // Hex string with 0x04 prefix
      const confirmingPublicKey = "0x" + confirmingPublicKeyRaw.slice(4); // Remove "0x04" prefix
      console.log("confirmingPublicKey (no prefix):", confirmingPublicKey);
      const computedHash = ethers.keccak256(confirmingPublicKey);
      const computedAddress = "0x" + computedHash.slice(-40);
      console.log("Computed address:", computedAddress);
      console.log("nextSigner.address:", nextSigner.address);

      // For CONFIRMING event, prevPublicKeyHash is the unconfirmedPublicKeyHash from this pair
      const confirmingPrevPublicKeyHash =
        "0x" + ethers.keccak256(publicKey).slice(-40); // Hash of unconfirmedPublicKey

      const tx = await bridge.wrapPair(
        MOCK_ERC20_ADDRESS,
        ethers.parseEther("0"),
        unconfirmedSignature,
        publicKey,
        nextSigner.address,
        nextNextSigner.address,
        unconfirmedPrevPublicKeyHash,
        initialSigner.address,
        true,
        ethers.parseEther("0"),
        confirmingSignature,
        confirmingPublicKey,
        nextNextSigner.address,
        nextNextNextSigner.address,
        confirmingPrevPublicKeyHash,
        nextNextSigner.address,
        false,
        { nonce: signerNonce }
      );
      console.log("Transaction hash:", tx.hash);
      await provider.send("evm_mine", []);
      await tx.wait();
      console.log("Transaction confirmed:", tx.hash);
      setStatus("Initial key log pair registered");
    } catch (error) {
      console.error("Wrap pair failed:", error);
      setStatus("Wrap pair failed: " + error.message);
    }
  };

  const setupContracts = async () => {
    if (!signer || !provider) return;
    try {
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
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);

      const currentNonce = await provider.getTransactionCount(
        signer.address,
        "latest"
      );
      await keyLogRegistry.setAuthorizedCaller(BRIDGE_ADDRESS, {
        nonce: currentNonce,
      });
      await wrappedToken.setBridge(BRIDGE_ADDRESS, { nonce: currentNonce + 1 });
      await bridge.addTokenPair(
        MOCK_ERC20_ADDRESS,
        WRAPPED_TOKEN_ADDRESS,
        false,
        { nonce: currentNonce + 2 }
      );

      setStatus("Contracts configured");
    } catch (error) {
      setStatus("Error setting up contracts: " + error.message);
      console.error("Setup error:", error);
    }
  };

  const wrapLocal = async () => {
    if (!signer || !provider) return;
    try {
      const { signer: newSigner, key: newKey } = await deriveNextKey();
      const mockERC20 = new ethers.Contract(
        MOCK_ERC20_ADDRESS,
        ERC20_ABI,
        newSigner
      );
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, newSigner);

      const wallet =
        ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(provider);
      let walletNonce = await provider.getTransactionCount(
        wallet.address,
        "latest"
      );

      const ethAmount = ethers.parseEther("0.1");
      const fundEthTx = await wallet.sendTransaction({
        to: newSigner.address,
        value: ethAmount,
        nonce: walletNonce,
      });
      await fundEthTx.wait();
      console.log(
        `Sent ${ethers.formatEther(ethAmount)} ETH to ${newSigner.address}`
      );
      walletNonce++;

      const tokenAmount = ethers.parseEther("10");
      const walletMockERC20 = new ethers.Contract(
        MOCK_ERC20_ADDRESS,
        ERC20_ABI,
        wallet
      );
      const fundTokenTx = await walletMockERC20.transfer(
        newSigner.address,
        tokenAmount,
        { nonce: walletNonce }
      );
      await fundTokenTx.wait();
      console.log(
        `Sent ${ethers.formatEther(tokenAmount)} MOCK to ${newSigner.address}`
      );

      const currentNonce = await provider.getTransactionCount(
        newSigner.address,
        "latest"
      );
      const nonce = await bridge.nonces(newSigner.address);
      const amount = ethers.parseEther("10");
      await mockERC20.approve(BRIDGE_ADDRESS, amount, { nonce: currentNonce });

      const messageHash = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [MOCK_ERC20_ADDRESS, amount, account, nonce.toString()]
      );
      const signature = await newSigner.signMessage(
        ethers.getBytes(messageHash)
      );

      const tx = await bridge.wrap(
        MOCK_ERC20_ADDRESS,
        amount,
        signature,
        ethers.hexlify(newKey.publicKey),
        ethers.keccak256(ethers.hexlify(newKey.publicKey)),
        ethers.keccak256(ethers.hexlify(newKey.publicKey)),
        lastPublicKeyHash,
        account,
        false,
        { nonce: currentNonce + 1 }
      );
      await provider.send("evm_mine", []);
      await tx.wait();

      setLastPublicKeyHash(newSigner.address);
      setStatus("10 $PEPE wrapped to $YPEPE");
    } catch (error) {
      setStatus("Error wrapping local tokens: " + error.message);
      console.error("Wrap local error:", error);
    }
  };

  const wrapCrossChain = async () => {
    if (!signer || !provider) return;
    try {
      const { signer: newSigner, key: newKey } = await deriveNextKey();
      const mockERC20 = new ethers.Contract(
        MOCK_ERC20_ADDRESS,
        ERC20_ABI,
        newSigner
      );
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, newSigner);

      const currentNonce = await provider.getTransactionCount(
        newSigner.address,
        "latest"
      );
      const amount = ethers.parseEther("10");
      await mockERC20.approve(BRIDGE_ADDRESS, amount, { nonce: currentNonce });

      await bridge.lockCrossChain(
        MOCK_ERC20_ADDRESS,
        amount,
        ethers.hexlify(newKey.publicKey),
        ethers.keccak256(ethers.hexlify(newKey.publicKey)),
        ethers.keccak256(ethers.hexlify(newKey.publicKey)),
        { nonce: currentNonce + 1 }
      );
      await bridge.mintWrappedToken(WRAPPED_TOKEN_ADDRESS, account, amount, {
        nonce: currentNonce + 2,
      });

      setLastPublicKeyHash(newSigner.address);
      setStatus("10 $WYDA minted (simulated cross-chain wrap)");
    } catch (error) {
      setStatus("Error wrapping cross-chain: " + error.message);
      console.error("Wrap cross-chain error:", error);
    }
  };

  const unwrapLocal = async () => {
    if (!signer || !provider) return;
    try {
      const { signer: newSigner, key: newKey } = await deriveNextKey();
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, newSigner);

      const currentNonce = await provider.getTransactionCount(
        newSigner.address,
        "latest"
      );
      const nonce = await bridge.nonces(newSigner.address);
      const amount = ethers.parseEther("5");

      const messageHash = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [WRAPPED_TOKEN_ADDRESS, amount, account, nonce.toString()]
      );
      const signature = await newSigner.signMessage(
        ethers.getBytes(messageHash)
      );

      await bridge.unwrap(
        WRAPPED_TOKEN_ADDRESS,
        amount,
        signature,
        ethers.hexlify(newKey.publicKey),
        ethers.keccak256(ethers.hexlify(newKey.publicKey)),
        ethers.keccak256(ethers.hexlify(newKey.publicKey)),
        lastPublicKeyHash,
        account,
        false,
        { nonce: currentNonce }
      );

      setLastPublicKeyHash(newSigner.address);
      setStatus("5 $YPEPE unwrapped to $PEPE");
    } catch (error) {
      setStatus("Error unwrapping local tokens: " + error.message);
      console.error("Unwrap local error:", error);
    }
  };

  const unwrapCrossChain = async () => {
    if (!signer || !provider) return;
    try {
      const { signer: newSigner, key: newKey } = await deriveNextKey();
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, newSigner);

      const currentNonce = await provider.getTransactionCount(
        newSigner.address,
        "latest"
      );
      const nonce = await bridge.nonces(newSigner.address);
      const amount = ethers.parseEther("5");

      const messageHash = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [WRAPPED_TOKEN_ADDRESS, amount, account, nonce.toString()]
      );
      const signature = await newSigner.signMessage(
        ethers.getBytes(messageHash)
      );

      await bridge.unwrap(
        WRAPPED_TOKEN_ADDRESS,
        amount,
        signature,
        ethers.hexlify(newKey.publicKey),
        ethers.keccak256(ethers.hexlify(newKey.publicKey)),
        ethers.keccak256(ethers.hexlify(newKey.publicKey)),
        lastPublicKeyHash,
        account,
        false,
        { nonce: currentNonce }
      );

      setLastPublicKeyHash(newSigner.address);
      setStatus("5 $WYDA burned (simulated cross-chain unwrap)");
    } catch (error) {
      setStatus("Error unwrapping cross-chain: " + error.message);
      console.error("Unwrap cross-chain error:", error);
    }
  };

  return (
    <div className="App">
      <h1>Bridge DApp (Hardhat Test)</h1>
      <p>{status}</p>
      <p>Fee Collector: {feeCollector}</p>
      {account && (
        <>
          <button onClick={setupContracts}>Setup Contracts</button>
          <button onClick={wrapLocal}>Wrap 10 $PEPE</button>
          <button onClick={unwrapLocal}>Unwrap 5 $YPEPE</button>
          <button onClick={wrapCrossChain}>Wrap 10 $YDA (Cross-Chain)</button>
          <button onClick={unwrapCrossChain}>
            Unwrap 5 $WYDA (Cross-Chain)
          </button>
        </>
      )}
    </div>
  );
}

export default Bridge;
