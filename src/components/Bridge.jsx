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

  const getKeyState = async (baseKey, log) => {
    console.log("Current Index:", log.length);
    let currentKey = {
      key: baseKey,
      signer: new ethers.Wallet(
        ethers.hexlify(baseKey.privateKey),
        localProvider
      ),
    };
    let prevDerivedKey = null;

    if (log.length > 0) {
      const lastLog = log[log.length - 1];
      while (currentKey.signer.address !== lastLog.prerotatedKeyHash) {
        prevDerivedKey = currentKey;
        currentKey = await deriveNextKey(currentKey.key);
      }
    } else {
      prevDerivedKey = currentKey;
      currentKey = await deriveNextKey(currentKey.key);
    }

    const currentDerivedKey = currentKey;
    const nextDerivedKey = await deriveNextKey(currentDerivedKey.key);
    const nextNextDerivedKey = await deriveNextKey(nextDerivedKey.key);

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

        if (log.length === 0) {
          let walletNonce = await localProvider.getTransactionCount(
            wallet.address,
            "latest"
          );

          const mockERC20 = new ethers.Contract(
            MOCK_ERC20_ADDRESS,
            ERC20_ABI,
            wallet
          );
          const mock2ERC20 = new ethers.Contract(
            MOCK2_ERC20_ADDRESS,
            ERC20_ABI,
            wallet
          );
          const largeApprovalAmount = ethers.parseEther("1000000");

          const mockApprovalTx = await mockERC20.approve(
            BRIDGE_ADDRESS,
            largeApprovalAmount,
            { nonce: walletNonce }
          );
          await mockApprovalTx.wait();
          walletNonce++;

          const mock2ApprovalTx = await mock2ERC20.approve(
            BRIDGE_ADDRESS,
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

          const relayerTx = await bridge.setRelayer(wallet.address, {
            nonce: walletNonce,
          });
          await relayerTx.wait();
          walletNonce++;

          const authTx = await keyLogRegistry.setAuthorizedCaller(
            BRIDGE_ADDRESS,
            { nonce: walletNonce }
          );
          await authTx.wait();
          walletNonce++;

          const inceptionTx = await keyLogRegistry.registerKeyLog(
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
            keyState.currentDerivedKey.signer.address,
            keyState.nextDerivedKey.signer.address,
            keyState.nextNextDerivedKey.signer.address,
            "0x0000000000000000000000000000000000000000",
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

  const wrap = async (isCrossChain = false) => {
    const hdWallet = createHDWallet(HARDHAT_MNEMONIC);
    const initialKey = await deriveSecurePath(hdWallet, kdp);
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
      const hardhatWallet =
        ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider);

      const amountToWrap = ethers.parseEther("10");
      const nonce = await localProvider.getTransactionCount(
        keyState.currentDerivedKey.signer.address,
        "latest"
      );

      keyState.nextNextNextDerivedKey = await deriveNextKey(
        keyState.nextNextDerivedKey.key
      );
      const bridgeNonce = await bridge.nonces(
        keyState.currentDerivedKey.signer.address
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

      // Transaction parameters
      const txParams = [
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
          tokenSource: hardhatWallet.address,
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
          tokenSource: hardhatWallet.address,
        },
      ];

      // Get balance and fee data
      const balance = await localProvider.getBalance(
        keyState.currentDerivedKey.signer.address
      );
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;

      // Estimate gas conservatively
      const gasEstimate = await bridge.wrapPairWithTransfer.estimateGas(
        ...txParams,
        { value: 0n } // Baseline without ETH
      );
      let gasCost = gasEstimate * gasPrice;
      console.log("Initial Gas Estimate:", gasEstimate.toString());
      console.log("Gas Price:", ethers.formatEther(gasPrice));
      console.log("Initial Gas Cost:", ethers.formatEther(gasCost));
      console.log("Balance:", ethers.formatEther(balance));

      // Re-estimate with ETH transfer, using a safe initial value
      const safeInitialValue = balance / 2n; // Start with half the balance
      const gasEstimateWithEth = await bridge.wrapPairWithTransfer.estimateGas(
        ...txParams,
        { value: safeInitialValue }
      );
      gasCost = gasEstimateWithEth * gasPrice;
      console.log("Gas Estimate with ETH:", gasEstimateWithEth.toString());
      console.log("Base Gas Cost:", ethers.formatEther(gasCost));

      // Apply a larger buffer based on observed max upfront cost
      const observedGasCost = ethers.parseEther("0.0012"); // ~0.001159 ETH from error + margin
      const totalGasCost =
        gasCost > observedGasCost ? gasCost * 2n : observedGasCost * 2n; // Double for safety
      const amountToSend = balance - totalGasCost;

      console.log(
        "Total Gas Cost (with buffer):",
        ethers.formatEther(totalGasCost)
      );
      console.log("Amount to Send:", ethers.formatEther(amountToSend));

      if (amountToSend <= 0n) {
        throw new Error(
          `Insufficient balance for gas. Balance: ${ethers.formatEther(
            balance
          )} ETH, Total Gas Cost: ${ethers.formatEther(totalGasCost)} ETH`
        );
      }

      // Execute the transaction
      const tx = await bridge.wrapPairWithTransfer(...txParams, {
        nonce,
        value: amountToSend,
        gasLimit: (gasEstimateWithEth * 150n) / 100n, // 50% buffer
        gasPrice,
      });

      await localProvider.send("evm_mine", []);
      await tx.wait();

      setStatus(
        `Wrapped 10 $${
          isCrossChain ? "MOCK" : "MOCK2"
        } and transferred ${ethers.formatEther(amountToSend)} ETH to ${
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
      const updatedLog = await keyLogRegistry.buildFromPublicKey(
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
      );
      setLog(() => updatedLog);
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

      const amountToUnwrap = ethers.parseEther("5");
      const nonce = await localProvider.getTransactionCount(
        keyState.currentDerivedKey.signer.address,
        "latest"
      );

      const bridgeNonce = await bridge.nonces(
        keyState.currentDerivedKey.signer.address
      );

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
      const unconfirmedSignature =
        await keyState.currentDerivedKey.signer.signMessage(
          ethers.getBytes(unconfirmedMessageHash)
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
      const confirmingSignature =
        await keyState.nextDerivedKey.signer.signMessage(
          ethers.getBytes(confirmingMessageHash)
        );

      // Transaction parameters
      const txParams = [
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
          twicePrerotatedKeyHash: keyState.nextNextDerivedKey.signer.address,
          prevPublicKeyHash: keyState.currentDerivedKey.signer.address,
          targetAddress: keyState.nextNextDerivedKey.signer.address,
          hasRelationship: false,
        },
      ];

      // Get balance and fee data
      const balance = await localProvider.getBalance(
        keyState.currentDerivedKey.signer.address
      );
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;

      // Estimate gas conservatively
      const gasEstimate = await bridge.unwrapPairWithTransfer.estimateGas(
        ...txParams,
        { value: 0n } // Baseline without ETH
      );
      let gasCost = gasEstimate * gasPrice;
      console.log("Initial Gas Estimate:", gasEstimate.toString());
      console.log("Gas Price:", ethers.formatEther(gasPrice));
      console.log("Initial Gas Cost:", ethers.formatEther(gasCost));
      console.log("Balance:", ethers.formatEther(balance));

      // Re-estimate with ETH transfer
      const safeInitialValue = balance / 2n; // Start with half the balance
      const gasEstimateWithEth =
        await bridge.unwrapPairWithTransfer.estimateGas(...txParams, {
          value: safeInitialValue,
        });
      gasCost = gasEstimateWithEth * gasPrice;
      console.log("Gas Estimate with ETH:", gasEstimateWithEth.toString());
      console.log("Base Gas Cost:", ethers.formatEther(gasCost));

      // Apply a larger buffer based on observed max upfront cost
      const observedGasCost = ethers.parseEther("0.0012"); // From wrap error + margin
      const totalGasCost =
        gasCost > observedGasCost ? gasCost * 2n : observedGasCost * 2n; // Double for safety
      const amountToSend = balance - totalGasCost;

      console.log(
        "Total Gas Cost (with buffer):",
        ethers.formatEther(totalGasCost)
      );
      console.log("Amount to Send:", ethers.formatEther(amountToSend));

      if (amountToSend <= 0n) {
        throw new Error(
          `Insufficient balance for gas. Balance: ${ethers.formatEther(
            balance
          )} ETH, Total Gas Cost: ${ethers.formatEther(totalGasCost)} ETH`
        );
      }

      // Execute the transaction
      const tx = await bridge.unwrapPairWithTransfer(...txParams, {
        nonce,
        value: amountToSend,
        gasLimit: (gasEstimateWithEth * 150n) / 100n, // 50% buffer
        gasPrice,
      });

      await localProvider.send("evm_mine", []);
      await tx.wait();

      setStatus(
        `Unwrapped 5 $${
          isCrossChain ? "WMOCK" : "YMOCK"
        } and transferred ${ethers.formatEther(amountToSend)} ETH to ${
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
      const updatedLog = await keyLogRegistry.buildFromPublicKey(
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
      );
      setLog(() => updatedLog);
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
      <button onClick={() => wrap(false)} disabled={log.length === 0}>
        Wrap 10 $MOCK (On-Chain)
      </button>
      <button onClick={() => unwrap(false)} disabled={log.length === 0}>
        Unwrap 5 $YMOCK (On-Chain)
      </button>
      <button onClick={() => wrap(true)} disabled={log.length === 0}>
        Wrap 10 $MOCK (Cross-Chain)
      </button>
      <button onClick={() => unwrap(true)} disabled={log.length === 0}>
        Unwrap 5 $WMOCK (Cross-Chain)
      </button>
    </div>
  );
}

export default Bridge;
