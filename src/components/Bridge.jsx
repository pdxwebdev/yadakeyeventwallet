import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import "../App.css";
import BridgeArtifact from "../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import { createHDWallet, deriveSecurePath } from "../utils/hdWallet";
import { getKeyState } from "../shared/keystate";
import {
  BRIDGE_ADDRESS,
  KEYLOG_REGISTRY_ADDRESS,
  localProvider,
  MOCK2_ERC20_ADDRESS,
  MOCK_ERC20_ADDRESS,
  WRAPPED_TOKEN_ADDRESS,
  Y_WRAPPED_TOKEN_ADDRESS,
  HARDHAT_MNEMONIC,
} from "../shared/constants";
import { Button, Checkbox, Group, Loader, TextInput } from "@mantine/core";
import { useAppContext } from "../context/AppContext";
import Markets from "./Markets";
import TokenHolders from "./TokenHolders";
import WalletConnector from "./WalletConnector";

const BRIDGE_ABI = BridgeArtifact.abi;
const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;
const ERC20_ABI = MockERC20Artifact.abi;

function Bridge() {
  const [status, setStatus] = useState("");
  const [feeCollector, setFeeCollector] = useState("");
  const [kdp, setKdp] = useState("defaultPassword");
  const {
    loading,
    setLoading,
    signer,
    account,
    isOperator,
    userKeyState,
    setUserKeyState,
    selectedTestAccount,
    setSelectedTestAccount,
  } = useAppContext();

  const [originalToken, setOriginalToken] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [isCrossChain, setIsCrossChain] = useState(false);
  const [mintBurnAddress, setMintBurnAddress] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [burnAmount, setBurnAmount] = useState("");

  // Helper to print balances
  const printBalances = async (signer, tokenAddresses) => {
    for (const tokenAddress of tokenAddresses) {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const balance = await token.balanceOf(await signer.getAddress());
      const name = await token.name();
      console.log(
        `${name} Balance of ${await signer.getAddress()}:`,
        ethers.formatEther(balance)
      );
    }
  };

  const generatePermit = async (tokenAddress, signer, amount) => {
    const isWrapped = [WRAPPED_TOKEN_ADDRESS, Y_WRAPPED_TOKEN_ADDRESS]
      .map((addr) => addr.toLowerCase())
      .includes(tokenAddress.toLowerCase());
    const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
    const token = new ethers.Contract(tokenAddress, abi, signer);

    try {
      const name = await token.name();
      const domain = {
        name,
        version: "1",
        chainId: 31337,
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
      const owner = await signer.getAddress();
      const permitNonce = await token.nonces(owner);
      const permitDeadline = Math.floor(Date.now() / 1000) + 60 * 60;
      const message = {
        owner,
        spender: BRIDGE_ADDRESS,
        value: amount.toString(),
        nonce: permitNonce.toString(),
        deadline: permitDeadline,
      };
      const signature = await signer.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);
      return { token: tokenAddress, amount, deadline: permitDeadline, v, r, s };
    } catch (error) {
      console.warn(`Permit not supported for ${tokenAddress}:`, error);
      return null; // Skip tokens without permit support
    }
  };

  const getUserTokensAndPermits = async (signer, bridge, isCrossChain) => {
    const permits = [];
    const supportedOriginalTokens = await bridge.getSupportedTokens();

    for (const origToken of supportedOriginalTokens) {
      // Skip originalToken for cross-chain minting
      if (!isCrossChain) {
        const origTokenContract = new ethers.Contract(
          origToken,
          ERC20_ABI,
          signer
        );
        const origBalance = await origTokenContract.balanceOf(
          await signer.getAddress()
        );
        if (origBalance > 0) {
          const permit = await generatePermit(origToken, signer, origBalance);
          if (permit) permits.push(permit);
        }
      }
      const wrappedToken = await bridge.originalToWrapped(origToken);
      if (wrappedToken !== ethers.ZeroAddress) {
        const wrappedTokenContract = new ethers.Contract(
          wrappedToken,
          WRAPPED_TOKEN_ABI,
          signer
        );
        const wrappedBalance = await wrappedTokenContract.balanceOf(
          await signer.getAddress()
        );
        if (wrappedBalance > 0) {
          const permit = await generatePermit(
            wrappedToken,
            signer,
            wrappedBalance
          );
          if (permit) permits.push(permit);
        }
      }
    }
    return permits;
  };

  // Initialize user key log
  useEffect(() => {
    const initUser = async () => {
      if (!account) return;
      setLoading(true);
      try {
        let { log, keyState } = userKeyState[account] || {};
        const signer = keyState.currentDerivedKey.signer;
        const keyLogRegistry = new ethers.Contract(
          KEYLOG_REGISTRY_ADDRESS,
          KEYLOG_REGISTRY_ABI,
          signer
        );
        const owner = await keyLogRegistry.owner();
        console.log("KeyLogRegistry owner:", owner);
        if (!log) {
          log = await keyLogRegistry.buildFromPublicKey(
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
          );
          keyState = await getKeyState(
            hdWallet,
            log,
            kdp + selectedTestAccount
          );
          setUserKeyState((prev) => ({
            ...prev,
            [account]: { log, keyState },
          }));
        }

        // Operator-specific initialization
        if (isOperator && log.length === 0) {
          const bridge = new ethers.Contract(
            BRIDGE_ADDRESS,
            BRIDGE_ABI,
            signer
          );
          let nonce = await localProvider.getTransactionCount(
            account,
            "latest"
          );
          const mockERC20 = new ethers.Contract(
            MOCK_ERC20_ADDRESS,
            ERC20_ABI,
            signer
          );
          const mock2ERC20 = new ethers.Contract(
            MOCK2_ERC20_ADDRESS,
            ERC20_ABI,
            signer
          );
          const largeApprovalAmount = ethers.parseEther("1000000");

          await (
            await mockERC20.approve(BRIDGE_ADDRESS, largeApprovalAmount, {
              nonce: nonce++,
            })
          ).wait();
          await (
            await mock2ERC20.approve(BRIDGE_ADDRESS, largeApprovalAmount, {
              nonce: nonce++,
            })
          ).wait();
          await (
            await signer.sendTransaction({
              to: keyState.nextDerivedKey.signer.address,
              value: ethers.parseEther("4"),
              nonce: nonce++,
            })
          ).wait();
          await (await bridge.setRelayer(account, { nonce: nonce++ })).wait();
          await (
            await keyLogRegistry.setAuthorizedCaller(BRIDGE_ADDRESS, {
              nonce: nonce++,
            })
          ).wait();
          await (
            await keyLogRegistry.registerKeyLog(
              keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
              keyState.currentDerivedKey.signer.address,
              keyState.nextDerivedKey.signer.address,
              keyState.nextNextDerivedKey.signer.address,
              ethers.ZeroAddress,
              keyState.nextDerivedKey.signer.address,
              false,
              { nonce: nonce++ }
            )
          ).wait();

          const updatedLog = await keyLogRegistry.buildFromPublicKey(
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
          );
          setUserKeyState((prev) => ({
            ...prev,
            [account]: { log: updatedLog, keyState },
          }));
          setStatus("Operator initialization complete");
        } else if (log.length === 0) {
          // Regular user key log initialization
          const nonce = await localProvider.getTransactionCount(
            account,
            "latest"
          );
          await (
            await keyLogRegistry.registerKeyLog(
              keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
              keyState.currentDerivedKey.signer.address,
              keyState.nextDerivedKey.signer.address,
              keyState.nextNextDerivedKey.signer.address,
              ethers.ZeroAddress,
              keyState.nextDerivedKey.signer.address,
              false,
              { nonce }
            )
          ).wait();

          const updatedLog = await keyLogRegistry.buildFromPublicKey(
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
          );
          setUserKeyState((prev) => ({
            ...prev,
            [account]: { log: updatedLog, keyState },
          }));
          setStatus("User key log initialized");
        } else {
          const bridge = new ethers.Contract(
            BRIDGE_ADDRESS,
            BRIDGE_ABI,
            signer
          );
          setFeeCollector(await bridge.feeCollector());
          setStatus("Loaded existing key state");
        }
      } catch (error) {
        setStatus("Initialization error: " + error.message);
        console.error("Init error:", error);
      }
      setLoading(false);
    };
    initUser();
  }, [signer, account, isOperator]);

  // Wrap tokens with key rotation
  const wrap = useCallback(
    async (isCrossChain = false) => {
      if (!account || !userKeyState[account]) {
        setStatus("Please connect a wallet and initialize key state");
        return;
      }
      setLoading(true);
      try {
        const { keyState } = userKeyState[account];
        const bridge = new ethers.Contract(
          BRIDGE_ADDRESS,
          BRIDGE_ABI,
          keyState.currentDerivedKey.signer
        );
        const originalTokenAddress = isCrossChain
          ? MOCK_ERC20_ADDRESS
          : MOCK2_ERC20_ADDRESS;
        const amountToWrap = ethers.parseEther(mintAmount);
        const nonce = await localProvider.getTransactionCount(
          keyState.currentDerivedKey.signer.address,
          "latest"
        );
        const bridgeNonce = await bridge.nonces(
          keyState.currentDerivedKey.signer.address
        );

        // Validate amount for non-cross-chain
        if (!isCrossChain) {
          const originalTokenContract = new ethers.Contract(
            originalTokenAddress,
            ERC20_ABI,
            keyState.currentDerivedKey.signer
          );
          const balance = await originalTokenContract.balanceOf(
            keyState.currentDerivedKey.signer.address
          );
          if (balance < amountToWrap) {
            throw new Error(
              `Insufficient ${
                isCrossChain ? "YDA" : "PEPE"
              } balance: ${ethers.formatEther(balance)} available`
            );
          }
        }

        // Generate signatures
        const unconfirmedMessage = ethers.solidityPacked(
          ["address", "uint256", "address", "uint256"],
          [originalTokenAddress, amountToWrap, mintBurnAddress, bridgeNonce]
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

        const permits = await getUserTokensAndPermits(
          keyState.currentDerivedKey.signer,
          bridge,
          isCrossChain
        );

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
            outputAddress: mintBurnAddress,
            hasRelationship: true,
            tokenSource: account,
            permits,
          },
          {
            amount: ethers.parseEther("0"),
            signature: confirmingSignature,
            publicKey:
              keyState.nextDerivedKey.key.uncompressedPublicKey.slice(1),
            prerotatedKeyHash: keyState.nextNextDerivedKey.signer.address,
            twicePrerotatedKeyHash:
              keyState.nextNextNextDerivedKey.signer.address,
            prevPublicKeyHash: keyState.currentDerivedKey.signer.address,
            outputAddress: keyState.nextNextDerivedKey.signer.address,
            hasRelationship: false,
            tokenSource: account,
            permits: [],
          },
        ];

        // Gas estimation
        const balance = await localProvider.getBalance(
          keyState.currentDerivedKey.signer.address
        );
        const feeData = await localProvider.getFeeData();
        const gasPrice = feeData.gasPrice;
        const gasEstimate = await bridge.wrapPairWithTransfer.estimateGas(
          ...txParams,
          { value: 0n }
        );
        const gasCost = gasEstimate * gasPrice * 2n;
        const amountToSend = balance - gasCost;

        if (amountToSend <= 0n) {
          throw new Error(
            `Insufficient ETH balance: ${ethers.formatEther(balance)} ETH`
          );
        }

        const allTokens = (await bridge.getSupportedTokens()).concat([
          WRAPPED_TOKEN_ADDRESS,
          Y_WRAPPED_TOKEN_ADDRESS,
        ]);
        await printBalances(keyState.currentDerivedKey.signer, allTokens);

        const tx = await bridge.wrapPairWithTransfer(...txParams, {
          nonce,
          value: amountToSend,
          gasLimit: (gasEstimate * 150n) / 100n,
          gasPrice,
        });
        await tx.wait();

        // Update key state
        const keyLogRegistry = new ethers.Contract(
          KEYLOG_REGISTRY_ADDRESS,
          KEYLOG_REGISTRY_ABI,
          keyState.currentDerivedKey.signer
        );
        const updatedLog = await keyLogRegistry.buildFromPublicKey(
          keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
        );
        const updatedKeyState = await getKeyState(
          keyState.currentDerivedKey.key,
          updatedLog,
          kdp + selectedTestAccount
        );
        setUserKeyState((prev) => ({
          ...prev,
          [account]: { log: updatedLog, keyState: updatedKeyState },
        }));

        await printBalances(keyState.currentDerivedKey.signer, allTokens);
        setStatus(
          `Wrapped ${ethers.formatEther(amountToWrap)} $${
            isCrossChain ? "YDA" : "PEPE"
          } with key rotation`
        );
      } catch (error) {
        setStatus("Wrap failed: " + error.message);
        console.error("Wrap error:", error);
      }
      setLoading(false);
    },
    [account, mintAmount]
  );

  // Unwrap tokens with key rotation
  const unwrap = async (isCrossChain = false) => {
    if (!signer || !account || !userKeyState[account]) {
      setStatus("Please connect a wallet and initialize key state");
      return;
    }
    setLoading(true);
    try {
      const { keyState } = userKeyState[account];
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
      const burnAmountWei = ethers.parseEther(burnAmount);
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
      if (wrappedBalance < burnAmountWei) {
        throw new Error(
          `Insufficient balance: ${ethers.formatEther(
            wrappedBalance
          )} available`
        );
      }

      const permit = await generatePermit(
        wrappedTokenAddress,
        keyState.currentDerivedKey.signer,
        burnAmountWei
      );
      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [wrappedTokenAddress, burnAmountWei, mintBurnAddress, bridgeNonce]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedEthSignedMessageHash = ethers.hashMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );
      const unconfirmedSignature =
        await keyState.currentDerivedKey.signer.signMessage(
          ethers.getBytes(unconfirmedEthSignedMessageHash)
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
      const confirmingEthSignedMessageHash = ethers.hashMessage(
        ethers.getBytes(confirmingMessageHash)
      );
      const confirmingSignature =
        await keyState.nextDerivedKey.signer.signMessage(
          ethers.getBytes(confirmingEthSignedMessageHash)
        );

      const permits = [permit];
      const txParams = [
        wrappedTokenAddress,
        {
          amount: burnAmountWei,
          signature: unconfirmedSignature,
          publicKey:
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
          prerotatedKeyHash: keyState.nextDerivedKey.signer.address,
          twicePrerotatedKeyHash: keyState.nextNextDerivedKey.signer.address,
          prevPublicKeyHash: keyState.prevDerivedKey
            ? keyState.prevDerivedKey.signer.address
            : ethers.ZeroAddress,
          targetAddress: mintBurnAddress,
          hasRelationship: true,
          permits,
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

      const balance = await localProvider.getBalance(
        keyState.currentDerivedKey.signer.address
      );
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasEstimate = await bridge.unwrapPairWithTransfer.estimateGas(
        ...txParams,
        { value: 0n }
      );
      const gasCost = gasEstimate * gasPrice * 2n;
      const amountToSend = balance - gasCost;

      if (amountToSend <= 0n) {
        throw new Error(
          `Insufficient balance: ${ethers.formatEther(balance)} ETH`
        );
      }

      const allTokens = (await bridge.getSupportedTokens()).concat([
        WRAPPED_TOKEN_ADDRESS,
        Y_WRAPPED_TOKEN_ADDRESS,
      ]);
      await printBalances(keyState.currentDerivedKey.signer, allTokens);

      const tx = await bridge.unwrapPairWithTransfer(...txParams, {
        nonce,
        value: amountToSend,
        gasLimit: (gasEstimate * 150n) / 100n,
        gasPrice,
      });
      await tx.wait();

      // Update key state
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const updatedLog = await keyLogRegistry.buildFromPublicKey(
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
      );
      const updatedKeyState = await getKeyState(
        keyState.currentDerivedKey.key,
        updatedLog,
        kdp + selectedTestAccount
      );
      setUserKeyState((prev) => ({
        ...prev,
        [account]: { log: updatedLog, keyState: updatedKeyState },
      }));

      await printBalances(keyState.currentDerivedKey.signer, allTokens);
      setStatus(
        `Burned ${ethers.formatEther(burnAmountWei)} $${
          isCrossChain ? "WYDA" : "YPEPE"
        } with key rotation`
      );
    } catch (error) {
      setStatus("Unwrap failed: " + error.message);
      console.error("Unwrap error:", error);
    }
    setLoading(false);
  };

  // Add token pair (operator only)
  const addTokenPair = async () => {
    if (!isOperator) {
      setStatus("Only the bridge operator can add token pairs");
      return;
    }
    setLoading(true);
    try {
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
      const tx = await bridge.addTokenPair(
        originalToken,
        tokenName,
        tokenSymbol,
        isCrossChain
      );
      await tx.wait();
      setStatus("Token pair added successfully");
    } catch (error) {
      setStatus(`Error: ${error.message}`);
      console.error("Add token pair error:", error);
    }
    setLoading(false);
  };

  return (
    <div className="App">
      <h1>Bridge DApp (Hardhat Test)</h1>
      <WalletConnector />
      <p>Connected Account: {account || "Not connected"}</p>
      <p>Status: {status}</p>
      {isOperator && (
        <>
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
            <Button onClick={addTokenPair} disabled={!signer || loading}>
              Create and Add Token Pair
            </Button>
          </Group>
        </>
      )}
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
        <Button onClick={() => wrap(true)} disabled={loading}>
          Mint WYDA
        </Button>
        <TextInput
          label="Burn Amount (in WYDA)"
          value={burnAmount}
          onChange={(e) => setBurnAmount(e.target.value)}
          placeholder="e.g., 100"
          type="number"
        />
        <Button onClick={() => unwrap(true)} disabled={!signer || loading}>
          Burn WYDA
        </Button>
      </Group>
      <Markets />
      <TokenHolders />
    </div>
  );
}

export default Bridge;
