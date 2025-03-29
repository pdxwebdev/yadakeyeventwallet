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

const localProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/", {
  chainId: 31337,
  name: "hardhat",
});
function Bridge() {
  const [status, setStatus] = useState("");
  const [feeCollector, setFeeCollector] = useState("");
  const [kdp, setKdp] = useState("defaultPassword");
  const [log, setLog] = useState([]);

  const deriveNextKey = async (baseKey) => {
    const derivedKey = await deriveSecurePath(baseKey, kdp);
    const signer = new ethers.Wallet(
      ethers.hexlify(derivedKey.privateKey),
      localProvider
    );
    return { key: derivedKey, signer };
  };

  const getKeyState = async (derivedKey, log) => {
    let prevDerivedKey = null;
    derivedKey.key = derivedKey;
    console.log("Current Index:", log.length);
    for (let i = 0; i < log.length; i++) {
      derivedKey = await deriveNextKey(derivedKey.key, localProvider);
      if (derivedKey.signer.address === log[log.length - 1].publicKeyHash) {
        prevDerivedKey = derivedKey;
        derivedKey = derivedKey.key;
        break;
      }
    }
    const currentDerivedKey = await deriveNextKey(derivedKey, localProvider);
    const nextDerivedKey = await deriveNextKey(
      currentDerivedKey.key,
      localProvider
    );
    const nextNextDerivedKey = await deriveNextKey(
      nextDerivedKey.key,
      localProvider
    );
    return {
      prevDerivedKey,
      currentDerivedKey,
      nextDerivedKey,
      nextNextDerivedKey,
    };
  };

  useEffect(() => {
    const init = async () => {
      try {
        const wallet =
          ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider);
        const signer = new ethers.Wallet(
          ethers.hexlify(wallet.privateKey),
          localProvider
        );
        const hdWallet = createHDWallet(HARDHAT_MNEMONIC);
        const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, wallet);
        const keyLogRegistry = new ethers.Contract(
          KEYLOG_REGISTRY_ADDRESS,
          KEYLOG_REGISTRY_ABI,
          wallet
        );
        const initialKey = await deriveSecurePath(hdWallet, kdp);

        const log = await keyLogRegistry.buildFromPublicKey(
          initialKey.uncompressedPublicKey.slice(1)
        );
        setLog(() => log);
        const keyState = await getKeyState(hdWallet, log);
        if (log.length == 0) {
          let walletNonce = await localProvider.getTransactionCount(
            signer.address,
            "latest"
          );

          const ethAmount = ethers.parseEther("10");
          const ethTx = await wallet.sendTransaction({
            to: keyState.currentDerivedKey.signer.address,
            value: ethAmount,
            nonce: walletNonce,
          });
          await ethTx.wait();
          console.log(
            `Funded ${
              keyState.currentDerivedKey.signer.address
            } with ${ethers.formatEther(ethAmount)} ETH`
          );
          walletNonce++;

          const mockERC20 = new ethers.Contract(
            MOCK_ERC20_ADDRESS,
            ERC20_ABI,
            wallet
          );
          const mockAmount = ethers.parseEther("100");
          const mockTx = await mockERC20.transfer(
            keyState.currentDerivedKey.signer.address,
            mockAmount,
            { nonce: walletNonce }
          );
          await mockTx.wait();
          console.log(
            `Transferred ${ethers.formatEther(mockAmount)} $MOCK to ${
              keyState.currentDerivedKey.signer.address
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
            keyState.currentDerivedKey.signer.address,
            mock2Amount,
            { nonce: walletNonce }
          );
          await mock2Tx.wait();
          console.log(
            `Transferred ${ethers.formatEther(mock2Amount)} $MOCK2 to ${
              keyState.currentDerivedKey.signer.address
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

          const ethForGasNext = ethers.parseEther("1");
          const ethTxForNext = await wallet.sendTransaction({
            to: keyState.nextDerivedKey.signer.address,
            value: ethForGasNext,
            nonce: walletNonce,
          });
          await ethTxForNext.wait();
          console.log(
            `Funded ${
              keyState.nextDerivedKey.signer.address
            } with ${ethers.formatEther(ethForGasNext)} ETH for gas`
          );
          walletNonce++;

          const mockForNext = ethers.parseEther("10");
          const mockTxForNext = await mockERC20.transfer(
            keyState.nextDerivedKey.signer.address,
            mockForNext,
            { nonce: walletNonce }
          );
          await mockTxForNext.wait();
          console.log(
            `Transferred ${ethers.formatEther(mockForNext)} $MOCK to ${
              keyState.nextDerivedKey.signer.address
            }`
          );
          walletNonce++;

          const ethForGasFinal = ethers.parseEther("1");
          const ethTxForFinal = await wallet.sendTransaction({
            to: keyState.nextNextDerivedKey.signer.address,
            value: ethForGasFinal,
            nonce: walletNonce,
          });
          await ethTxForFinal.wait();
          console.log(
            `Funded ${
              keyState.nextNextDerivedKey.signer.address
            } with ${ethers.formatEther(ethForGasFinal)} ETH for gas`
          );
          walletNonce++;

          const mockForFinal = ethers.parseEther("10");
          const mockTxForFinal = await mockERC20.transfer(
            keyState.nextNextDerivedKey.signer.address,
            mockForFinal,
            { nonce: walletNonce }
          );
          await mockTxForFinal.wait();
          console.log(
            `Transferred ${ethers.formatEther(mockForFinal)} $MOCK to ${
              keyState.nextNextDerivedKey.signer.address
            }`
          );
          walletNonce++;

          console.log(
            keyState.currentDerivedKey.signer.address // Level 0
          );
          console.log(keyState.nextDerivedKey.signer.address); // Level 1
          console.log(keyState.nextNextDerivedKey.signer.address); // Level 2)

          const inceptionTx = await keyLogRegistry.registerKeyLog(
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
            keyState.currentDerivedKey.signer.address, // Level 0
            keyState.nextDerivedKey.signer.address, // Level 1
            keyState.nextNextDerivedKey.signer.address, // Level 2
            "0x0000000000000000000000000000000000000000",
            keyState.nextDerivedKey.signer.address,
            false,
            { nonce: walletNonce }
          );
          await inceptionTx.wait();

          const log = await keyLogRegistry.buildFromPublicKey(
            initialKey.uncompressedPublicKey.slice(1)
          );
          setLog(() => log);
          console.log("Registered inception key log entry");
          setStatus("Initialization complete with 3 key rotations");
        } else {
          const collector = await bridge.feeCollector();
          setFeeCollector(collector);
          setStatus("Loaded existing key state");
        }
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
    const hdWallet = createHDWallet(HARDHAT_MNEMONIC);
    const keyState = await getKeyState(hdWallet, log);
    try {
      const bridge = new ethers.Contract(
        BRIDGE_ADDRESS,
        BRIDGE_ABI,
        keyState.currentDerivedKey.signer
      );
      const originalTokenAddress = isCrossChain
        ? MOCK_ERC20_ADDRESS
        : MOCK2_ERC20_ADDRESS;
      const mockERC20 = new ethers.Contract(
        originalTokenAddress,
        ERC20_ABI,
        keyState.currentDerivedKey.signer
      );

      const amountToWrap = ethers.parseEther("10");
      let nonce = await localProvider.getTransactionCount(
        keyState.currentDerivedKey.signer.address,
        "latest"
      );

      const balance = await mockERC20.balanceOf(
        keyState.currentDerivedKey.signer.address
      );
      console.log(
        `Balance of ${
          keyState.currentDerivedKey.signer.address
        } for ${originalTokenAddress}: ${ethers.formatEther(balance)}`
      );

      if (balance < amountToWrap) {
        const hardhatWallet =
          ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider);
        const mockERC20WithHardhat = new ethers.Contract(
          originalTokenAddress,
          ERC20_ABI,
          hardhatWallet
        );
        const transferAmount = ethers.parseEther("10");
        const hardhatNonce = await localProvider.getTransactionCount(
          hardhatWallet.address,
          "latest"
        );
        const transferTx = await mockERC20WithHardhat.transfer(
          keyState.currentDerivedKey.signer.address,
          transferAmount,
          { nonce: hardhatNonce }
        );
        await transferTx.wait();
        console.log(
          `Transferred ${ethers.formatEther(transferAmount)} $${
            isCrossChain ? "MOCK" : "MOCK2"
          } to ${keyState.currentDerivedKey.signer.address} from Hardhat wallet`
        );
      }

      const currentAllowance = await mockERC20.allowance(
        keyState.currentDerivedKey.signer.address,
        BRIDGE_ADDRESS
      );
      console.log(`Current allowance: ${ethers.formatEther(currentAllowance)}`);

      if (currentAllowance < amountToWrap) {
        const approvalAmount = ethers.parseEther("1000");
        const approveTx = await mockERC20.approve(
          BRIDGE_ADDRESS,
          approvalAmount,
          { nonce, gasLimit: 100000 } // Added gasLimit for efficiency
        );
        await approveTx.wait();
        console.log(
          `Approved Bridge to spend ${ethers.formatEther(approvalAmount)} $${
            isCrossChain ? "MOCK" : "MOCK2"
          }`
        );
        nonce++;
      }

      // Fund nextNextDerivedKey with ETH for gas
      const ethForGas = ethers.parseEther("1"); // 1 ETH for nextNextDerivedKey
      const hardhatWallet =
        ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider);
      const hardhatNonce = await localProvider.getTransactionCount(
        hardhatWallet.address,
        "latest"
      );

      const ethBalanceNextNext = await localProvider.getBalance(
        keyState.nextNextDerivedKey.signer.address
      );
      if (ethBalanceNextNext < ethForGas) {
        const ethTxNextNext = await hardhatWallet.sendTransaction({
          to: keyState.nextNextDerivedKey.signer.address,
          value: ethForGas,
          nonce: hardhatNonce,
        });
        await ethTxNextNext.wait();
        console.log(
          `Funded ${
            keyState.nextNextDerivedKey.signer.address
          } with ${ethers.formatEther(ethForGas)} ETH for gas`
        );
      }

      const ethBalance = await localProvider.getBalance(
        keyState.currentDerivedKey.signer.address
      );
      console.log(
        `ETH Balance of ${
          keyState.currentDerivedKey.signer.address
        }: ${ethers.formatEther(ethBalance)}`
      );
      const wrappedToken = await bridge.originalToWrapped(originalTokenAddress);
      console.log(
        `Wrapped token for $${isCrossChain ? "MOCK" : "MOCK2"}: ${wrappedToken}`
      );
      console.log(`Nonce before wrap: ${nonce}`);

      keyState.nextNextNextDerivedKey = await deriveNextKey(
        keyState.nextNextDerivedKey.key,
        localProvider
      );
      const bridgeNonce = await bridge.nonces(
        keyState.currentDerivedKey.signer.address
      );
      console.log(
        `Bridge nonce for ${
          keyState.currentDerivedKey.signer.address
        }: ${bridgeNonce.toString()}`
      );

      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          originalTokenAddress,
          amountToWrap,
          keyState.nextDerivedKey.signer.address,
          bridgeNonce,
        ]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature =
        await keyState.currentDerivedKey.signer.signMessage(
          ethers.getBytes(unconfirmedMessageHash)
        );
      console.log("Unconfirmed Message Hash:", unconfirmedMessageHash);

      const confirmingMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          originalTokenAddress,
          0,
          keyState.nextNextDerivedKey.signer.address,
          bridgeNonce + 1n,
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature =
        await keyState.nextDerivedKey.signer.signMessage(
          ethers.getBytes(confirmingMessageHash)
        );
      console.log("Confirming Message Hash:", confirmingMessageHash);

      console.log(
        "Next Signer Address:",
        keyState.nextDerivedKey.signer.address
      );
      console.log("Fee Collector:", await bridge.feeCollector());

      const tx = await bridge.wrapPairWithTransfer(
        originalTokenAddress,
        {
          amount: amountToWrap,
          signature: unconfirmedSignature,
          publicKey:
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
          prerotatedKeyHash: keyState.nextDerivedKey.signer.address,
          twicePrerotatedKeyHash: keyState.nextNextDerivedKey.signer.address,
          prevPublicKeyHash: keyState.prevDerivedKey
            ? keyState.prevDerivedKey.signer.address
            : ethers.ZeroAddress,
          outputAddress: keyState.nextDerivedKey.signer.address,
          hasRelationship: true,
        },
        {
          amount: ethers.parseEther("0"),
          signature: confirmingSignature,
          publicKey: keyState.nextDerivedKey.key.uncompressedPublicKey.slice(1),
          prerotatedKeyHash: keyState.nextNextDerivedKey.signer.address,
          twicePrerotatedKeyHash:
            keyState.nextNextNextDerivedKey.signer.address,
          prevPublicKeyHash: keyState.currentDerivedKey.signer.address,
          outputAddress: keyState.nextNextDerivedKey.signer.address,
          hasRelationship: false,
        },
        { nonce }
      );
      await localProvider.send("evm_mine", []);
      await tx.wait();

      localStorage.setItem(
        "previousPrivateKey",
        ethers.hexlify(keyState.currentDerivedKey.key.privateKey)
      );
      localStorage.setItem(
        "bridgePrivateKey",
        ethers.hexlify(keyState.nextDerivedKey.key.privateKey)
      );
      localStorage.setItem(
        "bridgeAccount",
        keyState.nextDerivedKey.signer.address
      );

      setStatus(
        `Wrapped 10 $${isCrossChain ? "MOCK" : "MOCK2"} to ${
          keyState.nextDerivedKey.signer.address
        }`
      );
      const wallet =
        ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider);
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        wallet
      );
      const log = await keyLogRegistry.buildFromPublicKey(
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
      );
      setLog(() => log);
    } catch (error) {
      setStatus("Wrap failed: " + error.message);
      console.error("Wrap failed:", error);
    }
  };

  const unwrap = async (isCrossChain = false) => {
    const hdWallet = createHDWallet(HARDHAT_MNEMONIC);
    const keyState = await getKeyState(hdWallet, log);
    try {
      const bridge = new ethers.Contract(
        BRIDGE_ADDRESS,
        BRIDGE_ABI,
        keyState.currentDerivedKey.signer
      );
      const wrappedTokenAddress = isCrossChain
        ? WRAPPED_TOKEN_ADDRESS
        : Y_WRAPPED_TOKEN_ADDRESS;
      const wrappedToken = new ethers.Contract(
        wrappedTokenAddress,
        WRAPPED_TOKEN_ABI,
        keyState.currentDerivedKey.signer
      );
      const originalTokenAddress = isCrossChain
        ? MOCK_ERC20_ADDRESS
        : MOCK2_ERC20_ADDRESS;
      const mockERC20 = new ethers.Contract(
        originalTokenAddress,
        ERC20_ABI,
        localProvider
      );

      const amountToUnwrap = ethers.parseEther("5");
      let nonce = await localProvider.getTransactionCount(
        keyState.currentDerivedKey.signer.address,
        "latest"
      );

      // Log signer details
      console.log("Signer Address:", keyState.currentDerivedKey.signer.address);
      const ethBalance = await localProvider.getBalance(
        keyState.currentDerivedKey.signer.address
      );
      console.log(`ETH Balance: ${ethers.formatEther(ethBalance)}`);

      // Check wrapped token balance and allowance
      const wrappedBalance = await wrappedToken.balanceOf(
        keyState.currentDerivedKey.signer.address
      );
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
        keyState.currentDerivedKey.signer.address,
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

      // Prepare signatures
      const bridgeNonce = await bridge.nonces(
        keyState.currentDerivedKey.signer.address
      );
      console.log(`Bridge Nonce: ${bridgeNonce.toString()}`);

      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          wrappedTokenAddress,
          amountToUnwrap,
          keyState.nextDerivedKey.signer.address,
          bridgeNonce,
        ]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedEthSignedHash = ethers.toBeHex(
        ethers.hashMessage(ethers.getBytes(unconfirmedMessageHash))
      );
      const unconfirmedSignature =
        await keyState.currentDerivedKey.signer.signMessage(
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
      console.log(
        "Expected Signer:",
        keyState.currentDerivedKey.signer.address
      );

      const confirmingMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          wrappedTokenAddress,
          0,
          keyState.nextNextDerivedKey.signer.address,
          bridgeNonce + 1n,
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingEthSignedHash = ethers.toBeHex(
        ethers.hashMessage(ethers.getBytes(confirmingMessageHash))
      );
      const confirmingSignature =
        await keyState.currentDerivedKey.signer.signMessage(
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
        ethers.hexlify(
          keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
        )
      );
      console.log(
        "Next Signer Address (prerotated):",
        keyState.nextDerivedKey.signer.address
      );

      keyState.nextNextNextDerivedKey = await deriveNextKey(
        keyState.nextNextDerivedKey.key,
        localProvider
      );
      console.log(
        "Next Next Signer Address (twicePrerotated):",
        keyState.nextNextNextDerivedKey.signer.address
      );

      // Execute unwrapPairWithTransfer
      const tx = await bridge.unwrapPairWithTransfer(
        wrappedTokenAddress,
        {
          amount: amountToUnwrap,
          signature: unconfirmedSignature,
          publicKey:
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
          prerotatedKeyHash: keyState.nextDerivedKey.signer.address,
          twicePrerotatedKeyHash: keyState.nextNextDerivedKey.signer.address,
          prevPublicKeyHash: keyState.prevDerivedKey
            ? keyState.prevDerivedKey.signer.address
            : ethers.ZeroAddress,
          targetAddress: keyState.nextDerivedKey.signer.address,
          hasRelationship: true,
        },
        {
          amount: ethers.parseEther("0"),
          signature: confirmingSignature,
          publicKey: keyState.nextDerivedKey.key.uncompressedPublicKey.slice(1),
          prerotatedKeyHash: keyState.nextNextDerivedKey.signer.address,
          twicePrerotatedKeyHash:
            keyState.nextNextNextDerivedKey.signer.address,
          prevPublicKeyHash: keyState.currentDerivedKey.signer.address,
          targetAddress: keyState.nextNextDerivedKey.signer.address,
          hasRelationship: false,
        },
        { nonce, gasLimit: 1000000 } // Increased gas limit for debugging
      );
      console.log("Transaction Hash:", tx.hash);
      await localProvider.send("evm_mine", []);
      await tx.wait();

      // Update state
      localStorage.setItem(
        "previousPrivateKey",
        ethers.hexlify(keyState.currentDerivedKey.key.privateKey)
      );
      localStorage.setItem(
        "bridgePrivateKey",
        ethers.hexlify(keyState.nextDerivedKey.key.privateKey)
      );
      localStorage.setItem(
        "bridgeAccount",
        keyState.nextDerivedKey.signer.address
      );

      setStatus(
        `Unwrapped 5 $${isCrossChain ? "WMOCK" : "YMOCK"} to ${
          keyState.nextNextDerivedKey.signer.address
        }`
      );
      const wallet =
        ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider);
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        wallet
      );
      const log = await keyLogRegistry.buildFromPublicKey(
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
      );
      setLog(() => log);
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
      <button onClick={() => wrap(false)}>Wrap 10 $MOCK (On-Chain)</button>
      <button onClick={() => unwrap(false)}>Unwrap 5 $YMOCK (On-Chain)</button>
      <button onClick={() => wrap(true)}>Wrap 10 $MOCK (Cross-Chain)</button>
      <button onClick={() => unwrap(true)}>
        Unwrap 5 $WMOCK (Cross-Chain)
      </button>
    </div>
  );
}

export default Bridge;
