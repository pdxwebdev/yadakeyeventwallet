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
const WRAPPED_TOKEN_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"; // $WMOCK
const Y_WRAPPED_TOKEN_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"; // $YMOCK
const MOCK_ERC20_ADDRESS = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707"; // $MOCK
const MOCK2_ERC20_ADDRESS = "0x0165878A594ca255338adfa4d48449f69242Eb8F"; // $MOCK2

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
  const [previousKey, setPreviousKey] = useState(null); // Added previousKey state
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
          {
            chainId: 31337,
            name: "hardhat",
          }
        );
        const wallet =
          ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider);
        const hdWallet = createHDWallet(HARDHAT_MNEMONIC);

        const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, wallet);
        const keyLogRegistry = new ethers.Contract(
          KEYLOG_REGISTRY_ADDRESS,
          KEYLOG_REGISTRY_ABI,
          wallet
        );

        const isInitialized = localStorage.getItem("bridgeInitialized");
        let currentSigner, currentDerivedKey, currentAccount;

        if (!isInitialized) {
          const initialKey = await deriveSecurePath(hdWallet, kdp);
          currentDerivedKey = initialKey;
          currentSigner = new ethers.Wallet(
            ethers.hexlify(initialKey.privateKey),
            localProvider
          );
          currentAccount = currentSigner.address;

          let walletNonce = await localProvider.getTransactionCount(
            wallet.address,
            "latest"
          );

          const ethAmount = ethers.parseEther("10");
          const ethTx = await wallet.sendTransaction({
            to: currentSigner.address,
            value: ethAmount,
            nonce: walletNonce,
          });
          await ethTx.wait();
          console.log(
            `Funded ${currentSigner.address} with ${ethers.formatEther(
              ethAmount
            )} ETH`
          );
          walletNonce++;

          const mockERC20 = new ethers.Contract(
            MOCK_ERC20_ADDRESS,
            ERC20_ABI,
            wallet
          );
          const mockAmount = ethers.parseEther("100");
          const mockTx = await mockERC20.transfer(
            currentSigner.address,
            mockAmount,
            { nonce: walletNonce }
          );
          await mockTx.wait();
          console.log(
            `Transferred ${ethers.formatEther(mockAmount)} $MOCK to ${
              currentSigner.address
            }`
          );
          walletNonce++;

          const mock2ERC20 = new ethers.Contract(
            MOCK2_ERC20_ADDRESS,
            ERC20_ABI,
            wallet
          );
          const mock2Amount = ethers.parseEther("100");
          const mock2Tx = await mock2ERC20.transfer(
            currentSigner.address,
            mock2Amount,
            { nonce: walletNonce }
          );
          await mock2Tx.wait();
          console.log(
            `Transferred ${ethers.formatEther(mock2Amount)} $MOCK2 to ${
              currentSigner.address
            }`
          );
          walletNonce++;

          const largeApprovalAmount = ethers.parseEther("1000000");
          const mockApprovalTx = await mockERC20.approve(
            BRIDGE_ADDRESS,
            largeApprovalAmount,
            { nonce: walletNonce }
          );
          await mockApprovalTx.wait();
          console.log(
            `Approved Bridge to spend ${ethers.formatEther(
              largeApprovalAmount
            )} $MOCK`
          );
          walletNonce++;

          const mock2ApprovalTx = await mock2ERC20.approve(
            BRIDGE_ADDRESS,
            largeApprovalAmount,
            { nonce: walletNonce }
          );
          await mock2ApprovalTx.wait();
          console.log(
            `Approved Bridge to spend ${ethers.formatEther(
              largeApprovalAmount
            )} $MOCK2`
          );
          walletNonce++;

          const relayerTx = await bridge.setRelayer(wallet.address, {
            nonce: walletNonce,
          });
          await relayerTx.wait();
          console.log(`Set relayer to ${wallet.address}`);
          walletNonce++;

          const authTx = await keyLogRegistry.setAuthorizedCaller(
            BRIDGE_ADDRESS,
            { nonce: walletNonce }
          );
          await authTx.wait();
          console.log(`Set authorized caller to ${BRIDGE_ADDRESS}`);
          walletNonce++;

          const { key: nextKey, signer: nextSigner } = await deriveNextKey(
            currentDerivedKey,
            localProvider,
            hdWallet
          );
          const { key: nextNextKey, signer: nextNextSigner } =
            await deriveNextKey(nextKey, localProvider, hdWallet);
          const { key: nextNextNextKey, signer: nextNextNextSigner } =
            await deriveNextKey(nextNextKey, localProvider, hdWallet);

          const ethForGasNext = ethers.parseEther("1");
          const ethTxForNext = await wallet.sendTransaction({
            to: nextSigner.address,
            value: ethForGasNext,
            nonce: walletNonce,
          });
          await ethTxForNext.wait();
          console.log(
            `Funded ${nextSigner.address} with ${ethers.formatEther(
              ethForGasNext
            )} ETH for gas`
          );
          walletNonce++;

          const mockForNext = ethers.parseEther("10");
          const mockTxForNext = await mockERC20.transfer(
            nextSigner.address,
            mockForNext,
            { nonce: walletNonce }
          );
          await mockTxForNext.wait();
          console.log(
            `Transferred ${ethers.formatEther(mockForNext)} $MOCK to ${
              nextSigner.address
            }`
          );
          walletNonce++;

          const ethForGasFinal = ethers.parseEther("1");
          const ethTxForFinal = await wallet.sendTransaction({
            to: nextNextNextSigner.address,
            value: ethForGasFinal,
            nonce: walletNonce,
          });
          await ethTxForFinal.wait();
          console.log(
            `Funded ${nextNextNextSigner.address} with ${ethers.formatEther(
              ethForGasFinal
            )} ETH for gas`
          );
          walletNonce++;

          const mockForFinal = ethers.parseEther("10");
          const mockTxForFinal = await mockERC20.transfer(
            nextNextNextSigner.address,
            mockForFinal,
            { nonce: walletNonce }
          );
          await mockTxForFinal.wait();
          console.log(
            `Transferred ${ethers.formatEther(mockForFinal)} $MOCK to ${
              nextNextNextSigner.address
            }`
          );
          walletNonce++;

          console.log(
            currentSigner.address // Level 0
          );
          console.log(nextSigner.address); // Level 1
          console.log(nextNextSigner.address); // Level 2)

          const inceptionTx = await keyLogRegistry.registerKeyLog(
            currentDerivedKey.uncompressedPublicKey.slice(1),
            currentSigner.address, // Level 0
            nextSigner.address, // Level 1
            nextNextSigner.address, // Level 2
            "0x0000000000000000000000000000000000000000",
            nextSigner.address,
            false,
            { nonce: walletNonce }
          );
          await inceptionTx.wait();
          console.log("Registered inception key log entry");

          localStorage.setItem("bridgeInitialized", "true");
          localStorage.setItem("bridgeAccount", nextNextNextSigner.address);
          localStorage.setItem(
            "bridgePrivateKey",
            ethers.hexlify(nextNextNextKey.privateKey)
          );
          localStorage.setItem(
            "previousPrivateKey",
            ethers.hexlify(nextNextKey.privateKey)
          );

          setPreviousKey(currentKey); // Level 2
          setCurrentKey(nextKey); // Level 3
          setNextKey(nextNextKey); // Level 4
          setLastPublicKeyHash(currentSigner.address); // Level 2
          setSigner(nextSigner); // Level 3
          setAccount(nextSigner.address);
          setStatus("Initialization complete with 3 key rotations");
        } else {
          const storedPrivateKey = localStorage.getItem("bridgePrivateKey");
          const storedPreviousPrivateKey =
            localStorage.getItem("previousPrivateKey");
          const storedAccount = localStorage.getItem("bridgeAccount");
          if (storedPrivateKey && storedAccount && storedPreviousPrivateKey) {
            currentSigner = new ethers.Wallet(storedPrivateKey, localProvider);
            const previousSigner = new ethers.Wallet(
              storedPreviousPrivateKey,
              localProvider
            );
            currentAccount = storedAccount;
            currentDerivedKey = await deriveSecurePath(hdWallet, kdp); // Level 0
            let derivedKey = currentDerivedKey;
            const currentIndex = await keyLogRegistry.getCurrentIndex(
              currentDerivedKey.uncompressedPublicKey.slice(1)
            );
            const indexNumber = Number(currentIndex);
            console.log("Current Index:", indexNumber);
            for (let i = 0; i < indexNumber; i++) {
              derivedKey = (
                await deriveNextKey(derivedKey, localProvider, hdWallet)
              ).key;
            }
            const nextDerivedKey = (
              await deriveNextKey(derivedKey, localProvider, hdWallet)
            ).key;

            setPreviousKey(currentKey); // Level 2
            setCurrentKey(nextKey); // Level 3
            setNextKey(nextNextKey); // Level 4
            setLastPublicKeyHash(currentSigner.address); // Level 2
            setSigner(nextSigner); // Level 3
            setAccount(nextSigner.address);
            setStatus("Loaded existing key state");
          } else {
            setStatus("Error: Missing stored keys despite initialization");
          }
        }

        const collector = await bridge.feeCollector();
        setProvider(localProvider);
        setRootWallet(hdWallet);
        setFeeCollector(collector);
      } catch (error) {
        setStatus("Error during initialization: " + error.message);
        console.error("Init error:", error);
        console.log(
          "Initialization failed. Please restart the Hardhat node and try again to reset blockchain state."
        );
      }
    };
    init();
  }, []);

  const wrap = async (isCrossChain = false) => {
    if (!provider || !signer || !rootWallet || !currentKey) {
      setStatus(
        "Provider, signer, root wallet, or current key not initialized"
      );
      return;
    }

    try {
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
      const originalTokenAddress = isCrossChain
        ? MOCK_ERC20_ADDRESS
        : MOCK2_ERC20_ADDRESS;
      const mockERC20 = new ethers.Contract(
        originalTokenAddress,
        ERC20_ABI,
        signer
      );

      const amountToWrap = ethers.parseEther("10");
      let nonce = await provider.getTransactionCount(signer.address, "latest");

      const balance = await mockERC20.balanceOf(signer.address);
      console.log(
        `Balance of ${
          signer.address
        } for ${originalTokenAddress}: ${ethers.formatEther(balance)}`
      );

      if (balance < amountToWrap) {
        const hardhatWallet =
          ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(provider);
        const mockERC20WithHardhat = new ethers.Contract(
          originalTokenAddress,
          ERC20_ABI,
          hardhatWallet
        );
        const transferAmount = ethers.parseEther("10");
        const hardhatNonce = await provider.getTransactionCount(
          hardhatWallet.address,
          "latest"
        );
        const transferTx = await mockERC20WithHardhat.transfer(
          signer.address,
          transferAmount,
          { nonce: hardhatNonce }
        );
        await transferTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(transferAmount)} $MOCK2 to ${
            signer.address
          } from Hardhat wallet`
        );
      }

      const currentAllowance = await mockERC20.allowance(
        signer.address,
        BRIDGE_ADDRESS
      );
      console.log(`Current allowance: ${ethers.formatEther(currentAllowance)}`);

      if (currentAllowance < amountToWrap) {
        const approvalAmount = ethers.parseEther("1000");
        const approveTx = await mockERC20.approve(
          BRIDGE_ADDRESS,
          approvalAmount,
          { nonce }
        );
        await approveTx.wait();
        console.log(
          `Approved Bridge to spend ${ethers.formatEther(
            approvalAmount
          )} $MOCK2`
        );
        nonce++;
      }

      const ethBalance = await provider.getBalance(signer.address);
      console.log(
        `ETH Balance of ${signer.address}: ${ethers.formatEther(ethBalance)}`
      );
      const wrappedToken = await bridge.originalToWrapped(originalTokenAddress);
      console.log(`Wrapped token for $MOCK2: ${wrappedToken}`);
      console.log(`Nonce before wrap: ${nonce}`);

      const { key: nextDerivedKey, signer: nextSigner } = await deriveNextKey(
        currentKey,
        provider,
        rootWallet
      );
      const { key: nextNextDerivedKey, signer: nextNextSigner } =
        await deriveNextKey(nextDerivedKey, provider, rootWallet);
      const { key: nextNextNextDerivedKey, signer: nextNextNextSigner } =
        await deriveNextKey(nextNextDerivedKey, provider, rootWallet);

      const bridgeNonce = await bridge.nonces(signer.address);
      console.log(
        `Bridge nonce for ${signer.address}: ${bridgeNonce.toString()}`
      );

      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          originalTokenAddress,
          amountToWrap,
          signer.address,
          bridgeNonce.toString(),
        ]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );
      console.log("Unconfirmed Message Hash:", unconfirmedMessageHash);

      const confirmingMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          originalTokenAddress,
          0,
          nextNextSigner.address,
          (bridgeNonce + 1n).toString(),
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await signer.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );
      console.log("Confirming Message Hash:", confirmingMessageHash);

      console.log("Next Signer Address:", nextSigner.address);
      console.log("Fee Collector:", await bridge.feeCollector());

      // Compute key hashes for validation
      const currentPublicKeyHash = ethers.keccak256(
        currentKey.uncompressedPublicKey.slice(1)
      );

      // Check KeyLogRegistry state
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const latestEntry = await keyLogRegistry.getLatestChainEntry(
        currentKey.uncompressedPublicKey.slice(1)
      );
      console.log("Latest Entry Exists:", latestEntry[1]);
      if (latestEntry[1]) {
        console.log(
          "Latest Entry Public Key Hash:",
          latestEntry[0].publicKeyHash
        );
        console.log(
          "Latest Entry Prerotated Key Hash:",
          latestEntry[0].prerotatedKeyHash
        );
      }

      const tx = await bridge.wrapPairWithTransfer(
        originalTokenAddress,
        {
          amount: amountToWrap,
          signature: unconfirmedSignature,
          publicKey: currentKey.uncompressedPublicKey.slice(1),
          prerotatedKeyHash: nextSigner.address,
          twicePrerotatedKeyHash: nextNextSigner.address,
          prevPublicKeyHash: lastPublicKeyHash,
          outputAddress: signer.address,
          hasRelationship: true,
        },
        {
          amount: ethers.parseEther("0"),
          signature: confirmingSignature,
          publicKey: nextDerivedKey.uncompressedPublicKey.slice(1),
          prerotatedKeyHash: nextNextSigner.address,
          twicePrerotatedKeyHash: nextNextNextSigner.address,
          prevPublicKeyHash: nextSigner.address,
          outputAddress: nextNextSigner.address,
          hasRelationship: false,
        },
        { nonce }
      );
      await provider.send("evm_mine", []);
      await tx.wait();

      localStorage.setItem(
        "previousPrivateKey",
        ethers.hexlify(currentKey.privateKey)
      );
      localStorage.setItem(
        "bridgePrivateKey",
        ethers.hexlify(nextDerivedKey.privateKey)
      );
      localStorage.setItem("bridgeAccount", nextSigner.address);

      setPreviousKey(nextDerivedKey);
      setCurrentKey(nextNextDerivedKey);
      setNextKey(nextNextNextDerivedKey);
      setLastPublicKeyHash(nextSigner.address);
      setSigner(nextNextSigner);
      setAccount(nextNextSigner.address);
      setStatus(
        `Wrapped 10 $${isCrossChain ? "MOCK" : "MOCK2"} to ${
          nextNextSigner.address
        }`
      );
    } catch (error) {
      setStatus("Wrap failed: " + error.message);
      console.error("Wrap failed:", error);
    }
  };

  const unwrap = async (isCrossChain = false) => {
    if (!provider || !signer || !rootWallet || !currentKey) {
      setStatus(
        "Provider, signer, root wallet, or current key not initialized"
      );
      return;
    }

    try {
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
      const wrappedTokenAddress = isCrossChain
        ? WRAPPED_TOKEN_ADDRESS
        : Y_WRAPPED_TOKEN_ADDRESS;
      const wrappedToken = new ethers.Contract(
        wrappedTokenAddress,
        WRAPPED_TOKEN_ABI,
        signer
      );
      const originalTokenAddress = isCrossChain
        ? MOCK_ERC20_ADDRESS
        : MOCK2_ERC20_ADDRESS;
      const mockERC20 = new ethers.Contract(
        originalTokenAddress,
        ERC20_ABI,
        provider
      );

      const amountToUnwrap = ethers.parseEther("5");
      let nonce = await provider.getTransactionCount(signer.address, "latest");

      // Log signer details
      console.log("Signer Address:", signer.address);
      const ethBalance = await provider.getBalance(signer.address);
      console.log(`ETH Balance: ${ethers.formatEther(ethBalance)}`);

      // Check wrapped token balance and allowance
      const wrappedBalance = await wrappedToken.balanceOf(signer.address);
      console.log(
        `Wrapped Balance (${wrappedTokenAddress}): ${ethers.formatEther(
          wrappedBalance
        )}`
      );
      if (wrappedBalance < amountToUnwrap) {
        setStatus(`Insufficient $${isCrossChain ? "WMOCK" : "YMOCK"} balance`);
        return;
      }

      const allowance = await wrappedToken.allowance(
        signer.address,
        BRIDGE_ADDRESS
      );
      console.log(`Allowance for Bridge: ${ethers.formatEther(allowance)}`);
      if (allowance < amountToUnwrap) {
        const approveTx = await wrappedToken.approve(
          BRIDGE_ADDRESS,
          amountToUnwrap,
          { nonce }
        );
        await approveTx.wait();
        console.log(
          `Approved ${ethers.formatEther(amountToUnwrap)} for Bridge`
        );
        nonce++;
      }

      // Check bridge's original token balance (for non-cross-chain)
      if (!isCrossChain) {
        const bridgeBalance = await mockERC20.balanceOf(BRIDGE_ADDRESS);
        console.log(
          `Bridge ${originalTokenAddress} Balance: ${ethers.formatEther(
            bridgeBalance
          )}`
        );
        if (bridgeBalance < amountToUnwrap) {
          setStatus("Bridge has insufficient original token balance");
          return;
        }
      }

      // Derive next keys
      const { key: nextDerivedKey, signer: nextSigner } = await deriveNextKey(
        currentKey,
        provider,
        rootWallet
      );
      const { key: nextNextDerivedKey, signer: nextNextSigner } =
        await deriveNextKey(nextDerivedKey, provider, rootWallet);
      const { key: nextNextNextDerivedKey, signer: nextNextNextSigner } =
        await deriveNextKey(nextNextDerivedKey, provider, rootWallet);

      // Prepare signatures
      const bridgeNonce = await bridge.nonces(signer.address);
      console.log(`Bridge Nonce: ${bridgeNonce.toString()}`);

      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [wrappedTokenAddress, amountToUnwrap, account, bridgeNonce.toString()]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedEthSignedHash = ethers.toBeHex(
        ethers.hashMessage(ethers.getBytes(unconfirmedMessageHash))
      );
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );
      const unconfirmedSigner = ethers.recoverAddress(
        unconfirmedEthSignedHash,
        unconfirmedSignature
      );
      console.log("Unconfirmed Message Hash:", unconfirmedMessageHash);
      console.log("Unconfirmed Eth Signed Hash:", unconfirmedEthSignedHash);
      console.log("Unconfirmed Signature:", unconfirmedSignature);
      console.log("Recovered Unconfirmed Signer:", unconfirmedSigner);
      console.log("Expected Signer:", signer.address);

      const confirmingMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          wrappedTokenAddress,
          0,
          nextNextSigner.address,
          (bridgeNonce + 1n).toString(),
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingEthSignedHash = ethers.toBeHex(
        ethers.hashMessage(ethers.getBytes(confirmingMessageHash))
      );
      const confirmingSignature = await signer.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );
      const confirmingSigner = ethers.recoverAddress(
        confirmingEthSignedHash,
        confirmingSignature
      );
      console.log("Confirming Message Hash:", confirmingMessageHash);
      console.log("Confirming Eth Signed Hash:", confirmingEthSignedHash);
      console.log("Confirming Signature:", confirmingSignature);
      console.log("Recovered Confirming Signer:", confirmingSigner);

      // Log key parameters
      console.log(
        "Current Public Key:",
        ethers.hexlify(currentKey.uncompressedPublicKey.slice(1))
      );
      console.log("Next Signer Address (prerotated):", nextSigner.address);
      console.log(
        "Next Next Signer Address (twicePrerotated):",
        nextNextSigner.address
      );
      console.log("Last Public Key Hash:", lastPublicKeyHash);

      // Execute unwrapPairWithTransfer
      const tx = await bridge.unwrapPairWithTransfer(
        wrappedTokenAddress,
        {
          amount: amountToUnwrap,
          signature: unconfirmedSignature,
          publicKey: ethers.hexlify(currentKey.uncompressedPublicKey.slice(1)),
          prerotatedKeyHash: nextSigner.address,
          twicePrerotatedKeyHash: nextNextSigner.address,
          prevPublicKeyHash: lastPublicKeyHash,
          targetAddress: account,
          hasRelationship: true,
        },
        {
          amount: ethers.parseEther("0"),
          signature: confirmingSignature,
          publicKey: ethers.hexlify(
            nextDerivedKey.uncompressedPublicKey.slice(1)
          ),
          prerotatedKeyHash: nextNextSigner.address,
          twicePrerotatedKeyHash: nextNextNextSigner.address,
          prevPublicKeyHash: nextSigner.address,
          targetAddress: nextNextSigner.address,
          hasRelationship: false,
        },
        { nonce, gasLimit: 1000000 } // Increased gas limit for debugging
      );
      console.log("Transaction Hash:", tx.hash);
      await provider.send("evm_mine", []);
      await tx.wait();

      // Update state
      localStorage.setItem(
        "previousPrivateKey",
        ethers.hexlify(currentKey.privateKey)
      );
      localStorage.setItem(
        "bridgePrivateKey",
        ethers.hexlify(nextDerivedKey.privateKey)
      );
      localStorage.setItem("bridgeAccount", nextSigner.address);

      setPreviousKey(currentKey);
      setCurrentKey(nextDerivedKey);
      setNextKey(nextNextDerivedKey);
      setLastPublicKeyHash(signer.address);
      setSigner(nextSigner);
      setAccount(nextSigner.address);
      setStatus(
        `Unwrapped 5 $${isCrossChain ? "WMOCK" : "YMOCK"} to ${
          nextNextSigner.address
        }`
      );
    } catch (error) {
      setStatus("Unwrap failed: " + error.message);
      console.error("Unwrap failed:", error);
    }
  };

  return (
    <div className="App">
      <h1>Bridge DApp (Hardhat Test)</h1>
      <p>{status}</p>
      <p>Fee Collector: {feeCollector}</p>
      {account && (
        <>
          <button onClick={() => wrap(false)}>Wrap 10 $MOCK (On-Chain)</button>
          <button onClick={() => unwrap(false)}>
            Unwrap 5 $YMOCK (On-Chain)
          </button>
          <button onClick={() => wrap(true)}>
            Wrap 10 $MOCK (Cross-Chain)
          </button>
          <button onClick={() => unwrap(true)}>
            Unwrap 5 $WMOCK (Cross-Chain)
          </button>
        </>
      )}
    </div>
  );
}

export default Bridge;
