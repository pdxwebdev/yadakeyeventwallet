/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

import React, { useState, useEffect } from "react";
import { ethers } from "ethers"; // v6
import "../App.css";
import BridgeArtifact from "../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import { createHDWallet, deriveSecurePath } from "../utils/hdWallet";
import { getKeyState } from "../shared/keystate";
import {
  BRIDGE_ADDRESS,
  HARDHAT_MNEMONIC,
  KEYLOG_REGISTRY_ADDRESS,
  localProvider,
  MOCK2_ERC20_ADDRESS,
  MOCK_ERC20_ADDRESS,
  WRAPPED_TOKEN_ADDRESS,
  Y_WRAPPED_TOKEN_ADDRESS,
} from "../shared/constants";

const BRIDGE_ABI = BridgeArtifact.abi;
const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;
const ERC20_ABI = MockERC20Artifact.abi;

function Bridge() {
  const [status, setStatus] = useState("");
  const [feeCollector, setFeeCollector] = useState("");
  const [kdp, setKdp] = useState("defaultPassword");
  const [log, setLog] = useState([]);

  // Helper to print balances
  const printBalances = async (signer, tokenAddresses) => {
    for (const tokenAddress of tokenAddresses) {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const balance = await token.balanceOf(signer.address);
      const name = await token.name();
      console.log(
        `${name} Balance of ${signer.address}:`,
        ethers.formatEther(balance)
      );
    }
  };

  // Helper to generate permit for a token
  const generatePermit = async (tokenAddress, signer, amount) => {
    const token = new ethers.Contract(tokenAddress, WRAPPED_TOKEN_ABI, signer);
    const domain = {
      name: await token.name(),
      version: "1",
      chainId: 31337, // Hardhat chain ID
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
    const permitNonce = await token.nonces(signer.address);
    const permitDeadline = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
    const message = {
      owner: signer.address,
      spender: BRIDGE_ADDRESS,
      value: amount.toString(),
      nonce: permitNonce.toString(),
      deadline: permitDeadline,
    };
    const signature = await signer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);
    return {
      token: tokenAddress,
      amount,
      deadline: permitDeadline,
      v,
      r,
      s,
    };
  };

  // Helper to fetch supported tokens and their balances
  const getUserTokensAndPermits = async (signer, bridge) => {
    const supportedOriginalTokens = await bridge.getSupportedTokens();
    const permits = [];

    for (const origToken of supportedOriginalTokens) {
      // Check original token balance
      const origTokenContract = new ethers.Contract(
        origToken,
        ERC20_ABI,
        signer
      );
      const origBalance = await origTokenContract.balanceOf(signer.address);
      if (origBalance > 0) {
        const permit = await generatePermit(origToken, signer, origBalance);
        permits.push(permit);
      }

      // Check wrapped token balance
      const wrappedToken = await bridge.originalToWrapped(origToken);
      if (wrappedToken !== ethers.ZeroAddress) {
        const wrappedTokenContract = new ethers.Contract(
          wrappedToken,
          WRAPPED_TOKEN_ABI,
          signer
        );
        const wrappedBalance = await wrappedTokenContract.balanceOf(
          signer.address
        );
        if (wrappedBalance > 0) {
          const permit = await generatePermit(
            wrappedToken,
            signer,
            wrappedBalance
          );
          permits.push(permit);
        }
      }
    }

    return permits;
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
        const keyState = await getKeyState(hdWallet, log, kdp);

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
            {
              nonce: walletNonce,
            }
          );
          await mockApprovalTx.wait();
          walletNonce++;

          const mock2ApprovalTx = await mock2ERC20.approve(
            BRIDGE_ADDRESS,
            largeApprovalAmount,
            {
              nonce: walletNonce,
            }
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
            {
              nonce: walletNonce,
            }
          );
          await authTx.wait();
          walletNonce++;

          const inceptionTx = await keyLogRegistry.registerKeyLog(
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
            keyState.currentDerivedKey.signer.address,
            keyState.nextDerivedKey.signer.address,
            keyState.nextNextDerivedKey.signer.address,
            ethers.ZeroAddress,
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
    const keyState = await getKeyState(hdWallet, log, kdp);

    try {
      const bridge = new ethers.Contract(
        BRIDGE_ADDRESS,
        BRIDGE_ABI,
        keyState.currentDerivedKey.signer
      );
      const originalTokenAddress = isCrossChain
        ? MOCK_ERC20_ADDRESS
        : MOCK2_ERC20_ADDRESS;
      const originalToken = new ethers.Contract(
        originalTokenAddress,
        ERC20_ABI,
        keyState.currentDerivedKey.signer
      );
      const amountToWrap = ethers.parseEther("1");
      const nonce = await localProvider.getTransactionCount(
        keyState.currentDerivedKey.signer.address,
        "latest"
      );
      const bridgeNonce = await bridge.nonces(
        keyState.currentDerivedKey.signer.address
      );

      // Generate signatures for unconfirmed and confirming
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

      // Generate permits for all owned tokens
      const permits = await getUserTokensAndPermits(
        keyState.currentDerivedKey.signer,
        bridge
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
          tokenSource:
            ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider)
              .address,
          permits: permits.map((p) => ({
            token: p.token,
            amount: p.amount,
            deadline: p.deadline,
            v: p.v,
            r: p.r,
            s: p.s,
          })),
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
          tokenSource:
            ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(localProvider)
              .address,
          permits: [], // Confirming doesn't need permits
        },
      ];

      // Estimate gas and calculate ETH to send
      const balance = await localProvider.getBalance(
        keyState.currentDerivedKey.signer.address
      );
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasEstimate = await bridge.wrapPairWithTransfer.estimateGas(
        ...txParams,
        { value: 0n }
      );
      let gasCost = gasEstimate * gasPrice;
      const safeInitialValue = balance / 2n;
      const gasEstimateWithEth = await bridge.wrapPairWithTransfer.estimateGas(
        ...txParams,
        {
          value: safeInitialValue,
        }
      );
      gasCost = gasEstimateWithEth * gasPrice;
      const observedGasCost = ethers.parseEther("0.0012");
      const totalGasCost =
        gasCost > observedGasCost ? gasCost * 2n : observedGasCost * 2n;
      const amountToSend = balance - totalGasCost;

      if (amountToSend <= 0n) {
        throw new Error(
          `Insufficient balance for gas. Balance: ${ethers.formatEther(
            balance
          )} ETH, Total Gas Cost: ${ethers.formatEther(totalGasCost)} ETH`
        );
      }

      // Print balances before
      const allTokens = (await bridge.getSupportedTokens()).concat([
        WRAPPED_TOKEN_ADDRESS,
        Y_WRAPPED_TOKEN_ADDRESS,
      ]);
      await printBalances(keyState.currentDerivedKey.signer, allTokens);
      await printBalances(keyState.nextNextDerivedKey.signer, allTokens);

      // Execute transaction
      const tx = await bridge.wrapPairWithTransfer(...txParams, {
        nonce,
        value: amountToSend,
        gasLimit: (gasEstimateWithEth * 150n) / 100n,
        gasPrice,
      });

      await localProvider.send("evm_mine", []);
      await tx.wait();

      // Log events
      const wrappedToken = new ethers.Contract(
        isCrossChain ? WRAPPED_TOKEN_ADDRESS : Y_WRAPPED_TOKEN_ADDRESS,
        WRAPPED_TOKEN_ABI,
        localProvider
      );
      const filter = wrappedToken.filters.Transfer(null, null);
      const events = await wrappedToken.queryFilter(
        filter,
        tx.blockNumber - 1,
        tx.blockNumber
      );
      events.forEach((event) =>
        console.log((isCrossChain ? "YDA" : "PEPE") + " Transfer:", event.args)
      );

      // Print balances after
      await printBalances(keyState.currentDerivedKey.signer, allTokens);
      await printBalances(keyState.nextNextDerivedKey.signer, allTokens);

      setStatus(
        `Wrapped ${ethers.formatEther(amountToWrap)} $${
          isCrossChain ? "YDA" : "PEPE"
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
    const keyState = await getKeyState(hdWallet, log, kdp);

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
        localProvider
      );
      const nonce = await localProvider.getTransactionCount(
        keyState.currentDerivedKey.signer.address,
        "latest"
      );
      const bridgeNonce = await bridge.nonces(
        keyState.currentDerivedKey.signer.address
      );
      const wrappedBalance = await wrappedToken.balanceOf(
        keyState.currentDerivedKey.signer.address
      );

      // Generate signatures
      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          wrappedTokenAddress,
          wrappedBalance,
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

      // Generate permits for all owned tokens
      const permits = await getUserTokensAndPermits(
        keyState.currentDerivedKey.signer,
        bridge
      );

      // Transaction parameters
      const txParams = [
        wrappedTokenAddress,
        {
          amount: wrappedBalance,
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
          permits: permits.map((p) => ({
            token: p.token,
            amount: p.amount,
            deadline: p.deadline,
            v: p.v,
            r: p.r,
            s: p.s,
          })),
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
          permits: [],
        },
      ];

      // Estimate gas and calculate ETH to send
      const balance = await localProvider.getBalance(
        keyState.currentDerivedKey.signer.address
      );
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasEstimate = await bridge.unwrapPairWithTransfer.estimateGas(
        ...txParams,
        { value: 0n }
      );
      let gasCost = gasEstimate * gasPrice;
      const safeInitialValue = balance / 2n;
      const gasEstimateWithEth =
        await bridge.unwrapPairWithTransfer.estimateGas(...txParams, {
          value: safeInitialValue,
        });
      gasCost = gasEstimateWithEth * gasPrice;
      const observedGasCost = ethers.parseEther("0.0012");
      const totalGasCost =
        gasCost > observedGasCost ? gasCost * 2n : observedGasCost * 2n;
      const amountToSend = balance - totalGasCost;

      if (amountToSend <= 0n) {
        throw new Error(
          `Insufficient balance for gas. Balance: ${ethers.formatEther(
            balance
          )} ETH, Total Gas Cost: ${ethers.formatEther(totalGasCost)} ETH`
        );
      }

      // Print balances before
      const allTokens = (await bridge.getSupportedTokens()).concat([
        WRAPPED_TOKEN_ADDRESS,
        Y_WRAPPED_TOKEN_ADDRESS,
      ]);
      await printBalances(keyState.currentDerivedKey.signer, allTokens);
      await printBalances(keyState.nextNextDerivedKey.signer, allTokens);

      // Execute transaction
      const tx = await bridge.unwrapPairWithTransfer(...txParams, {
        nonce,
        value: amountToSend,
        gasLimit: (gasEstimateWithEth * 150n) / 100n,
        gasPrice,
      });

      await localProvider.send("evm_mine", []);
      await tx.wait();

      // Log events
      const filter = wrappedToken.filters.Transfer(null, null);
      const events = await wrappedToken.queryFilter(
        filter,
        tx.blockNumber - 1,
        tx.blockNumber
      );
      events.forEach((event) =>
        console.log(
          (isCrossChain ? "WYDA" : "YPEPE") + " Transfer:",
          event.args
        )
      );

      // Print balances after
      await printBalances(keyState.currentDerivedKey.signer, allTokens);
      await printBalances(keyState.nextNextDerivedKey.signer, allTokens);

      setStatus(
        `Unwrapped ${ethers.formatEther(wrappedBalance)} $${
          isCrossChain ? "WYDA" : "YPEPE"
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
        Wrap 10 $PEPE (On-Chain)
      </button>
      <button onClick={() => unwrap(false)} disabled={log.length === 0}>
        Unwrap 5 $YPEPE (On-Chain)
      </button>
      <button onClick={() => wrap(true)} disabled={log.length === 0}>
        Wrap 10 $YDA (Cross-Chain)
      </button>
      <button onClick={() => unwrap(true)} disabled={log.length === 0}>
        Unwrap 5 $WYDA (Cross-Chain)
      </button>
    </div>
  );
}

export default Bridge;
