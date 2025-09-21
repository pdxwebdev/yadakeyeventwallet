import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import { useAppContext } from "../context/AppContext";
import {
  createHDWallet,
  fromWIF,
  decompressPublicKey,
} from "../utils/hdWallet";
import {
  HARDHAT_MNEMONIC,
  localProvider,
  addresses,
  deployed,
  DEPLOY_ENV,
  BRIDGE2_ABI,
} from "../shared/constants";
import BridgeArtifact from "../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import { getKeyState } from "../shared/keystate";
import axios from "axios";
import { capture } from "../shared/capture";
import { useMemo } from "react";

const BRIDGE_ABI = BridgeArtifact.abi;
const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
const ERC20_ABI = MockERC20Artifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;

class YadaBSC {
  constructor() {}

  async fetchLog(appContext) {
    const { privateKey, contractAddresses, setLog } = appContext;
    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const keyLogRegistry = new ethers.Contract(
      contractAddresses.keyLogRegistryAddress,
      KEYLOG_REGISTRY_ABI,
      signer
    );
    const publicKey = Buffer.from(
      signer.signingKey.publicKey.slice(2),
      "hex"
    ).slice(1);
    const updatedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
    setLog(updatedLog);
  }

  // Helper to generate EIP-2612 permit
  async generatePermit(
    appContext,
    tokenAddress,
    signer,
    totalAmount,
    recipients // Array of { recipientAddress, amount, wrap, unwrap }
  ) {
    const { contractAddresses, tokenPairs } = appContext;

    if (
      tokenAddress.toLowerCase() ===
      "0x0000000000000000000000000000000000000000"
    ) {
      console.warn(
        `Permits not applicable for BNB (${tokenAddress}). Skipping permit generation.`
      );
      return {
        token: tokenAddress,
        amount: totalAmount,
        recipients: recipients.map((r) => ({
          recipientAddress: r.recipientAddress,
          amount: r.amount,
          wrap: r.wrap || false,
          unwrap: r.unwrap || false,
          mint: r.mint || false,
        })),
        deadline: 0,
        v: 0,
        r: ethers.ZeroHash,
        s: ethers.ZeroHash,
      };
    }

    const tokenPair = tokenPairs.find(
      (pair) => pair.wrapped.toLowerCase() === tokenAddress.toLowerCase()
    );
    const isWrapped = !!tokenPair;
    const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
    const token = new ethers.Contract(tokenAddress, abi, signer);

    try {
      let name = "Unknown Token";
      try {
        name = await token.name();
      } catch (error) {
        console.warn(
          `Failed to fetch name for token ${tokenAddress}: ${error.message}. Using default name: ${name}`
        );
        notifications.show({
          title: "Warning",
          message: `Token name not available for ${tokenAddress}. Using default name: ${name}.`,
          color: "yellow",
        });
      }

      let nonce;
      try {
        if (typeof token.nonces === "function") {
          nonce = await token.nonces(signer.address);
        } else {
          console.warn(
            `Token ${tokenAddress} does not support EIP-2612 (nonces function missing). Skipping permit generation.`
          );
          return null;
        }
      } catch (error) {
        console.warn(
          `Error checking nonces for ${tokenAddress}: ${error.message}. Skipping permit generation.`
        );
        return null;
      }

      const domain = {
        name,
        version: "1",
        chainId: (await localProvider.getNetwork()).chainId,
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
      const spender = contractAddresses.bridgeAddress;
      const permitDeadline = Math.floor(Date.now() / 1000) + 60 * 60;
      const message = {
        owner,
        spender,
        value: totalAmount.toString(),
        nonce: nonce.toString(),
        deadline: permitDeadline,
      };
      const signature = await signer.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);
      return {
        token: tokenAddress,
        amount: totalAmount,
        recipients: recipients.map((r) => ({
          recipientAddress: r.recipientAddress,
          amount: r.amount,
          wrap: r.wrap || false,
          unwrap: r.unwrap || false,
          mint: r.mint || false,
        })),
        deadline: permitDeadline,
        v,
        r,
        s,
      };
    } catch (error) {
      console.warn(`Permit not supported for ${tokenAddress}:`, error);
      notifications.show({
        title: "Warning",
        message: `Permit not supported for token ${tokenAddress}.`,
        color: "yellow",
      });
      return null;
    }
  }

  async generatePermitsForTokens(
    appContext,
    signer,
    tokens,
    defaultRecipient,
    excludeTokens = [],
    amountAdjustments = new Map()
  ) {
    const { tokenPairs } = appContext;

    // Filter out excluded tokens
    const filteredTokens = tokens.filter(
      ({ address }) => !excludeTokens.includes(address.toLowerCase())
    );

    // Generate permits for all tokens
    const permits = await Promise.all(
      filteredTokens.map(async ({ address: tokenAddress }) => {
        if (
          tokenAddress.toLowerCase() ===
          "0x0000000000000000000000000000000000000000"
        ) {
          // Skip BNB
          return null;
        }
        try {
          // Determine if the token is wrapped using tokenPairs
          const isWrapped = tokenPairs.some(
            (pair) => pair.wrapped.toLowerCase() === tokenAddress.toLowerCase()
          );
          const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
          const tokenContract = new ethers.Contract(tokenAddress, abi, signer);
          const balance = await tokenContract.balanceOf(signer.address);
          const adjustment =
            amountAdjustments.get(tokenAddress.toLowerCase()) || BigInt(0);
          const adjustedAmount =
            balance > adjustment ? balance - adjustment : BigInt(0);
          if (adjustedAmount > 0n) {
            const permit = await this.generatePermit(
              appContext,
              tokenAddress,
              signer,
              adjustedAmount,
              [
                {
                  recipientAddress: defaultRecipient,
                  amount: adjustedAmount,
                  wrap: false,
                  unwrap: false,
                  mint: false,
                },
              ]
            );
            if (permit) {
              return permit;
            } else {
              console.warn(`Permit not supported for token ${tokenAddress}`);
            }
          }
          return null;
        } catch (error) {
          console.warn(
            `Error generating permit for token ${tokenAddress}:`,
            error
          );
          return null;
        }
      })
    );

    return permits.filter((permit) => permit !== null);
  }

  // Builds transaction history from KeyLogRegistry and token transfer events
  async buildTransactionHistory(appContext) {
    const {
      privateKey,
      log,
      setLoading,
      setTransactions,
      setCombinedHistory,
      setCurrentPage,
      selectedToken,
      contractAddresses,
    } = appContext;

    if (!privateKey || !selectedToken) {
      return;
    }

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );

    try {
      setLoading(true);
      setCombinedHistory([]); // Clear previous history
      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );

      // Fetch key log entries
      const currentPublicKey = decompressPublicKey(
        Buffer.from(privateKey.publicKey)
      ).slice(1);

      // Validate log structure
      if (!Array.isArray(log)) {
        console.warn("Log is not an array:", log);
        log = [];
      }

      if (log.length === 0) {
        console.log(
          "No key log entries found for public key:",
          currentPublicKey
        );
      }

      const currentAddress = await signer.getAddress();
      const currentRotation = log.length;

      // Get block numbers and timestamps for each rotation
      const rotationBlocks = await Promise.all(
        log.length > 0
          ? log.map(async (entry, index) => {
              if (!entry || !entry.publicKeyHash) {
                console.warn(`Invalid log entry at index ${index}:`, entry);
                return {
                  rotation: index,
                  publicKeyHash: "0x0",
                  blockNumber: 0,
                  timestamp: null,
                };
              }
              let blockNumber = 0;
              let timestamp = null;
              try {
                const filter = keyLogRegistry.filters.KeyLogRegistered(
                  entry.publicKeyHash
                );
                const events = await keyLogRegistry.queryFilter(
                  filter,
                  0,
                  "latest"
                );
                const event = events.find(
                  (e) => e.args.publicKeyHash === entry.publicKeyHash
                );
                if (event) {
                  const block = await localProvider.getBlock(event.blockNumber);
                  blockNumber = block.number;
                  timestamp = block.timestamp;
                } else {
                  console.warn(
                    `No KeyLogRegistered event found for ${entry.publicKeyHash}`
                  );
                }
              } catch (error) {
                // console.warn(
                //   `Error fetching block for ${entry.publicKeyHash}:`,
                //   error
                // );
              }
              return {
                rotation: index,
                publicKeyHash: entry.publicKeyHash,
                blockNumber,
                timestamp,
              };
            })
          : []
      );

      // Fetch transactions for each rotation
      const keyLogWithTransactions = await Promise.all(
        rotationBlocks.map(
          async (
            { rotation, publicKeyHash, blockNumber, timestamp },
            index
          ) => {
            const nextBlockNumber =
              index < rotationBlocks.length - 1
                ? rotationBlocks[index + 1].blockNumber
                : "latest";
            const { transactions, totalReceived, totalSent } =
              await this.fetchTransactionsForKey(
                publicKeyHash,
                rotation,
                blockNumber || 0,
                nextBlockNumber,
                selectedToken
              );

            const keyEventTransaction = {
              id: `key-event-${publicKeyHash}-${rotation}`,
              outputs: [{ to: publicKeyHash, value: "0" }],
              date: timestamp
                ? new Date(timestamp * 1000).toLocaleDateString()
                : "N/A",
              status: "Confirmed",
              type: `Key Event (${rotation === 0 ? "Inception" : "Rotation"})`,
              address: publicKeyHash,
              public_key: publicKeyHash,
              rotation,
            };

            return {
              publicKeyHash, // Minimal structure since entry may be invalid
              transactions: [keyEventTransaction, ...transactions],
              totalReceived: ethers.formatEther(totalReceived),
              totalSent: ethers.formatEther(totalSent),
              type: "Key Event",
              rotation,
            };
          }
        )
      );

      // Fetch transactions for the current key
      const currentKeyPending = await this.fetchTransactionsForKey(
        currentAddress,
        currentRotation,
        rotationBlocks.length > 0
          ? rotationBlocks[rotationBlocks.length - 1].blockNumber
          : 0,
        "latest",
        selectedToken
      );

      setTransactions(keyLogWithTransactions);

      // Combine key events and transactions
      const combined = [
        ...keyLogWithTransactions.flatMap((entry) =>
          entry.transactions.map((txn) => ({
            ...txn,
            rotation: entry.rotation,
            public_key_hash: entry.publicKeyHash,
          }))
        ),
        ...currentKeyPending.transactions.map((txn) => ({
          ...txn,
          rotation: currentRotation,
          public_key_hash: currentAddress,
        })),
      ];

      // Sort by rotation and date
      combined.sort((a, b) => {
        if (a.rotation !== b.rotation) return a.rotation - b.rotation;
        if (a.type.includes("Key Event") && !b.type.includes("Key Event"))
          return -1;
        if (!b.type.includes("Key Event") && a.type.includes("Key Event"))
          return 1;
        const dateA = a.date === "N/A" ? new Date(0) : new Date(a.date);
        const dateB = b.date === "N/A" ? new Date(0) : new Date(b.date);
        return dateB - dateA;
      });

      console.log("Combined transaction history:", combined); // Debug log
      setCombinedHistory(combined);
      setCurrentPage(1);
    } catch (error) {
      console.error("Error building transaction history:", error);
      notifications.show({
        title: "Error",
        message: "Failed to load wallet history",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }

  async fetchTransactionsForKey(
    appContext,
    publicKeyHash,
    rotation,
    fromBlock,
    toBlock,
    selectedToken
  ) {
    try {
      const { privateKey, supportedTokens, contractAddresses } = appContext;
      if (!privateKey) {
        return {
          transactions: [],
          totalReceived: BigInt(0),
          totalSent: BigInt(0),
        };
      }
      const signer = new ethers.Wallet(
        ethers.hexlify(privateKey.privateKey),
        localProvider
      );
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );
      let transactionsForKey = [];
      let totalReceivedForKey = BigInt(0);
      let totalSentForKey = BigInt(0);

      const toBlockNumber =
        toBlock === "latest" ? await localProvider.getBlockNumber() : toBlock;

      if (selectedToken === ethers.ZeroAddress) {
        // Fetch native ETH (BNB equivalent in Hardhat) transactions
        const filter = {
          fromBlock: fromBlock,
          toBlock: toBlockNumber,
          address: null, // No specific contract for native ETH
          topics: [],
        };

        // Get all blocks in the range and check transactions
        const blocks = [];
        for (let i = fromBlock; i <= toBlockNumber; i++) {
          try {
            const block = await localProvider.getBlock(i, true); // Include transactions
            if (block && block.transactions.length > 0) {
              blocks.push(block);
            }
          } catch (error) {
            console.warn(`Error fetching block ${i}:`, error);
          }
        }

        const token = supportedTokens.find(
          (item) => item.address === selectedToken
        );

        for (const block of blocks) {
          for (const txHash of block.transactions) {
            try {
              const tx = await localProvider.getTransaction(txHash);
              if (!tx) continue;

              const receipt = await tx.wait();
              if (receipt.status !== 1) continue; // Skip failed transactions

              const isReceived =
                tx.to && tx.to.toLowerCase() === publicKeyHash.toLowerCase();
              const isSent =
                tx.from.toLowerCase() === publicKeyHash.toLowerCase();

              if (isReceived || isSent) {
                const value = tx.value;
                if (isReceived) {
                  totalReceivedForKey += value;
                } else if (isSent) {
                  totalSentForKey += value;
                }
                transactionsForKey.push({
                  id: tx.hash,
                  outputs: [
                    {
                      to: isReceived ? publicKeyHash : tx.to,
                      value: ethers.formatEther(value),
                    },
                  ],
                  date: new Date(block.timestamp * 1000).toLocaleDateString(),
                  status: "Confirmed",
                  type: (isReceived ? "Received " : "Sent ") + token.symbol,
                  address: publicKeyHash,
                  public_key: publicKeyHash,
                  rotation,
                });
              }
            } catch (error) {
              console.warn(`Error processing transaction ${txHash}:`, error);
            }
          }
        }
      } else {
        // Fetch ERC20 token transactions
        const tokenContract = new ethers.Contract(
          selectedToken,
          ERC20_ABI,
          signer
        );
        const wrappedToken = await bridge.originalToWrapped(selectedToken);
        const isWrapped = wrappedToken !== ethers.ZeroAddress;
        const contract = isWrapped
          ? new ethers.Contract(wrappedToken, WRAPPED_TOKEN_ABI, signer)
          : tokenContract;

        const receivedFilter = contract.filters.Transfer(null, publicKeyHash);
        const sentFilter = contract.filters.Transfer(publicKeyHash, null);
        const [receivedEvents, sentEvents] = await Promise.all([
          contract.queryFilter(receivedFilter, fromBlock, toBlockNumber),
          contract.queryFilter(sentFilter, fromBlock, toBlockNumber),
        ]);

        const receivedTxns = await Promise.all(
          receivedEvents.map(async (event) => {
            try {
              const block = await localProvider.getBlock(event.blockNumber);
              const value = event.args.value;
              totalReceivedForKey += value;
              return {
                id: event.transactionHash,
                outputs: [
                  { to: publicKeyHash, value: ethers.formatEther(value) },
                ],
                date: new Date(block.timestamp * 1000).toLocaleDateString(),
                status: "Confirmed",
                type: `Received ${isWrapped ? "Wrapped Token" : "Token"}`,
                address: publicKeyHash,
                public_key: publicKeyHash,
                rotation,
              };
            } catch (error) {
              console.warn(
                `Error processing received event ${event.transactionHash}:`,
                error
              );
              return null;
            }
          })
        );

        const sentTxns = await Promise.all(
          sentEvents.map(async (event) => {
            try {
              const block = await localProvider.getBlock(event.blockNumber);
              const value = event.args.value;
              totalSentForKey += value;
              return {
                id: event.transactionHash,
                outputs: [
                  { to: event.args.to, value: ethers.formatEther(value) },
                ],
                date: new Date(block.timestamp * 1000).toLocaleDateString(),
                status: "Confirmed",
                type: `Sent ${isWrapped ? "Wrapped Token" : "Token"}`,
                address: publicKeyHash,
                public_key: publicKeyHash,
                rotation,
              };
            } catch (error) {
              console.warn(
                `Error processing sent event ${event.transactionHash}:`,
                error
              );
              return null;
            }
          })
        );

        transactionsForKey.push(
          ...receivedTxns.filter((tx) => tx !== null),
          ...sentTxns.filter((tx) => tx !== null)
        );
      }

      return {
        transactions: transactionsForKey,
        totalReceived: totalReceivedForKey,
        totalSent: totalSentForKey,
      };
    } catch (error) {
      console.error(
        `Error fetching transactions for key ${publicKeyHash}:`,
        error
      );
      notifications.show({
        title: "Error",
        message: `Failed to load transactions for key ${publicKeyHash.slice(
          0,
          8
        )}...`,
        color: "red",
      });
      return {
        transactions: [],
        totalReceived: BigInt(0),
        totalSent: BigInt(0),
      };
    }
  }

  // Checks wallet initialization status
  async checkInitializationStatus(appContext) {
    const { privateKey, setLog, parsedData, contractAddresses } = appContext;

    if (!privateKey || !contractAddresses.keyLogRegistryAddress) {
      return { status: "no_signer" };
    }

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );

    try {
      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const address = await signer.getAddress();
      const publicKey = Buffer.from(
        signer.signingKey.publicKey.slice(2),
        "hex"
      ).slice(1);
      const fetchedLog = await keyLogRegistry.buildFromPublicKey(publicKey);

      // Debug: Log raw fetchedLog
      console.log(
        "Raw fetchedLog:",
        JSON.stringify(
          fetchedLog,
          (key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          2
        )
      );

      // Filter out duplicates and invalid entries
      const uniqueLog = [];
      const seenKeys = new Set();
      for (const entry of fetchedLog) {
        if (
          entry &&
          entry.publicKeyHash &&
          entry.publicKeyHash !== ethers.ZeroAddress &&
          !seenKeys.has(entry.publicKeyHash)
        ) {
          uniqueLog.push({
            twicePrerotatedKeyHash: entry.twicePrerotatedKeyHash,
            prerotatedKeyHash: entry.prerotatedKeyHash,
            publicKeyHash: entry.publicKeyHash,
            prevPublicKeyHash: entry.prevPublicKeyHash,
            outputAddress: entry.outputAddress,
            hasRelationship: entry.hasRelationship,
            isOnChain: entry.isOnChain,
            flag: Number(entry.flag), // Convert enum to number for clarity
          });
          seenKeys.add(entry.publicKeyHash);
        }
      }

      // Sort by rotation (using index as a proxy since flag may not be reliable)
      uniqueLog.sort((a, b) => {
        const rotationA =
          a.prevPublicKeyHash === ethers.ZeroAddress
            ? 0
            : uniqueLog.indexOf(a) + 1;
        const rotationB =
          b.prevPublicKeyHash === ethers.ZeroAddress
            ? 0
            : uniqueLog.indexOf(b) + 1;
        return rotationA - rotationB;
      });

      // Debug: Log filtered log and check for duplicates
      console.log(
        "Filtered uniqueLog:",
        JSON.stringify(
          uniqueLog,
          (key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          2
        )
      );
      if (uniqueLog.length > 0) {
        for (let i = 0; i < uniqueLog.length - 1; i++) {
          for (let j = i + 1; j < uniqueLog.length; j++) {
            if (uniqueLog[i].publicKeyHash === uniqueLog[j].publicKeyHash) {
              console.warn(
                `Duplicate publicKeyHash detected: ${uniqueLog[i].publicKeyHash} at indices ${i} and ${j}`
              );
            }
          }
        }
      }

      if (uniqueLog.length === 0) {
        return { status: "no_transaction" };
      }
      setLog(uniqueLog);

      const latestEntry = uniqueLog[uniqueLog.length - 1];
      if (latestEntry.publicKeyHash === address) {
        return { status: "active" };
      }

      const isKeyInLog = uniqueLog.some(
        (entry) => entry.isOnChain && entry.publicKeyHash === address
      );
      if (isKeyInLog) {
        const logEntry = uniqueLog.find(
          (entry) => !entry.mempool && entry.publicKeyHash === address
        );
        return { status: "revoked" };
      }

      const lastLogEntry = uniqueLog[uniqueLog.length - 1];
      if (parsedData.prerotatedKeyHash === lastLogEntry.prerotatedKeyHash) {
        if (uniqueLog.length > 0) {
          const isValidContinuity =
            lastLogEntry.publicKeyHash === parsedData.prevPublicKeyHash &&
            lastLogEntry.prerotatedKeyHash === address &&
            lastLogEntry.twicePrerotatedKeyHash ===
              parsedData.prerotatedKeyHash;

          if (!isValidContinuity) {
            return { status: "invalid_continuity" };
          }
        } else if (parsedData.prevPublicKeyHash && parsedData.rotation !== 0) {
          return { status: "invalid_continuity" };
        } else {
          return { status: "no_transaction" };
        }
      }

      return { status: "active" };
    } catch (error) {
      console.error("Error checking key event log:", error);
      notifications.show({
        title: "Error",
        message: "Failed to check wallet status",
        color: "red",
      });
      return { status: "error" };
    }
  }

  // Checks and initializes wallet status
  async checkStatus(appContext) {
    const { setIsInitialized, log } = appContext;

    const initStatus = await this.checkInitializationStatus(appContext);
    if (initStatus.status === "active") {
      setIsInitialized(true);
      localStorage.setItem("walletIsInitialized", "true");
    } else if (initStatus.status === "revoked") {
      setIsInitialized(true);
      localStorage.setItem("walletIsInitialized", "true");
      notifications.show({
        title: "Key Revoked",
        message: `Key at rotation ${log.length} is revoked. Please scan or use the next key.`,
        color: "yellow",
      });
    } else if (initStatus.status === "no_transaction") {
      notifications.show({
        title: "No Key Event Log Entry",
        message: "Submitting wallet initialization transaction.",
        color: "yellow",
      });
    } else if (
      initStatus.status === "invalid_continuity" ||
      initStatus.status === "invalid_rotation"
    ) {
      notifications.show({
        title:
          initStatus.status === "invalid_rotation"
            ? "Invalid Key Rotation"
            : "Invalid Key Continuity",
        message:
          initStatus.status === "invalid_rotation"
            ? `Expected key rotation ${log.length}, but current key is rotation ${log.length}. Please use the correct key.`
            : "The key does not maintain continuity with the key event log. Please use a valid key.",
        color: "red",
      });
    } else if (initStatus.status === "error") {
      notifications.show({
        title: "Error",
        message:
          "An error occurred while checking wallet status. Please try again.",
        color: "red",
      });
    }
  }

  async fetchFeeEstimate(appContext) {
    const { setFeeEstimate, parsedData, contractAddresses, privateKey, log } =
      appContext;
    if (log.length <= 0) return;
    const lastLogEntry = log[log.length - 1];
    if (lastLogEntry.publicKeyHash !== parsedData.prevPublicKeyHash) return;
    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    if (!signer) {
      notifications.show({
        title: "Error",
        message: "No signer available for fee estimation",
        color: "red",
      });
      return;
    }

    try {
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );

      // Estimate gas for a sample transaction (using registerKeyWithTransfer as reference)
      const publicKey = Buffer.from(
        signer.signingKey.publicKey.slice(2),
        "hex"
      ).slice(1);
      const publicKeyHash = await signer.getAddress();
      const prerotatedKeyHash = parsedData.prerotatedKeyHash; // Placeholder for estimation
      const twicePrerotatedKeyHash = parsedData.twicePrerotatedKeyHash;
      const prevPublicKeyHash = parsedData.prevPublicKeyHash;
      const outputAddress = parsedData.prerotatedKeyHash;
      const hasRelationship = false;
      const permits = [];

      // Get gas estimate for a typical transaction
      const gasEstimate = await bridge.registerKeyWithTransfer.estimateGas(
        publicKey,
        publicKeyHash,
        prerotatedKeyHash,
        twicePrerotatedKeyHash,
        prevPublicKeyHash,
        outputAddress,
        hasRelationship,
        permits,
        { value: 0 }
      );

      // Get current gas price
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;

      // Calculate estimated fee (with 50% buffer for safety)
      const estimatedFee = (gasEstimate * gasPrice * 150n) / 100n;

      // Format fee in ETH/BNB
      const formattedFee = {
        estimatedFee: ethers.formatEther(estimatedFee),
        gasPrice: ethers.formatUnits(gasPrice, "gwei"),
        gasLimit: gasEstimate.toString(),
      };

      setFeeEstimate(formattedFee);

      notifications.show({
        title: "Success",
        message: "Fee estimate updated",
        color: "green",
      });
    } catch (error) {
      console.error("Error fetching fee estimate:", error);
      notifications.show({
        title: "Error",
        message: "Failed to estimate transaction fee",
        color: "red",
      });
      setFeeEstimate(null);
    }
  }

  // Fetches token balances
  async fetchBalance(appContext) {
    const {
      privateKey,
      selectedToken,
      setLoading,
      setBalance,
      setSymbol,
      supportedTokens,
      contractAddresses,
      log,
      parsedData,
    } = appContext;

    if (!privateKey || !selectedToken) return;

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    try {
      setLoading(true);
      const address = await signer.getAddress();
      let originalBalance = BigInt(0);
      let wrappedBalance = BigInt(0);

      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );
      let wrappedToken;
      try {
        wrappedToken = await bridge.originalToWrapped(selectedToken);
      } catch (err) {
        wrappedToken = ethers.ZeroAddress;
      }
      const hasWrapped = wrappedToken !== ethers.ZeroAddress;

      if (selectedToken === ethers.ZeroAddress) {
        setSymbol("bnb");
        originalBalance = await localProvider.getBalance(address);
        if (hasWrapped) {
          const wrappedContract = new ethers.Contract(
            wrappedToken,
            WRAPPED_TOKEN_ABI,
            signer
          );
          wrappedBalance = await wrappedContract.balanceOf(address);
        }
      } else {
        const token = supportedTokens.find(
          (item) => item.address === selectedToken
        );
        setSymbol(token.symbol);

        const tokenContract = new ethers.Contract(
          selectedToken,
          ERC20_ABI,
          signer
        );
        originalBalance = await tokenContract.balanceOf(address);
        if (hasWrapped) {
          const wrappedContract = new ethers.Contract(
            wrappedToken,
            WRAPPED_TOKEN_ABI,
            signer
          );
          wrappedBalance = await wrappedContract.balanceOf(address);
        }
      }

      setBalance({
        original: ethers.formatEther(originalBalance),
        wrapped: ethers.formatEther(wrappedBalance),
      });
      notifications.show({
        title: "Success",
        message: `Balance refreshed for ${
          selectedToken === ethers.ZeroAddress ? "BNB" : "selected token"
        }`,
        color: "green",
      });
    } catch (error) {
      console.error("Error fetching balance:", error);
      notifications.show({
        title: "Error",
        message: "Failed to load wallet balance",
        color: "red",
      });
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }

  // Initializes key event log
  async initializeKeyEventLog(appContext) {
    const {
      privateKey,
      setLoading,
      parsedData,
      contractAddresses,
      tokenPairs,
      setIsInitialized,
      setIsSubmitting,
      setLog,
    } = appContext;
    if (!privateKey) return;

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    if (!signer) return;

    try {
      setLoading(true);
      setIsSubmitting(true);
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );
      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );

      const publicKey = Buffer.from(
        signer.signingKey.publicKey.slice(2),
        "hex"
      ).slice(1);
      const publicKeyHash = await signer.getAddress();
      const prerotatedKeyHash = parsedData.prerotatedKeyHash;
      const twicePrerotatedKeyHash = parsedData.twicePrerotatedKeyHash;
      const prevPublicKeyHash = parsedData.prevPublicKeyHash;
      const outputAddress = prerotatedKeyHash;
      const hasRelationship = false;

      const tokenPairs = await this.fetchTokenPairs(appContext);
      const supportedTokens = tokenPairs.map((pair) => ({
        address: pair.original,
        symbol: pair.symbol,
        name: pair.name,
        decimals: 18,
      }));

      // Fetch supported tokens
      const allTokens = [
        ...supportedTokens.map((token) => ({ address: token.address })),
        ...tokenPairs
          .filter((pair) => pair.wrapped !== ethers.ZeroAddress)
          .map((pair) => ({ address: pair.wrapped })),
      ];

      // Generate permits for all tokens
      const permits = await this.generatePermitsForTokens(
        appContext,
        signer,
        allTokens,
        outputAddress,
        ["0x0000000000000000000000000000000000000000"]
      );

      // Estimate gas and calculate BNB amount to send
      const balance = await localProvider.getBalance(signer.address);
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      console.log("Calling registerKeyWithTransfer with permits:", permits);
      const gasEstimate = await bridge.registerKeyWithTransfer.estimateGas(
        publicKey,
        publicKeyHash,
        prerotatedKeyHash,
        twicePrerotatedKeyHash,
        prevPublicKeyHash,
        outputAddress,
        hasRelationship,
        permits,
        { value: 0 }
      );
      const gasCost = gasEstimate * gasPrice * 2n;

      const amountToSend = balance - gasCost;

      if (amountToSend <= 0n) {
        setIsInitialized(true);
        throw new Error(
          `Insufficient BNB balance: ${ethers.formatEther(balance)} BNB`
        );
      }

      // Execute transaction
      const tx = await bridge.registerKeyWithTransfer(
        publicKey,
        publicKeyHash,
        prerotatedKeyHash,
        twicePrerotatedKeyHash,
        prevPublicKeyHash,
        outputAddress,
        hasRelationship,
        permits,
        {
          value: amountToSend,
          gasLimit: (gasEstimate * 150n) / 100n,
          gasCost,
        }
      );
      await tx.wait();

      const updatedLog = await keyLogRegistry.buildFromPublicKey(
        decompressPublicKey(Buffer.from(privateKey.publicKey)).slice(1)
      );
      setLog(updatedLog);

      notifications.show({
        title: "Success",
        message: "Key event log initialized and token balances transferred",
        color: "green",
      });
    } catch (error) {
      console.error("Error initializing key event log:", error);
      notifications.show({
        title: "Error",
        message: `Failed to initialize wallet: ${error.message}`,
        color: "red",
      });
    } finally {
      setLoading(false);
      setIsSubmitting(false);
    }
  }

  async signTransaction(appContext, webcamRef) {
    const {
      privateKey,
      recipients,
      parsedData,
      setIsTransactionFlow,
      setIsScannerOpen,
      setParsedData,
      setRecipients,
      setLoading,
      selectedToken,
      supportedTokens,
      log,
      setLog,
      contractAddresses,
      tokenPairs,
      sendWrapped,
    } = appContext;

    if (!ethers) {
      throw new Error(
        "ethers is not defined. Ensure ethers@6.13.5 is imported correctly in YadaBSC.js"
      );
    }

    if (!privateKey || recipients.length === 0) {
      throw new Error(
        "Please connect wallet and provide at least one recipient"
      );
    }

    const token = tokenPairs.find(
      (item) => item.original.toLowerCase() === selectedToken.toLowerCase()
    );

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const address = await signer.getAddress();
    if (!token) {
      throw new Error("Selected token not supported");
    }
    const tokenAddress = sendWrapped ? token.wrapped : token.original;
    const tokenDecimals = token.decimals || 18;
    const isBNB =
      tokenAddress.toLowerCase() ===
      "0x0000000000000000000000000000000000000000";

    try {
      notifications.show({
        title: "Key Rotation Required",
        message: `Please scan the QR code for the next key (rotation ${
          log.length + 1
        }) to proceed.`,
        color: "yellow",
      });
      setIsTransactionFlow(true);
      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      const maxAttempts = 100;
      while (attempts < maxAttempts) {
        try {
          qrData = await capture(webcamRef);
          break;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!qrData) {
        throw new Error("No QR code scanned within time limit");
      }

      setIsScannerOpen(false);
      setLoading(true);
      const { newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        qrData,
        true
      );
      if (
        !ethers.isAddress(newParsedData.prerotatedKeyHash) ||
        newParsedData.prerotatedKeyHash === ethers.ZeroAddress
      ) {
        throw new Error(
          `Invalid confirming outputAddress: ${newParsedData.prerotatedKeyHash}`
        );
      }

      const newSigner = new ethers.Wallet(
        ethers.hexlify(newPrivateKey.privateKey),
        localProvider
      );
      const newAddress = await newSigner.getAddress();
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );

      // Validate recipients
      recipients.forEach((r) => {
        if (!ethers.isAddress(r.address) || r.address === ethers.ZeroAddress) {
          throw new Error(`Invalid recipient address: ${r.address}`);
        }
        if (isNaN(parseFloat(r.amount)) || parseFloat(r.amount) <= 0) {
          throw new Error(`Invalid recipient amount: ${r.amount}`);
        }
      });

      // Calculate total recipient value
      const totalRecipientValue = recipients.reduce((sum, r) => {
        return sum + ethers.parseUnits(r.amount, tokenDecimals);
      }, BigInt(0));

      // Check balances
      let remainingTokenBalance = BigInt(0);
      if (!isBNB) {
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ERC20_ABI,
          signer
        );
        const balance = await tokenContract.balanceOf(signer.address);
        if (balance < totalRecipientValue) {
          throw new Error(
            `Insufficient balance for ${token.symbol}: ${ethers.formatUnits(
              balance,
              tokenDecimals
            )} available, need ${ethers.formatUnits(
              totalRecipientValue,
              tokenDecimals
            )}`
          );
        }
        remainingTokenBalance = balance - totalRecipientValue;
      }

      const bnbBalance = await localProvider.getBalance(signer.address);
      let totalBNBToRecipients = BigInt(0);
      if (isBNB) {
        totalBNBToRecipients = totalRecipientValue;
        if (bnbBalance < totalBNBToRecipients) {
          throw new Error(
            `Insufficient BNB balance: ${ethers.formatEther(
              bnbBalance
            )} available, need ${ethers.formatEther(totalBNBToRecipients)}`
          );
        }
      }

      // Fetch supported tokens
      const supportedTokensAddresses = await bridge.getSupportedTokens();
      const allTokens = [
        ...supportedTokensAddresses.map((address) => ({ address })),
        ...tokenPairs
          .filter((pair) => pair.wrapped !== ethers.ZeroAddress)
          .map((pair) => ({ address: pair.wrapped })),
      ];

      // Generate permits
      const recipientTokenAmounts = new Map();
      if (!isBNB) {
        recipientTokenAmounts.set(
          tokenAddress.toLowerCase(),
          totalRecipientValue
        );
      }

      const permits = await this.generatePermitsForTokens(
        appContext,
        signer,
        allTokens,
        newParsedData.prerotatedKeyHash,
        [tokenAddress.toLowerCase()],
        recipientTokenAmounts
      );

      let recipientPermits = [
        {
          token: ethers.ZeroAddress,
          amount: bnbBalance,
          deadline: 0,
          v: 0,
          r: ethers.ZeroHash,
          s: ethers.ZeroHash,
          recipients: [],
        },
      ];
      if (isBNB) {
        recipientPermits[0].recipients = recipients.map((r) => ({
          recipientAddress: r.address,
          amount: ethers.parseUnits(r.amount, tokenDecimals),
          wrap: false,
          unwrap: false,
          mint: false,
        }));
      } else {
        const recipientPermit = await this.generatePermit(
          appContext,
          tokenAddress,
          signer,
          totalRecipientValue + remainingTokenBalance,
          [
            ...recipients.map((r) => ({
              recipientAddress: r.address,
              amount: ethers.parseUnits(r.amount, tokenDecimals),
              wrap: false,
              unwrap: false,
              mint: false,
            })),
            ...(remainingTokenBalance > 0
              ? [
                  {
                    recipientAddress: newParsedData.prerotatedKeyHash,
                    amount: remainingTokenBalance,
                    wrap: false,
                    unwrap: false,
                    mint: false,
                  },
                ]
              : []),
          ]
        );
        if (recipientPermit) {
          recipientPermits.push(recipientPermit);
        }
      }

      const validPermits = [...permits, ...recipientPermits].filter(
        (p) =>
          p !== null &&
          (p.token === ethers.ZeroAddress || ethers.isAddress(p.token))
      );

      // Generate signatures (aligned with wrap/unwrap)
      const nonce = await localProvider.getTransactionCount(address, "pending");
      const bridgeNonce = await bridge.nonces(address);
      const unconfirmedMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [
          tokenAddress,
          totalRecipientValue,
          newParsedData.prerotatedKeyHash,
          bridgeNonce,
        ]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const confirmingMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [tokenAddress, 0, newParsedData.prerotatedKeyHash, bridgeNonce + 1n]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await newSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      const currentPublicKey = decompressPublicKey(
        Buffer.from(privateKey.publicKey)
      ).slice(1);
      const nextPublicKey = decompressPublicKey(
        Buffer.from(newPrivateKey.publicKey)
      ).slice(1);

      // Verify signatures
      const computedConfirmingAddress = ethers.computeAddress(
        `0x04${Buffer.from(nextPublicKey).toString("hex")}`
      );
      if (
        computedConfirmingAddress.toLowerCase() !== newAddress.toLowerCase()
      ) {
        throw new Error(
          `Public key mismatch: computed ${computedConfirmingAddress}, expected ${newAddress}`
        );
      }
      const confirmingRecovered = ethers.verifyMessage(
        ethers.getBytes(confirmingMessageHash),
        confirmingSignature
      );
      if (confirmingRecovered.toLowerCase() !== newAddress.toLowerCase()) {
        throw new Error(
          `Signature mismatch: recovered ${confirmingRecovered}, expected ${newAddress}`
        );
      }

      // Define txParams
      const txParams = [
        tokenAddress,
        {
          amount: totalRecipientValue,
          signature: unconfirmedSignature,
          publicKey: Buffer.from(currentPublicKey),
          prerotatedKeyHash: parsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: parsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: false,
          tokenSource: address,
          permits: validPermits,
        },
        {
          amount: BigInt(0),
          signature: confirmingSignature,
          publicKey: Buffer.from(nextPublicKey),
          prerotatedKeyHash: newParsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: newParsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: false,
          tokenSource: newAddress,
          permits: [],
        },
      ];

      // Calculate gas and value
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      let gasEstimate;
      try {
        gasEstimate = await bridge.registerKeyPairWithTransfer.estimateGas(
          ...txParams,
          {
            value: bnbBalance,
          }
        );
      } catch (error) {
        console.error("Gas estimation error:", error.reason || error.message);
        throw new Error(
          `Gas estimation failed: ${error.reason || error.message}`
        );
      }
      const gasCost = (gasEstimate * gasPrice * 150n) / 100n;
      const remainingBNBBalance =
        bnbBalance >= totalBNBToRecipients + gasCost
          ? bnbBalance - totalBNBToRecipients - gasCost
          : BigInt(0);
      txParams[1].permits
        .find((item) => item.token === ethers.ZeroAddress)
        .recipients.push({
          recipientAddress: newParsedData.prerotatedKeyHash,
          amount: remainingBNBBalance - gasCost,
          wrap: false,
          unwrap: false,
          mint: false,
        });
      if (bnbBalance < totalBNBToRecipients + gasCost) {
        throw new Error(
          `Insufficient BNB: balance=${ethers.formatEther(
            bnbBalance
          )}, required=${ethers.formatEther(totalBNBToRecipients + gasCost)}`
        );
      }

      // Log for debugging
      console.log({
        txParams: JSON.stringify(
          txParams,
          (key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          2
        ),
        permits: JSON.stringify(
          validPermits,
          (key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          2
        ),
        bnbBalance: ethers.formatEther(bnbBalance),
        totalBNBToRecipients: ethers.formatEther(totalBNBToRecipients),
        gasCost: ethers.formatEther(gasCost),
        remainingBNBBalance: ethers.formatEther(remainingBNBBalance),
        bridgeNonce: bridgeNonce.toString(),
        transactionNonce: nonce.toString(),
        confirmingOutputAddress: newParsedData.prerotatedKeyHash,
      });

      const gasLimit = (gasEstimate * 150n) / 100n;
      const tx = await bridge.registerKeyPairWithTransfer(...txParams, {
        nonce,
        value: bnbBalance - gasCost,
        gasLimit,
        gasPrice,
      });
      const receipt = await tx.wait();

      // Log transaction receipt
      console.log({
        transactionHash: receipt.transactionHash,
        status: receipt.status,
        to: receipt.to,
        from: receipt.from,
        gasUsed: receipt.gasUsed.toString(),
      });

      // Update key log
      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        newSigner
      );
      const updatedLog = await keyLogRegistry.buildFromPublicKey(
        decompressPublicKey(Buffer.from(newPrivateKey.publicKey)).slice(1)
      );
      setLog(updatedLog);
      setParsedData(newParsedData);
      setRecipients([{ address: "", amount: "" }]);
      setIsTransactionFlow(false);

      notifications.show({
        title: "Success",
        message: "Transaction and key rotation submitted successfully.",
        color: "green",
      });
    } catch (error) {
      console.error("Transaction error:", error);
      notifications.show({
        title: "Error",
        message:
          error.reason || error.message || "Failed to process transaction.",
        color: "red",
      });
      setIsScannerOpen(false);
    } finally {
      setLoading(false);
    }
  }

  // Check if contracts are deployed
  async checkDeployment(appContext) {
    const { setContractAddresses, setIsDeployed } = appContext;
    try {
      let deployedz, addressesz;
      if (DEPLOY_ENV === "localhost") {
        const response = await axios.post(
          "http://localhost:3001/check-deployment",
          {}
        );
        deployedz = response.data.deployed;
        addressesz = response.data.addresses;
      } else {
        deployedz = deployed;
        addressesz = addresses;
      }
      if (deployedz && addressesz) {
        setContractAddresses(addressesz);
        setIsDeployed(true);
        return { status: true, addressesz };
      } else {
        setIsDeployed(false);
        return { status: false };
      }
    } catch (error) {
      console.error("Error checking deployment:", error);
      notifications.show({
        title: "Error",
        message: "Failed to check contract deployment status",
        color: "red",
      });
      setIsDeployed(false);
      return { status: false, error: error.message };
    }
  }

  // Rotate key with a single QR scan
  async rotateKey(appContext, webcamRef) {
    const {
      privateKey,
      parsedData,
      setIsScannerOpen,
      setParsedData,
      setLoading,
      log,
      setLog,
      contractAddresses,
      setPrivateKey,
      setWif,
      supportedTokens,
    } = appContext;

    try {
      notifications.show({
        title: "Key Rotation Required",
        message: `Please scan the QR code for the next key (rotation ${log.length}).`,
        color: "yellow",
      });
      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      const maxAttempts = 100;
      while (attempts < maxAttempts) {
        try {
          qrData = await capture(webcamRef);
          break;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!qrData) {
        throw new Error("No QR code scanned within time limit");
      }

      setIsScannerOpen(false);
      setLoading(true);

      const { newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        qrData,
        false
      );
      setParsedData(newParsedData);
      setPrivateKey(newPrivateKey);
      setWif(newParsedData.wif);

      notifications.show({
        title: "Success",
        message: "Key rotation completed successfully.",
        color: "green",
      });
    } catch (error) {
      console.error("Key rotation error:", error);
      notifications.show({
        title: "Error",
        message: error.message || "Failed to rotate key",
        color: "red",
      });
    } finally {
      setLoading(false);
      setIsScannerOpen(false);
    }
  }

  // Deploy function to send POST request with three WIFs
  async deploy(appContext, wif1, wif2, wif3, cprkh, ctprkh, clean) {
    const { setContractAddresses, setIsDeployed } = appContext;

    try {
      const response = await axios.post("http://localhost:3001/deploy", {
        deployEnv: DEPLOY_ENV === "localhost" ? "deploy" : "deploytest",
        wif1,
        wif2,
        wif3,
        cprkh,
        ctprkh,
        clean,
      });

      const { status, addresses, error } = response.data;

      if (status && addresses) {
        setContractAddresses(addresses);
        setIsDeployed(true);
        notifications.show({
          title: "Deployment Successful",
          message: "Contracts deployed successfully.",
          color: "green",
        });
        return { status: true, addresses };
      } else {
        throw new Error(error || "Failed to deploy contracts");
      }
    } catch (error) {
      console.error("Deployment error:", error);
      notifications.show({
        title: "Error",
        message: error.message || "Failed to deploy contracts",
        color: "red",
      });
      return { status: false, error: error.message };
    }
  }

  // Deploy function to send POST request with three WIFs
  async upgrade(appContext) {
    const {
      contractAddresses,
      setIsDeployed,
      wif,
      privateKey,
      setContractAddresses,
    } = appContext;

    try {
      const signer = new ethers.Wallet(
        ethers.hexlify(privateKey.privateKey),
        localProvider
      );
      console.log(signer.address);
      const response = await axios.post("http://localhost:3001/upgrade", {
        upgradeEnv: DEPLOY_ENV === "localhost" ? "upgrade" : "upgradetest",
        proxyAddress: contractAddresses.bridgeAddress,
        wif: wif,
      });
      const { status, addresses, error } = response.data;

      if (status && addresses) {
        setContractAddresses({
          ...contractAddresses,
          bridgeAddress: contractAddresses.bridgeAddress,
        });
        setIsDeployed(true);
        notifications.show({
          title: "Upgrade Successful",
          message: "Contracts upgraded successfully.",
          color: "green",
        });
        return { status: true, addresses };
      } else {
        throw new Error(error || "Failed to deploy contracts");
      }
    } catch (error) {
      console.error("Deployment error:", error);
      notifications.show({
        title: "Error",
        message: error.message || "Failed to deploy contracts",
        color: "red",
      });
      return { status: false, error: error.message };
    }
  }

  // Processes QR code in YadaCoin format: wifString|prerotatedKeyHash|twicePrerotatedKeyHash|prevPublicKeyHash|rotation
  async processScannedQR(
    appContext,
    qrData,
    isTransactionFlow = false,
    isDeployment = false
  ) {
    const { setUserKeyState, setSigner, privateKey, contractAddresses } =
      appContext;

    try {
      const [
        wifString,
        prerotatedKeyHash,
        twicePrerotatedKeyHash,
        prevPublicKeyHash,
        rotation,
      ] = qrData.split("|");

      // Validate inputs
      if (
        !wifString ||
        !ethers.isAddress(prerotatedKeyHash) ||
        !ethers.isAddress(twicePrerotatedKeyHash) ||
        (prevPublicKeyHash && !ethers.isAddress(prevPublicKeyHash)) ||
        isNaN(parseInt(rotation, 10))
      ) {
        throw new Error("Invalid QR code data");
      }

      // Convert WIF to Ethereum wallet
      const newWallet = fromWIF(wifString);
      const publicKey = newWallet.publicKey;
      const signer = new ethers.Wallet(
        ethers.hexlify(newWallet.privateKey),
        localProvider
      );
      setSigner(signer);
      const publicKeyHash = signer.address;

      const newParsedData = {
        publicKey,
        publicKeyHash,
        prerotatedKeyHash,
        twicePrerotatedKeyHash,
        prevPublicKeyHash: prevPublicKeyHash || ethers.ZeroAddress,
        rotation: parseInt(rotation, 10),
        wif: wifString,
        blockchain: "bsc",
      };

      if (isDeployment) {
        return { newPrivateKey: newWallet, newParsedData };
      }

      // Fetch key log only for non-deployment cases
      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress || ethers.ZeroAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const log = await keyLogRegistry.buildFromPublicKey(
        decompressPublicKey(
          Buffer.from(privateKey ? privateKey.publicKey : newWallet.publicKey)
        ).slice(1)
      );

      // Validate key continuity for non-deployment
      this.validateKeyContinuity(newParsedData, log, isTransactionFlow);

      return { newPrivateKey: newWallet, newParsedData };
    } catch (error) {
      console.error("QR code parsing error:", error);
      notifications.show({
        title: "Error",
        message: "Failed to process QR code",
        color: "red",
      });
      throw error;
    }
  }

  // Validates key continuity for deployment (3 QR codes, no fetchedLog)
  validateDeploymentKeyContinuity(appContext, qrResults) {
    if (!Array.isArray(qrResults) || qrResults.length !== 3) {
      throw new Error("Exactly three QR codes are required for deployment");
    }

    qrResults.forEach((newParsedData, index) => {
      // First key should have no prevPublicKeyHash (or ZeroAddress)
      // if (newParsedData.rotation === 0) {
      //   if (newParsedData.prevPublicKeyHash !== ethers.ZeroAddress) {
      //     throw new Error(
      //       `First key (rotation 0) must have prevPublicKeyHash as ZeroAddress, got ${newParsedData.prevPublicKeyHash}`
      //     );
      //   }
      // }

      // Check continuity between consecutive keys
      if (index < qrResults.length - 1) {
        const nextParsedData = qrResults[index + 1];
        // Current key's prerotatedKeyHash should match next key's publicKeyHash
        if (newParsedData.prerotatedKeyHash !== nextParsedData.publicKeyHash) {
          throw new Error(
            `Key at position ${index + 1} (rotation ${
              newParsedData.rotation
            }) prerotatedKeyHash (${
              newParsedData.prerotatedKeyHash
            }) does not match next key's publicKeyHash (${
              nextParsedData.publicKeyHash
            })`
          );
        }
        // Current key's twicePrerotatedKeyHash should match next key's prerotatedKeyHash
        if (
          newParsedData.twicePrerotatedKeyHash !==
          nextParsedData.prerotatedKeyHash
        ) {
          throw new Error(
            `Key at position ${index + 1} (rotation ${
              newParsedData.rotation
            }) twicePrerotatedKeyHash (${
              newParsedData.twicePrerotatedKeyHash
            }) does not match next key's prerotatedKeyHash (${
              nextParsedData.prerotatedKeyHash
            })`
          );
        }
        // Next key's prevPublicKeyHash should match current key's publicKeyHash
        if (nextParsedData.prevPublicKeyHash !== newParsedData.publicKeyHash) {
          throw new Error(
            `Key at position ${index + 2} (rotation ${
              nextParsedData.rotation
            }) prevPublicKeyHash (${
              nextParsedData.prevPublicKeyHash
            }) does not match current key's publicKeyHash (${
              newParsedData.publicKeyHash
            })`
          );
        }
      }
    });

    return true;
  }

  // Validates key continuity

  // Validates key continuity for rotation or transactions (uses fetchedLog)
  validateKeyContinuity(
    appContext,
    newParsedData,
    fetchedLog,
    isTransactionFlow
  ) {
    const { privateKey, isInitialized } = appContext;

    // Ensure newParsedData is an object (single QR) or array (for compatibility)
    const qrResults = Array.isArray(newParsedData)
      ? newParsedData
      : [newParsedData];

    qrResults.forEach((data, index) => {
      const newPublicKeyHash = data.publicKeyHash;

      if (data.rotation > 0) {
        if (!fetchedLog || fetchedLog.length === 0) {
          throw new Error(
            `No confirmed key event log entries found, but rotation ${data.rotation} requires a previous key`
          );
        }
        const lastEntry = fetchedLog[fetchedLog.length - 1];
        if (!lastEntry) {
          throw new Error(
            "No confirmed key event log entries found for continuity check"
          );
        }

        let isValidContinuity = false;
        if (index === 0 && isTransactionFlow && isInitialized && privateKey) {
          const signer = new ethers.Wallet(
            ethers.hexlify(privateKey.privateKey),
            localProvider
          );
          isValidContinuity =
            data.prevPublicKeyHash === signer.address &&
            (!data.prevPublicKeyHash ||
              signer.address === data.prevPublicKeyHash);
        } else if (index > 0) {
          isValidContinuity =
            data.prevPublicKeyHash === qrResults[index - 1].publicKeyHash &&
            data.prerotatedKeyHash ===
              qrResults[index - 1].twicePrerotatedKeyHash;
        } else {
          isValidContinuity =
            lastEntry.prerotatedKeyHash === newPublicKeyHash &&
            lastEntry.twicePrerotatedKeyHash === data.prerotatedKeyHash &&
            (!data.prevPublicKeyHash ||
              lastEntry.publicKeyHash === data.prevPublicKeyHash);
        }

        if (!isValidContinuity) {
          throw new Error(
            `The scanned key (rotation ${data.rotation}) at position ${
              index + 1
            } does not maintain continuity`
          );
        }
      }

      // For non-first keys in an array, ensure prerotatedKeyHash matches next key's publicKeyHash
      if (index < qrResults.length - 1) {
        if (data.prerotatedKeyHash !== qrResults[index + 1].publicKeyHash) {
          throw new Error(
            `Key at position ${index + 1} (rotation ${
              data.rotation
            }) prerotatedKeyHash does not match key at position ${index + 2}`
          );
        }
      }
    });

    return true;
  }

  async fetchTokenPairs(appContext) {
    const { setLoading, contractAddresses, setTokenPairs, privateKey } =
      appContext;
    if (!contractAddresses.bridgeAddress || !privateKey) {
      console.warn("Bridge address not set, cannot fetch token pairs");
      return [];
    }
    try {
      const signer = new ethers.Wallet(
        ethers.hexlify(privateKey.privateKey),
        localProvider
      );
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        localProvider
      );
      // Fetch supported tokens from the contract
      const supportedTokens = await bridge.getSupportedTokens();
      console.log("Supported original tokens:", supportedTokens);

      const pairs = await Promise.all(
        supportedTokens.map(async (original) => {
          try {
            const pair = await bridge.tokenPairs(original);
            if (pair.wrappedToken !== ethers.ZeroAddress) {
              let name, symbol;
              if (
                original.toLowerCase() ===
                "0x0000000000000000000000000000000000000000"
              ) {
                name = "Binance Coin";
                symbol = "BNB";
              } else {
                const wrappedContract = new ethers.Contract(
                  pair.wrappedToken,
                  WrappedTokenArtifact.abi,
                  localProvider
                );
                name = await wrappedContract.name();
                symbol = await wrappedContract.symbol();
              }
              return {
                original,
                wrapped: pair.wrappedToken,
                name,
                symbol,
              };
            }
            return null;
          } catch (error) {
            console.warn(
              `Error fetching pair for original token ${original}:`,
              error
            );
            return null;
          }
        })
      );
      const filteredPairs = pairs.filter((pair) => pair !== null);
      setTokenPairs(filteredPairs);
      console.log("Updated token pairs:", filteredPairs);
      return filteredPairs;
    } catch (err) {
      console.error(`Error fetching token pairs: ${err.message}`);
      notifications.show({
        title: "Error",
        message: `Failed to fetch token pairs: ${err.message}`,
        color: "red",
      });
      return [];
    }
  }

  async wrap(appContext, webcamRef, amount) {
    const {
      selectedToken,
      setLoading,
      log,
      contractAddresses,
      privateKey,
      setIsScannerOpen,
      setIsTransactionFlow,
      parsedData,
      supportedTokens,
      setLog,
      tokenPairs,
    } = appContext;
    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );

    // Ensure tokenPairs is up-to-date
    if (!tokenPairs || tokenPairs.length === 0) {
      await this.fetchTokenPairs(appContext);
    }

    const selectedOriginal = tokenPairs.find(
      (item) => item.original.toLowerCase() === selectedToken.toLowerCase()
    );

    if (!selectedOriginal) {
      throw new Error("Selected token not supported");
    }

    const isBNB =
      selectedToken.toLowerCase() ===
      "0x0000000000000000000000000000000000000000";
    const token = supportedTokens.find((t) => t.address === selectedToken);
    const tokenDecimals = token?.decimals || 18;

    try {
      // Validate and convert amount
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new Error("Invalid wrap amount");
      }
      const amountToWrap = isBNB
        ? ethers.parseEther(amount)
        : ethers.parseUnits(amount, tokenDecimals);

      // Check balances
      const bnbBalance = await localProvider.getBalance(signer.address);
      let tokenRemainingBalance = BigInt(0);

      if (isBNB) {
        if (bnbBalance < amountToWrap) {
          throw new Error(
            `Insufficient BNB balance: ${ethers.formatEther(
              bnbBalance
            )} available, need ${ethers.formatEther(amountToWrap)}`
          );
        }
        tokenRemainingBalance = bnbBalance - amountToWrap; // Remaining BNB after wrapping
      } else {
        const originalTokenContract = new ethers.Contract(
          selectedOriginal.original,
          ERC20_ABI,
          signer
        );
        const tokenBalance = await originalTokenContract.balanceOf(
          signer.address
        );
        if (tokenBalance < amountToWrap) {
          throw new Error(
            `Insufficient ${
              selectedOriginal.name
            } balance: ${ethers.formatUnits(
              tokenBalance,
              tokenDecimals
            )} available, need ${ethers.formatUnits(
              amountToWrap,
              tokenDecimals
            )}`
          );
        }
        tokenRemainingBalance = tokenBalance - amountToWrap; // Remaining token balance after wrapping
      }

      setIsTransactionFlow(true);
      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      const maxAttempts = 100;
      while (attempts < maxAttempts) {
        try {
          qrData = await capture(webcamRef);
          break;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!qrData) {
        setIsScannerOpen(false);
        throw new Error("No QR code scanned within time limit");
      }

      setIsTransactionFlow(false);
      setIsScannerOpen(false);
      setLoading(true);

      const { newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        qrData,
        true
      );

      const publicKey = decompressPublicKey(
        Buffer.from(privateKey.publicKey)
      ).slice(1);
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );
      const bridgeNonce = await bridge.nonces(signer.address);

      const newPublicKey = decompressPublicKey(
        Buffer.from(newPrivateKey.publicKey)
      ).slice(1);
      const newSigner = new ethers.Wallet(
        ethers.hexlify(newPrivateKey.privateKey),
        localProvider
      );

      const confirmingMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [
          selectedOriginal.original,
          "0",
          newParsedData.prerotatedKeyHash,
          bridgeNonce + 1n,
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await newSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      // Fetch all tokens (original and wrapped)
      const allTokens = [
        ...supportedTokens.map((token) => ({ address: token.address })),
        ...tokenPairs
          .filter((pair) => pair.wrapped !== ethers.ZeroAddress)
          .map((pair) => ({ address: pair.wrapped })),
      ];

      // Generate permits for key rotation, excluding the selected token
      const permits = await this.generatePermitsForTokens(
        appContext,
        signer,
        allTokens,
        newParsedData.prerotatedKeyHash,
        [
          "0x0000000000000000000000000000000000000000",
          selectedOriginal.original.toLowerCase(),
        ]
      );

      // Add permit for the selected token (wrap + remaining balance)
      if (!isBNB) {
        // For ERC20 tokens, include wrap amount and remaining token balance
        const totalAmount = amountToWrap + tokenRemainingBalance;
        const permit = await this.generatePermit(
          appContext,
          selectedOriginal.original,
          signer,
          totalAmount,
          [
            {
              recipientAddress: contractAddresses.bridgeAddress, // Tokens to be wrapped or transferred
              amount: amountToWrap,
              wrap: true,
              unwrap: false,
              mint: false,
            },
            {
              recipientAddress: newParsedData.prerotatedKeyHash, // Remaining tokens to next key
              amount: tokenRemainingBalance,
              wrap: false,
              unwrap: false,
              mint: false,
            },
          ].filter((r) => r.amount > 0)
        );
        if (permit) {
          permits.push(permit);
        }
      }

      const tokenFee = await this.fetchTokenFee(
        appContext,
        selectedOriginal.original
      );

      // Get fee data and estimate gas properly
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;

      // For gas estimation, use a temporary unconfirmed signature with original amount
      const tempUnconfirmedMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [
          selectedOriginal.original,
          amountToWrap,
          newParsedData.prerotatedKeyHash,
          bridgeNonce,
        ]
      );
      const tempUnconfirmedMessageHash = ethers.keccak256(
        tempUnconfirmedMessage
      );
      const tempUnconfirmedSignature = await signer.signMessage(
        ethers.getBytes(tempUnconfirmedMessageHash)
      );

      const tempTxParams = [
        selectedOriginal.original,
        tokenFee,
        {
          amount: amountToWrap,
          signature: tempUnconfirmedSignature,
          publicKey,
          prerotatedKeyHash: parsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: parsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: false,
          tokenSource: signer.address,
          permits,
        },
        {
          amount: BigInt(0),
          signature: confirmingSignature,
          publicKey: newPublicKey,
          prerotatedKeyHash: newParsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: newParsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: false,
          tokenSource: newSigner.address,
          permits: [],
        },
      ];

      // Estimate gas with initial parameters
      let gasEstimate;
      try {
        gasEstimate = await bridge.wrapUnwrap.estimateGas(...tempTxParams, {
          value: isBNB ? amountToWrap : 0, // Use original amount for estimation
        });
      } catch (estimateError) {
        console.error("Gas estimation failed:", estimateError);
        // Fallback gas limit
        gasEstimate = 500000n;
      }

      // Add 30% buffer to gas estimate
      const gasLimit = (gasEstimate * BigInt(130)) / BigInt(100);
      const gasCost = gasEstimate * gasPrice;

      // Calculate total required BNB
      let totalRequiredBNB = gasCost;
      let transactionValue = 0n;
      let finalAmountToWrap = amountToWrap;

      if (isBNB) {
        // For BNB wrapping, we need to send the exact amount to wrap as value
        totalRequiredBNB += amountToWrap;
        transactionValue = amountToWrap; // Send exactly the amount to wrap

        // Check if we have enough for wrap amount + gas
        if (bnbBalance < totalRequiredBNB) {
          throw new Error(
            `Insufficient BNB balance for wrapping and gas: ${ethers.formatEther(
              bnbBalance
            )} available, need ${ethers.formatEther(totalRequiredBNB)}`
          );
        }

        // The remaining BNB after wrap + gas will be automatically transferred
        // via the permit mechanism to the new key
        tokenRemainingBalance = bnbBalance - amountToWrap - gasCost;
      } else {
        // For ERC20, only need gas
        transactionValue = 0n;

        if (bnbBalance < gasCost) {
          throw new Error(
            `Insufficient BNB balance for gas: ${ethers.formatEther(
              bnbBalance
            )} available, need ${ethers.formatEther(gasCost)}`
          );
        }
      }

      // Create final unconfirmed signature with the actual amount
      const finalUnconfirmedMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [
          selectedOriginal.original,
          finalAmountToWrap,
          newParsedData.prerotatedKeyHash,
          bridgeNonce,
        ]
      );
      const finalUnconfirmedMessageHash = ethers.keccak256(
        finalUnconfirmedMessage
      );
      const finalUnconfirmedSignature = await signer.signMessage(
        ethers.getBytes(finalUnconfirmedMessageHash)
      );

      // Update txParams with final signature
      const finalTxParams = [
        selectedOriginal.original,
        tokenFee,
        {
          amount: finalAmountToWrap,
          signature: finalUnconfirmedSignature,
          publicKey,
          prerotatedKeyHash: parsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: parsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: false,
          tokenSource: signer.address,
          permits,
        },
        {
          amount: BigInt(0),
          signature: confirmingSignature,
          publicKey: newPublicKey,
          prerotatedKeyHash: newParsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: newParsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: false,
          tokenSource: newSigner.address,
          permits: [],
        },
      ];

      const nonce = await localProvider.getTransactionCount(
        signer.address,
        "latest"
      );

      // Debug logging
      console.log("Transaction details:", {
        balance: ethers.formatEther(bnbBalance),
        gasLimit: gasLimit.toString(),
        gasPrice: ethers.formatUnits(gasPrice, "gwei"),
        gasCost: ethers.formatEther(gasCost),
        transactionValue: ethers.formatEther(transactionValue),
        amountToWrap: ethers.formatEther(finalAmountToWrap),
        totalRequired: ethers.formatEther(totalRequiredBNB),
        remainingAfterTx: ethers.formatEther(bnbBalance - totalRequiredBNB),
        isBNB,
        nonce,
      });

      // Execute the transaction
      const tx = await bridge.wrapUnwrap(...finalTxParams, {
        nonce,
        value: transactionValue, // Send exactly the amount to wrap (for BNB) or 0 (for ERC20)
        gasLimit,
        gasPrice,
      });

      console.log("Transaction sent:", tx.hash);
      const receipt = await tx.wait();

      if (receipt.status === 0) {
        // Try to get more detailed revert reason
        try {
          const result = await localProvider.call({
            ...tx,
            gasLimit: receipt.gasUsed,
          });
          console.error("Revert data:", result);
        } catch (callError) {
          console.error("Could not get revert reason:", callError);
        }
        throw new Error(`Transaction failed: ${tx.hash}`);
      }

      console.log("Transaction confirmed:", receipt);

      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const updatedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
      setLog(updatedLog);

      const remainingBNBTransfer =
        isBNB && tokenRemainingBalance > 0n
          ? ` and transferred remaining ${ethers.formatEther(
              tokenRemainingBalance
            )} BNB to next key`
          : "";

      notifications.show({
        title: "Success",
        message: `Successfully wrapped ${amount} ${
          isBNB ? "BNB" : selectedOriginal.symbol
        }${remainingBNBTransfer}`,
        color: "green",
      });
    } catch (error) {
      console.error("Wrap error:", error);

      // Enhanced error messaging
      let errorMessage = error.message || "Failed to wrap tokens";

      if (error.code === "INSUFFICIENT_FUNDS") {
        errorMessage = `Insufficient BNB for transaction. Balance: ${ethers.formatEther(
          await localProvider.getBalance(signer.address)
        )} BNB. Required: ${ethers.formatEther(
          error.info?.error?.txCost || 0n
        )} BNB. Shortfall: ${ethers.formatEther(
          error.info?.error?.overshot || 0n
        )} BNB.`;
      } else if (error.code === "CALL_EXCEPTION") {
        errorMessage =
          "Transaction reverted. This could be due to insufficient funds, invalid parameters, or contract logic error.";
      } else if (error.reason) {
        errorMessage = error.reason;
      }

      notifications.show({
        title: "Error",
        message: errorMessage,
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }

  async unwrap(appContext, webcamRef, amount) {
    const {
      selectedToken,
      setLoading,
      log,
      contractAddresses,
      privateKey,
      setIsScannerOpen,
      setIsTransactionFlow,
      parsedData,
      supportedTokens,
      setLog,
      tokenPairs,
    } = appContext;
    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const isBNB =
      selectedToken.toLowerCase() ===
      "0x0000000000000000000000000000000000000000";

    // Ensure tokenPairs is up-to-date
    if (!tokenPairs || tokenPairs.length === 0) {
      await this.fetchTokenPairs(appContext);
    }

    const selectedWrapped = tokenPairs.find(
      (item) => item.original.toLowerCase() === selectedToken.toLowerCase()
    );

    if (!selectedWrapped) {
      throw new Error("Selected token is not a wrapped token");
    }

    const token = supportedTokens.find((t) => t.address === selectedToken);
    const tokenDecimals = token?.decimals || 18;

    try {
      // Validate and convert amount
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new Error("Invalid unwrap amount");
      }
      const amountToUnwrap = ethers.parseUnits(amount, tokenDecimals);

      // Check wrapped token balance
      const bnbbalance = await localProvider.getBalance(signer.address);
      const wrappedTokenContract = new ethers.Contract(
        selectedWrapped.wrapped,
        WRAPPED_TOKEN_ABI,
        signer
      );
      const balance = await wrappedTokenContract.balanceOf(signer.address);
      if (balance < amountToUnwrap) {
        throw new Error(
          `Insufficient ${selectedWrapped.symbol} balance: ${ethers.formatUnits(
            balance,
            tokenDecimals
          )} available, need ${ethers.formatUnits(
            amountToUnwrap,
            tokenDecimals
          )}`
        );
      }
      const remainingBalance = balance - amountToUnwrap;

      setIsTransactionFlow(true);
      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      const maxAttempts = 100;
      while (attempts < maxAttempts) {
        try {
          qrData = await capture(webcamRef);
          break;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!qrData) {
        setIsScannerOpen(false);
        throw new Error("No QR code scanned within time limit");
      }

      setIsTransactionFlow(false);
      setIsScannerOpen(false);
      setLoading(true);

      const { newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        qrData,
        true
      );

      const publicKey = decompressPublicKey(
        Buffer.from(privateKey.publicKey)
      ).slice(1);
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );
      const bridgeNonce = await bridge.nonces(signer.address);

      const unconfirmedMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [
          selectedWrapped.wrapped,
          amountToUnwrap,
          newParsedData.prerotatedKeyHash,
          bridgeNonce,
        ]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const newPublicKey = decompressPublicKey(
        Buffer.from(newPrivateKey.publicKey)
      ).slice(1);
      const newSigner = new ethers.Wallet(
        ethers.hexlify(newPrivateKey.privateKey),
        localProvider
      );

      const confirmingMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [
          selectedWrapped.wrapped,
          "0",
          newParsedData.prerotatedKeyHash,
          bridgeNonce + 1n,
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await newSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      // Fetch all tokens (original and wrapped)
      const allTokens = [
        ...supportedTokens.map((token) => ({ address: token.address })),
        ...tokenPairs
          .filter((pair) => pair.wrapped !== ethers.ZeroAddress)
          .map((pair) => ({ address: pair.wrapped })),
      ];

      // Generate permits for key rotation, excluding the selected wrapped token
      const permits = await this.generatePermitsForTokens(
        appContext,
        signer,
        allTokens,
        newParsedData.prerotatedKeyHash,
        [
          "0x0000000000000000000000000000000000000000",
          selectedWrapped.wrapped.toLowerCase(),
        ]
      );

      // Add permit for the wrapped token (unwrap + remaining balance)
      const totalAmount = amountToUnwrap + remainingBalance;
      if (!isBNB) {
        const permit = await this.generatePermit(
          appContext,
          selectedWrapped.wrapped,
          signer,
          totalAmount,
          [
            {
              recipientAddress: signer.address,
              amount: amountToUnwrap,
              wrap: false,
              unwrap: true,
              mint: false,
            },
            {
              recipientAddress: newParsedData.prerotatedKeyHash,
              amount: remainingBalance,
              wrap: false,
              unwrap: false,
              mint: false,
            },
          ].filter((r) => r.amount > 0)
        );
        if (permit) {
          permits.push(permit);
        }
      }
      let remainingPermit = null;
      if (isBNB && remainingBalance > 0) {
        remainingPermit = await this.generatePermit(
          appContext,
          selectedWrapped.wrapped,
          signer,
          totalAmount,
          [
            {
              recipientAddress: signer.address,
              amount: amountToUnwrap,
              wrap: false,
              unwrap: true,
              mint: false,
            },
            {
              recipientAddress: newParsedData.prerotatedKeyHash,
              amount: remainingBalance,
              wrap: false,
              unwrap: false,
              mint: false,
            },
          ]
        );
      }
      if (remainingPermit) {
        permits.push(remainingPermit);
      }

      const tokenFee = await this.fetchTokenFee(
        appContext,
        selectedWrapped.original
      );

      const txParams = [
        selectedWrapped.wrapped,
        tokenFee,
        {
          amount: amountToUnwrap,
          signature: unconfirmedSignature,
          publicKey,
          prerotatedKeyHash: parsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: parsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          permits,
        },
        {
          amount: BigInt(0),
          signature: confirmingSignature,
          publicKey: newPublicKey,
          prerotatedKeyHash: newParsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: newParsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          permits: [],
        },
      ];

      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasEstimate = await bridge.wrapUnwrap.estimateGas(...txParams, {
        value: 0,
      });
      const gasCost = gasEstimate * gasPrice * 3n;

      const nonce = await localProvider.getTransactionCount(
        signer.address,
        "latest"
      );
      const tx = await bridge.wrapUnwrap(...txParams, {
        nonce,
        value: bnbbalance - gasCost,
        gasLimit: (gasEstimate * 150n) / 100n,
        gasPrice,
      });
      await tx.wait();

      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const updatedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
      setLog(updatedLog);

      notifications.show({
        title: "Success",
        message: `Successfully unwrapped ${amount} ${
          selectedWrapped.symbol
        } to ${selectedWrapped.name}${
          remainingBalance > 0
            ? ` and transferred remaining ${ethers.formatUnits(
                remainingBalance,
                tokenDecimals
              )} ${selectedWrapped.symbol}`
            : ""
        }`,
        color: "green",
      });
    } catch (error) {
      console.error("Unwrap error:", error);
      notifications.show({
        title: "Error",
        message: error.message || "Failed to unwrap tokens",
        color: "red",
      });
    } finally {
      setLoading(false);
      setIsScannerOpen(false);
    }
  }

  async emergencyRecover(appContext) {
    const { privateKey, contractAddresses } = appContext;
    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const bridge = new ethers.Contract(
      contractAddresses.bridgeAddress,
      BRIDGE2_ABI,
      signer
    );
    await bridge.emergencyWithdrawBNB(signer.address);
  }

  async addTokenPairs(appContext, webcamRef, formattedTokenPairs) {
    const {
      selectedToken,
      setLoading,
      log,
      contractAddresses,
      privateKey,
      setIsScannerOpen,
      setIsTransactionFlow,
      parsedData,
      supportedTokens,
      setLog,
      tokenPairs,
    } = appContext;
    try {
      setIsTransactionFlow(true);
      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      const maxAttempts = 100;
      while (attempts < maxAttempts) {
        try {
          qrData = await capture(webcamRef);
          break;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!qrData) {
        setIsScannerOpen(false);
        throw new Error("No QR code scanned within time limit");
      }

      setIsTransactionFlow(false);
      setIsScannerOpen(false);
      setLoading(true);

      const { newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        qrData,
        true
      );

      const signer = new ethers.Wallet(
        ethers.hexlify(privateKey.privateKey),
        localProvider
      );

      const newSigner = new ethers.Wallet(
        ethers.hexlify(newPrivateKey.privateKey),
        localProvider
      );

      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );
      const nonce = await bridge.nonces(signer.address);
      console.log("Nonce:", nonce.toString());

      const supportedTokens = [
        contractAddresses.yadaERC20Address,
        contractAddresses.mockPepeAddress,
        ethers.ZeroAddress,
      ];
      const permits = await Promise.all(
        supportedTokens.map(async (tokenAddress) => {
          if (tokenAddress.toLowerCase() === ethers.ZeroAddress) {
            return null;
          }
          try {
            const abi = ERC20_ABI;
            const tokenContract = new ethers.Contract(
              tokenAddress,
              abi,
              signer
            );
            const balance = await tokenContract.balanceOf(signer.address);
            if (balance > 0n) {
              const tokenNonce = await tokenContract.nonces(signer.address);
              const permit = await this.generatePermit(
                appContext,
                tokenAddress,
                signer,
                balance,
                [
                  {
                    recipientAddress: newParsedData.prerotatedKeyHash,
                    amount: balance,
                    wrap: false,
                    unwrap: false,
                    mint: false,
                  },
                ],
                tokenNonce
              );
              if (permit) {
                return permit;
              } else {
                console.warn(`Permit not supported for token ${tokenAddress}`);
              }
            }
            return null;
          } catch (error) {
            console.warn(
              `Error generating permit for token ${tokenAddress}:`,
              error
            );
            return null;
          }
        })
      ).then((results) => results.filter((permit) => permit !== null));

      const unconfirmedMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(address,string,string,address)[]", "address", "uint256"],
          [formattedTokenPairs, signer.address, nonce]
        )
      );
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const confirmingMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(address,string,string,address)[]", "address", "uint256"],
          [formattedTokenPairs, signer.address, nonce + 1n]
        )
      );
      const confirmingSignature = await newSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );
      const publicKey = decompressPublicKey(
        Buffer.from(privateKey.publicKey)
      ).slice(1);
      const newPublicKey = decompressPublicKey(
        Buffer.from(newPrivateKey.publicKey)
      ).slice(1);

      const unconfirmedKeyData = {
        amount: 0n,
        signature: unconfirmedSignature,
        publicKey: publicKey,
        publicKeyHash: signer.address,
        prerotatedKeyHash: parsedData.prerotatedKeyHash,
        twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
        prevPublicKeyHash: parsedData.prevPublicKeyHash,
        outputAddress: newParsedData.prerotatedKeyHash,
        hasRelationship: false,
        tokenSource: ethers.ZeroAddress,
        permits: permits,
      };

      const confirmingKeyData = {
        amount: 0n,
        signature: confirmingSignature,
        publicKey: newPublicKey,
        publicKeyHash: newSigner.address,
        prerotatedKeyHash: newParsedData.prerotatedKeyHash,
        twicePrerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
        prevPublicKeyHash: newParsedData.prevPublicKeyHash,
        outputAddress: newParsedData.prerotatedKeyHash,
        hasRelationship: false,
        tokenSource: ethers.ZeroAddress,
        permits: [],
      };

      const balance = await localProvider.getBalance(signer.address);

      const gasEstimate = await bridge.addMultipleTokenPairsAtomic.estimateGas(
        formattedTokenPairs,
        unconfirmedKeyData,
        confirmingKeyData,
        { value: balance }
      );

      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasCost = gasEstimate * gasPrice * 2n;

      await bridge.addMultipleTokenPairsAtomic(
        formattedTokenPairs,
        unconfirmedKeyData,
        confirmingKeyData,
        { value: balance - gasCost }
      );

      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const updatedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
      setLog(updatedLog);
      await this.fetchTokenPairs(appContext);

      console.log("Token pairs added successfully!");
    } catch (error) {
      console.error("Error adding token pairs:", error);
    } finally {
      setLoading(false);
    }
  }

  async mintTokens(
    appContext,
    webcamRef,
    wrappedToken,
    recipientAddress,
    amount
  ) {
    const {
      selectedToken,
      setLoading,
      log,
      contractAddresses,
      privateKey,
      setIsScannerOpen,
      setIsTransactionFlow,
      parsedData,
      supportedTokens,
      setLog,
      tokenPairs,
    } = appContext;
    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );

    // Ensure tokenPairs is up-to-date
    if (!tokenPairs || tokenPairs.length === 0) {
      await this.fetchTokenPairs(appContext);
    }

    const selectedWrapped = tokenPairs.find(
      (item) => item.original.toLowerCase() === selectedToken.toLowerCase()
    );

    const token = supportedTokens.find((t) => t.address === selectedToken);
    const tokenDecimals = token?.decimals || 18;

    try {
      // Validate inputs
      if (!ethers.isAddress(recipientAddress)) {
        throw new Error("Invalid recipient address");
      }
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new Error("Invalid mint amount");
      }
      const amountToMint = ethers.parseUnits(amount, tokenDecimals);

      setIsTransactionFlow(true);
      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      const maxAttempts = 100;
      while (attempts < maxAttempts) {
        try {
          qrData = await capture(webcamRef);
          break;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!qrData) {
        setIsScannerOpen(false);
        throw new Error("No QR code scanned within time limit");
      }

      setIsTransactionFlow(false);
      setIsScannerOpen(false);
      setLoading(true);

      const { newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        qrData,
        true
      );

      const publicKey = decompressPublicKey(
        Buffer.from(privateKey.publicKey)
      ).slice(1);
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );
      const bridgeNonce = await bridge.nonces(signer.address);

      // Generate unconfirmed signature
      const unconfirmedMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [wrappedToken, amountToMint, recipientAddress, bridgeNonce]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const newPublicKey = decompressPublicKey(
        Buffer.from(newPrivateKey.publicKey)
      ).slice(1);
      const newSigner = new ethers.Wallet(
        ethers.hexlify(newPrivateKey.privateKey),
        localProvider
      );

      // Generate confirming signature
      const confirmingMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [wrappedToken, 0, newParsedData.prerotatedKeyHash, bridgeNonce + 1n]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await newSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      // Fetch all tokens (original and wrapped) for permits
      const allTokens = [
        ...supportedTokens.map((token) => ({ address: token.address })),
        ...tokenPairs
          .filter((pair) => pair.wrapped !== ethers.ZeroAddress)
          .map((pair) => ({ address: pair.wrapped })),
      ];

      // Generate permits for key rotation
      const permits = await this.generatePermitsForTokens(
        appContext,
        signer,
        allTokens,
        newParsedData.prerotatedKeyHash,
        [
          "0x0000000000000000000000000000000000000000",
          wrappedToken.toLowerCase(),
        ]
      );

      const tokenContract = new ethers.Contract(
        selectedToken,
        ERC20_ABI,
        signer
      );
      const remainingBalance = await tokenContract.balanceOf(signer.address);
      const permit = await this.generatePermit(
        appContext,
        selectedToken,
        signer,
        amountToMint + remainingBalance,
        [
          {
            recipientAddress: recipientAddress,
            amount: amountToMint,
            wrap: false,
            unwrap: false,
            mint: true,
          },
          {
            recipientAddress: newParsedData.prerotatedKeyHash,
            amount: remainingBalance,
            wrap: false,
            unwrap: false,
            mint: false,
          },
        ].filter((r) => r.amount > 0)
      );
      if (permit) {
        permits.push(permit);
      }
      const bnbBalance = await localProvider.getBalance(signer.address);
      permits.push({
        token: ethers.ZeroAddress,
        amount: bnbBalance,
        deadline: 0,
        v: 0,
        r: ethers.ZeroHash,
        s: ethers.ZeroHash,
        recipients: [],
      });

      const txParams = [
        wrappedToken,
        {
          amount: amountToMint,
          signature: unconfirmedSignature,
          publicKey: publicKey,
          prerotatedKeyHash: parsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: parsedData.prevPublicKeyHash,
          outputAddress: recipientAddress,
          hasRelationship: false,
          tokenSource: signer.address,
          permits,
        },
        {
          amount: BigInt(0),
          signature: confirmingSignature,
          publicKey: newPublicKey,
          prerotatedKeyHash: newParsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: newParsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: false,
          tokenSource: newSigner.address,
          permits: [],
        },
      ];

      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasEstimate = await bridge.registerKeyPairWithTransfer.estimateGas(
        ...txParams,
        {
          value: bnbBalance,
        }
      );
      const gasCost = gasEstimate * gasPrice * 3n;
      const amountToSend = bnbBalance - gasCost;

      if (bnbBalance < gasCost) {
        throw new Error(
          `Insufficient BNB balance for gas: ${ethers.formatEther(
            bnbBalance
          )} available, need ${ethers.formatEther(gasCost)}`
        );
      }
      txParams[1].permits
        .find((item) => item.token === ethers.ZeroAddress)
        .recipients.push({
          recipientAddress: newParsedData.prerotatedKeyHash,
          amount: amountToSend,
          wrap: false,
          unwrap: false,
          mint: false,
        });

      const nonce = await localProvider.getTransactionCount(
        signer.address,
        "latest"
      );
      const tx = await bridge.registerKeyPairWithTransfer(...txParams, {
        nonce,
        value: amountToSend,
        gasLimit: (gasEstimate * 150n) / 100n,
        gasPrice,
      });
      await tx.wait();

      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const updatedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
      setLog(updatedLog);

      notifications.show({
        title: "Success",
        message: `Successfully minted ${amount} ${selectedWrapped.symbol} to ${recipientAddress}`,
        color: "green",
      });
    } catch (error) {
      console.error("Mint error:", error);
      notifications.show({
        title: "Error",
        message: error.message || "Failed to mint tokens",
        color: "red",
      });
      throw error;
    } finally {
      setLoading(false);
      setIsScannerOpen(false);
    }
  }

  async burnTokens(
    appContext,
    webcamRef,
    wrappedToken,
    accountAddress,
    amount
  ) {
    const {
      selectedToken,
      setLoading,
      log,
      contractAddresses,
      privateKey,
      setIsScannerOpen,
      setIsTransactionFlow,
      parsedData,
      supportedTokens,
      setLog,
      tokenPairs,
    } = appContext;
    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );

    // Ensure tokenPairs is up-to-date
    if (!tokenPairs || tokenPairs.length === 0) {
      await this.fetchTokenPairs(appContext);
    }

    const selectedWrapped = tokenPairs.find(
      (item) => item.original.toLowerCase() === selectedToken.toLowerCase()
    );

    if (!selectedWrapped) {
      throw new Error("Selected wrapped token not supported");
    }

    const token = supportedTokens.find((t) => t.address === selectedToken);
    const tokenDecimals = token?.decimals || 18;

    try {
      // Validate inputs
      if (!ethers.isAddress(accountAddress)) {
        throw new Error("Invalid account address");
      }
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new Error("Invalid burn amount");
      }
      const amountToBurn = ethers.parseUnits(amount, tokenDecimals);

      // Check wrapped token balance
      const wrappedTokenContract = new ethers.Contract(
        selectedWrapped.wrapped,
        WRAPPED_TOKEN_ABI,
        signer
      );
      const balance = await wrappedTokenContract.balanceOf(accountAddress);
      if (balance < amountToBurn) {
        throw new Error(
          `Insufficient ${selectedWrapped.symbol} balance: ${ethers.formatUnits(
            balance,
            tokenDecimals
          )} available, need ${ethers.formatUnits(amountToBurn, tokenDecimals)}`
        );
      }

      setIsTransactionFlow(true);
      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      const maxAttempts = 100;
      while (attempts < maxAttempts) {
        try {
          qrData = await capture(webcamRef);
          break;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!qrData) {
        setIsScannerOpen(false);
        throw new Error("No QR code scanned within time limit");
      }

      setIsTransactionFlow(false);
      setIsScannerOpen(false);
      setLoading(true);

      const { newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        qrData,
        true
      );

      const publicKey = decompressPublicKey(
        Buffer.from(privateKey.publicKey)
      ).slice(1);
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );
      const bridgeNonce = await bridge.nonces(signer.address);

      // Generate unconfirmed signature
      const unconfirmedMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [wrappedToken, amountToBurn, accountAddress, bridgeNonce]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const newPublicKey = decompressPublicKey(
        Buffer.from(newPrivateKey.publicKey)
      ).slice(1);
      const newSigner = new ethers.Wallet(
        ethers.hexlify(newPrivateKey.privateKey),
        localProvider
      );

      // Generate confirming signature
      const confirmingMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address", "uint256"],
        [wrappedToken, 0, newParsedData.prerotatedKeyHash, bridgeNonce + 1n]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = await newSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      // Fetch all tokens (original and wrapped) for permits
      const allTokens = [
        ...supportedTokens.map((token) => ({ address: token.address })),
        ...tokenPairs
          .filter((pair) => pair.wrapped !== ethers.ZeroAddress)
          .map((pair) => ({ address: pair.wrapped })),
      ];

      // Generate permits for key rotation (excluding BNB since it's sent via value)
      const permits = await this.generatePermitsForTokens(
        appContext,
        signer,
        allTokens,
        newParsedData.prerotatedKeyHash,
        [
          "0x0000000000000000000000000000000000000000", // Exclude BNB
          wrappedToken.toLowerCase(),
        ]
      );

      const remainingBalance = await wrappedTokenContract.balanceOf(
        signer.address
      );
      const totalAmount = amountToBurn + remainingBalance;
      const permit = await this.generatePermit(
        appContext,
        selectedWrapped.wrapped,
        signer,
        totalAmount,
        [
          {
            recipientAddress: accountAddress,
            amount: amountToBurn,
            wrap: false,
            unwrap: true,
            mint: false,
          },
          {
            recipientAddress: newParsedData.prerotatedKeyHash,
            amount: remainingBalance,
            wrap: false,
            unwrap: false,
            mint: false,
          },
        ].filter((r) => r.amount > 0)
      );
      if (permit) {
        permits.push(permit);
      }
      const bnbBalance = await localProvider.getBalance(signer.address);

      // Prepare transaction parameters
      const txParams = [
        wrappedToken,
        {
          amount: amountToBurn,
          signature: unconfirmedSignature,
          publicKey: publicKey,
          prerotatedKeyHash: parsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: parsedData.prevPublicKeyHash,
          outputAddress: accountAddress,
          hasRelationship: false,
          tokenSource: signer.address,
          permits,
        },
        {
          amount: BigInt(0),
          signature: confirmingSignature,
          publicKey: newPublicKey,
          prerotatedKeyHash: newParsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: newParsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: false,
          tokenSource: newSigner.address,
          permits: [],
        },
      ];

      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasEstimate = await bridge.registerKeyPairWithTransfer.estimateGas(
        ...txParams,
        {
          value: bnbBalance,
        }
      );
      const gasCost = gasEstimate * gasPrice * 3n;
      const amountToSend = bnbBalance - gasCost;

      if (bnbBalance < gasCost) {
        throw new Error(
          `Insufficient BNB balance for gas: ${ethers.formatEther(
            bnbBalance
          )} available, need ${ethers.formatEther(totalGasCost)} for gas costs`
        );
      }

      // Ensure we have a reasonable minimum amount to send
      const minimumValue = ethers.parseEther("0.001");
      if (maxSafeValue < minimumValue) {
        throw new Error(
          `BNB amount too small after gas costs: ${ethers.formatEther(
            maxSafeValue
          )} BNB. Minimum recommended: ${ethers.formatEther(minimumValue)} BNB`
        );
      }

      const bnbValueToSend = maxSafeValue;

      // Triple-check the math
      const calculatedTotalCost = totalGasCost + bnbValueToSend;
      const remainingAfterTx = bnbBalance - calculatedTotalCost;

      if (calculatedTotalCost > bnbBalance) {
        const shortfall = calculatedTotalCost - bnbBalance;
        throw new Error(
          `Safety check failed: Transaction would exceed balance by ${ethers.formatEther(
            shortfall
          )} BNB.\n` +
            `Balance: ${ethers.formatEther(bnbBalance)}\n` +
            `Gas cost: ${ethers.formatEther(totalGasCost)}\n` +
            `Value: ${ethers.formatEther(bnbValueToSend)}\n` +
            `Total: ${ethers.formatEther(calculatedTotalCost)}`
        );
      }

      const nonce = await localProvider.getTransactionCount(
        signer.address,
        "latest"
      );

      // Execute the transaction - send BNB via value field
      const tx = await bridge.registerKeyPairWithTransfer(...txParams, {
        nonce,
        value: bnbValueToSend,
        gasLimit,
        gasPrice,
      });
      await tx.wait();

      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const updatedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
      setLog(updatedLog);

      const bnbTransferMessage =
        bnbValueToSend > 0n
          ? ` and transferred ${ethers.formatEther(
              bnbValueToSend
            )} BNB to bridge`
          : "";

      notifications.show({
        title: "Success",
        message: `Successfully burned ${amount} ${selectedWrapped.symbol} from ${accountAddress}${bnbTransferMessage}`,
        color: "green",
      });
    } catch (error) {
      console.error("Burn error:", error);

      notifications.show({
        title: "Error",
        message: error,
        color: "red",
      });
    } finally {
      setLoading(false);
      setIsScannerOpen(false);
    }
  }

  async fetchTokenFee(appContext, tokenAddress) {
    const { privateKey, contractAddresses, setLog } = appContext;
    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const domain =
      DEPLOY_ENV === "localhost"
        ? "http://localhost:8005"
        : "https://yadacoin.io";
    const url = `${domain}/token-price?token=${tokenAddress}`;
    const response = await axios.get(url);

    return response.data;
  }
}

export default YadaBSC;
