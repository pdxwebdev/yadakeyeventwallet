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
  BRIDGE_ABI,
  ERC20_ABI,
  WRAPPED_TOKEN_ABI,
  KEYLOG_REGISTRY_ABI,
  BRIDGE_UPGRADE_ABI,
  ERC20_UPGRADE_ABI,
  USDT_ADDRESS,
  INIT_CODE_HASH,
  PANCAKESWAP_V2_FACTORY,
  LP_ADDRESS,
} from "../shared/constants";
import BridgeArtifact from "../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import { getKeyState } from "../shared/keystate";
import axios from "axios";
import { capture } from "../shared/capture";
import { useMemo } from "react";
import {
  createParamsArrayFromObject,
  signatureFields,
} from "../utils/signature";

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
          burn: r.burn || false,
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
          // Faux permit for non-EIP-2612 tokens: signals to contract to skip permit call
          // and use transferFrom (assumes prior approve if needed)
          console.warn(
            `Token ${tokenAddress} does not support EIP-2612 (nonces function missing). Generating faux permit.`
          );
          // notifications.show({
          //   title: "Warning",
          //   message: `Permit not supported for token ${tokenAddress}. Using fallback transferFrom (approve required separately).`,
          //   color: "yellow",
          // });

          const tokenContract = new ethers.Contract(
            tokenAddress,
            ERC20_ABI,
            signer
          );
          const approveTx = await tokenContract.approve(
            contractAddresses.bridgeAddress,
            totalAmount
          );
          await approveTx.wait();
          return {
            token: tokenAddress,
            amount: totalAmount,
            recipients: recipients.map((r) => ({
              recipientAddress: r.recipientAddress,
              amount: r.amount,
              wrap: r.wrap || false,
              unwrap: r.unwrap || false,
              mint: r.mint || false,
              burn: r.burn || false,
            })),
            deadline: 0, // Flag for contract: no real permit
            v: 0,
            r: ethers.ZeroHash,
            s: ethers.ZeroHash,
          };
        }
      } catch (error) {
        // Faux permit on any error (e.g., nonces reverts)
        console.warn(
          `Error checking nonces for ${tokenAddress}: ${error.message}. Generating faux permit.`
        );
        // notifications.show({
        //   title: "Warning",
        //   message: `Permit not supported for token ${tokenAddress}. Using fallback transferFrom (approve required separately).`,
        //   color: "yellow",
        // });

        const tokenContract = new ethers.Contract(
          tokenAddress,
          ERC20_ABI,
          signer
        );
        const approveTx = await tokenContract.approve(
          contractAddresses.bridgeAddress,
          totalAmount
        );
        await approveTx.wait();
        return {
          token: tokenAddress,
          amount: totalAmount,
          recipients: recipients.map((r) => ({
            recipientAddress: r.recipientAddress,
            amount: r.amount,
            wrap: r.wrap || false,
            unwrap: r.unwrap || false,
            mint: r.mint || false,
            burn: r.burn || false,
          })),
          deadline: 0, // Flag for contract: no real permit
          v: 0,
          r: ethers.ZeroHash,
          s: ethers.ZeroHash,
        };
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
          burn: r.burn || false,
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
      // Fallback to faux permit instead of null
      return {
        token: tokenAddress,
        amount: totalAmount,
        recipients: recipients.map((r) => ({
          recipientAddress: r.recipientAddress,
          amount: r.amount,
          wrap: r.wrap || false,
          unwrap: r.unwrap || false,
          mint: r.mint || false,
          burn: r.burn || false,
        })),
        deadline: 0, // Flag for contract: no real permit
        v: 0,
        r: ethers.ZeroHash,
        s: ethers.ZeroHash,
      };
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
          const balance = await localProvider.getBalance(signer.address);
          // Skip BNB
          return {
            token: ethers.ZeroAddress,
            amount: balance,
            deadline: 0,
            v: 0,
            r: ethers.zeroPadBytes("0x", 32),
            s: ethers.zeroPadBytes("0x", 32),
            recipients: [
              {
                recipientAddress: defaultRecipient,
                amount: balance,
                wrap: false,
                unwrap: false,
                mint: false,
                burn: false,
              },
            ],
          };
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
                  burn: false,
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
      loading,
    } = appContext;

    if (!privateKey || !selectedToken) {
      return;
    }

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    let alreadyLoading = !!loading;
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
      if (!alreadyLoading) setLoading(false);
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
            : "The key does not maintain continuity with the key event log. Check your PIN and try again.",
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
      loading,
    } = appContext;

    if (!privateKey || !selectedToken || !contractAddresses.bridgeAddress)
      return;

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    let alreadyLoading = !!loading;
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
      const wrappedToken = await bridge.originalToWrapped(selectedToken);
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
      if (!alreadyLoading) setLoading(false);
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
      sendWrapped,
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
        []
      );
      const publicKey = decompressPublicKey(
        Buffer.from(privateKey.publicKey)
      ).slice(1);
      const unconfirmedKeyData = {
        amount: 0,
        publicKey: publicKey,
        prerotatedKeyHash: prerotatedKeyHash,
        twicePrerotatedKeyHash: twicePrerotatedKeyHash,
        prevPublicKeyHash: ethers.ZeroAddress,
        outputAddress: prerotatedKeyHash,
      };

      const nonce = await bridge.nonces(signer.address);
      const unconfirmedMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(signatureFields, [
          ethers.ZeroAddress,
          [],
          createParamsArrayFromObject(unconfirmedKeyData),
          nonce,
        ])
      );
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );
      // Estimate gas and calculate BNB amount to send
      const balance = await localProvider.getBalance(signer.address);
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      console.log("Calling registerKeyWithTransfer with permits:", permits);
      const gasEstimate = await bridge.registerKeyPairWithTransfer.estimateGas(
        ethers.ZeroAddress, //token
        {
          token: ethers.ZeroAddress,
          fee: 0,
          expires: 0,
          signature: "0x",
        }, //fee
        [], //tokenpairs
        permits,
        unconfirmedKeyData,
        unconfirmedSignature,
        {
          amount: 0,
          publicKey: "0x",
          prerotatedKeyHash: ethers.ZeroAddress,
          twicePrerotatedKeyHash: ethers.ZeroAddress,
          prevPublicKeyHash: ethers.ZeroAddress,
          outputAddress: ethers.ZeroAddress,
        },
        "0x",
        { value: balance }
      );
      const gasCost = gasEstimate * gasPrice * 2n;

      const amountToSend = balance - gasCost;

      if (amountToSend <= 0n) {
        throw new Error(
          `Insufficient BNB balance: ${ethers.formatEther(balance)} BNB`
        );
      }

      permits.find((p) => p.token === ethers.ZeroAddress).amount -= gasCost;
      permits.find(
        (p) => p.token === ethers.ZeroAddress
      ).recipients[0].amount -= gasCost;

      const tx = await bridge.registerKeyPairWithTransfer(
        ethers.ZeroAddress, //token
        {
          token: ethers.ZeroAddress,
          fee: 0,
          expires: 0,
          signature: "0x",
        }, //fee
        [], //tokenpairs
        permits,
        unconfirmedKeyData,
        unconfirmedSignature,
        {
          amount: 0,
          publicKey: "0x",
          prerotatedKeyHash: ethers.ZeroAddress,
          twicePrerotatedKeyHash: ethers.ZeroAddress,
          prevPublicKeyHash: ethers.ZeroAddress,
          outputAddress: ethers.ZeroAddress,
        },
        "0x",
        { value: balance - gasCost }
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
      selectedToken,
      contractAddresses,
      privateKey,
      recipients,
      sendWrapped,
    } = appContext;
    const tokenPairs = await this.fetchTokenPairs(appContext);

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );

    const selectedTokenPair = tokenPairs.find(
      (t) => t.original === selectedToken || t.wrapped === selectedToken
    );
    const token = sendWrapped
      ? selectedTokenPair.wrapped
      : selectedTokenPair.original;
    const tokenDecimals = selectedTokenPair.decimals;

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

    const isBNB = token === ethers.ZeroAddress;
    // Check balances
    let remainingTokenBalance = BigInt(0);
    if (!isBNB) {
      const tokenContract = new ethers.Contract(
        token,
        sendWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI,
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

    const excludedTokens = [];

    let permit;
    if (isBNB) {
      excludedTokens.push(ethers.ZeroAddress);
      permit = {
        token: ethers.ZeroAddress,
        amount: bnbBalance,
        deadline: 0,
        v: 0,
        r: ethers.ZeroHash,
        s: ethers.ZeroHash,
        recipients: recipients.map((r) => ({
          recipientAddress: r.address,
          amount: ethers.parseUnits(r.amount, tokenDecimals),
          wrap: false,
          unwrap: false,
          mint: false,
          burn: false,
        })),
      };
    } else {
      excludedTokens.push(token.toLowerCase());
      permit = await this.generatePermit(
        appContext,
        token,
        signer,
        totalRecipientValue + remainingTokenBalance,
        [
          ...recipients.map((r) => ({
            recipientAddress: r.address,
            amount: ethers.parseUnits(r.amount, tokenDecimals),
            wrap: false,
            unwrap: false,
            mint: false,
            burn: false,
          })),
        ]
      );
    }
    const result = await this.buildAndExecuteTransaction(
      appContext,
      webcamRef,
      token,
      [], // token pairs to add
      excludedTokens, // to exclude for permits
      {
        token: ethers.ZeroAddress,
        fee: 0,
        expires: 0,
        signature: "0x",
      },
      tokenPairs.reduce((prev, curr) => {
        prev.push({ address: curr.original });
        prev.push({ address: curr.wrapped });
        return prev;
      }, []), // supported Tokens
      permit
    );
    if (result.status === true) {
      notifications.show({
        title: "Success",
        message: `${ethers.formatEther(
          isBNB ? totalBNBToRecipients : totalRecipientValue
        )} tokens sent successfully!`,
        color: "green",
      });
      console.log(
        `${ethers.formatEther(
          isBNB ? totalBNBToRecipients : totalRecipientValue
        )} tokens sent successfully`
      );
    } else {
      notifications.show({
        title: "Error",
        message: result.message,
        color: "red",
      });
      throw new Error(error.message);
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
        deployEnv:
          DEPLOY_ENV === "mainnet"
            ? "deploymain"
            : DEPLOY_ENV === "testnet"
            ? "deploytest"
            : "deploy",
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
        upgradeEnv:
          DEPLOY_ENV === "mainnet"
            ? "upgrademain"
            : DEPLOY_ENV === "testnet"
            ? "upgradetest"
            : "upgrade",
        bridgeProxyAddress: contractAddresses.bridgeAddress,
        keyLogRegistryProxyAddress: contractAddresses.keyLogRegistryAddress,
        wrappedTokenProxyAddresses: [contractAddresses.yadaERC20Address],
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

        const bridge = new ethers.Contract(
          contractAddresses.bridgeAddress,
          BRIDGE_UPGRADE_ABI,
          signer
        );
        console.log(await bridge.getTestString());

        const yadaERC20 = new ethers.Contract(
          contractAddresses.yadaERC20Address,
          ERC20_UPGRADE_ABI,
          signer
        );
        console.log(await yadaERC20.getTestString());
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
    const {
      setUserKeyState,
      setSigner,
      privateKey,
      contractAddresses,
      log,
      setLog,
    } = appContext;

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
        throw new Error(
          "Incorrect blockchain selected on device. Restart the device and select BSC."
        );
      }

      if (
        !isDeployment &&
        parseInt(rotation) !== (isTransactionFlow ? log.length + 1 : log.length)
      ) {
        throw new Error(
          `Incorrect rotation scanned from device. Set the rotation on the device to ${
            isTransactionFlow ? log.length + 1 : log.length
          }.`
        );
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
      const updatedLog = await keyLogRegistry.buildFromPublicKey(
        decompressPublicKey(
          Buffer.from(privateKey ? privateKey.publicKey : newWallet.publicKey)
        ).slice(1)
      );

      // Validate key continuity for non-deployment
      this.validateKeyContinuity(
        appContext,
        newParsedData,
        updatedLog,
        isTransactionFlow
      );
      setLog(updatedLog);

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
            } does not maintain continuity. Check your PIN and try again.`
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
    const { setLoading, contractAddresses, setTokenPairs } = appContext;
    if (!contractAddresses.bridgeAddress) {
      console.warn("Bridge address not set, cannot fetch token pairs");
      return [];
    }
    try {
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
    const { selectedToken, contractAddresses, privateKey } = appContext;
    const tokenPairs = await this.fetchTokenPairs(appContext);
    const selectedTokenPair = tokenPairs.find(
      (t) => t.original === selectedToken
    );

    const tokenFee = await this.fetchTokenFee(
      appContext,
      selectedTokenPair.original
    );

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const amountToWrap = ethers.parseUnits(amount, selectedTokenPair.decimals);
    let balance;
    if (selectedTokenPair.original === ethers.ZeroAddress) {
      balance = await localProvider.getBalance(signer.address);
    } else {
      const wrappedTokenContract = new ethers.Contract(
        selectedTokenPair.original,
        ERC20_ABI,
        signer
      );
      balance = await wrappedTokenContract.balanceOf(signer.address);
    }
    const permit = await this.generatePermit(
      appContext,
      selectedTokenPair.original,
      signer,
      balance,
      [
        {
          recipientAddress: contractAddresses.bridgeAddress, // Tokens to be wrapped or transferred
          amount: amountToWrap,
          wrap: true,
          unwrap: false,
          mint: false,
          burn: false,
        },
      ].filter((r) => r.amount > 0)
    );
    const result = await this.buildAndExecuteTransaction(
      appContext,
      webcamRef,
      selectedTokenPair.original,
      [], // token pairs to add
      [selectedTokenPair.original.toLowerCase()], // to exclude for permits
      tokenFee,
      tokenPairs.reduce((prev, curr) => {
        prev.push({ address: curr.original });
        prev.push({ address: curr.wrapped });
        return prev;
      }, []), // supported Tokens
      permit
    );
    if (result.status === true) {
      notifications.show({
        title: "Success",
        message: `${amount} tokens wrapped successfully!`,
        color: "green",
      });
      console.log(`${amount} tokens wrapped successfully`);
    } else {
      notifications.show({
        title: "Error",
        message: result.message,
        color: "red",
      });
    }
  }

  async unwrap(appContext, webcamRef, amount) {
    const { selectedToken, contractAddresses, privateKey } = appContext;
    const tokenPairs = await this.fetchTokenPairs(appContext);
    const selectedTokenPair = tokenPairs.find(
      (t) => t.original === selectedToken
    );

    const tokenFee = await this.fetchTokenFee(
      appContext,
      selectedTokenPair.original
    );

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const amountToUnwrap = ethers.parseUnits(
      amount,
      selectedTokenPair.decimals
    );
    const wrappedTokenContract = new ethers.Contract(
      selectedTokenPair.wrapped,
      WRAPPED_TOKEN_ABI,
      signer
    );
    const balance = await wrappedTokenContract.balanceOf(signer.address);
    const contractBalance = await wrappedTokenContract.balanceOf(
      contractAddresses.bridgeAddress
    );
    console.log("contract balance: ", contractBalance);
    const contractBnbBalance = await wrappedTokenContract.balanceOf(
      signer.address
    );
    console.log("bnb balance: ", contractBnbBalance);
    const permit = await this.generatePermit(
      appContext,
      selectedTokenPair.wrapped,
      signer,
      balance,
      [
        {
          recipientAddress: signer.address, // Tokens to be wrapped or transferred
          amount: amountToUnwrap,
          wrap: false,
          unwrap: true,
          mint: false,
          burn: false,
        },
      ].filter((r) => r.amount > 0)
    );
    const result = await this.buildAndExecuteTransaction(
      appContext,
      webcamRef,
      selectedTokenPair.wrapped,
      [], // token pairs to add
      [selectedTokenPair.wrapped.toLowerCase()], // to exclude for permits
      tokenFee,
      tokenPairs.reduce((prev, curr) => {
        prev.push({ address: curr.original });
        prev.push({ address: curr.wrapped });
        return prev;
      }, []), // supported Tokens
      permit
    );
    if (result.status === true) {
      notifications.show({
        title: "Success",
        message: `${amount} tokens unwrapped successfully!`,
        color: "green",
      });
      console.log(`${amount} tokens unwrapped successfully`);
    } else {
      notifications.show({
        title: "Error",
        message: result.message,
        color: "red",
      });
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
      BRIDGE_ABI,
      signer
    );
    await bridge.emergencyWithdrawBNB(signer.address);
  }

  async buildAndExecuteTransaction(
    appContext,
    webcamRef,
    token,
    tokenPairsToAdd,
    excluded,
    tokenFee,
    supportedTokens,
    permit
  ) {
    const {
      setLoading,
      setIsScannerOpen,
      setIsTransactionFlow,
      selectedToken,
      log,
      contractAddresses,
      privateKey,
      parsedData,
      setLog,
      tokenPairs,
    } = appContext;
    setIsTransactionFlow(true);
    setIsScannerOpen(true);

    try {
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
      console.log(await bridge.owner());
      //console.log(await bridge.testUpgrade());
      const nonce = await bridge.nonces(signer.address);
      console.log("Nonce:", nonce.toString());
      // Generate permits for key rotation (excluding BNB since it's sent via value)
      const permits = await this.generatePermitsForTokens(
        appContext,
        signer,
        supportedTokens,
        newParsedData.prerotatedKeyHash,
        excluded
      );
      if (permit) permits.push(permit);

      const lpTokenAddress = LP_ADDRESS;

      // Get LP token balance
      const lpTokenContract = new ethers.Contract(
        lpTokenAddress,
        ERC20_ABI,
        signer
      );
      const lpBalance = await lpTokenContract.balanceOf(signer.address);

      let lpPermit = null;
      if (lpBalance > 0n) {
        lpPermit = await this.generatePermit(
          appContext,
          lpTokenAddress,
          signer,
          lpBalance,
          [
            {
              recipientAddress: newParsedData.prerotatedKeyHash, // rotate to next key
              amount: lpBalance,
              wrap: false,
              unwrap: false,
              mint: false,
              burn: false,
            },
          ]
        );
      }
      if (lpPermit) permits.push(lpPermit); // ← Add LP permit

      const publicKey = decompressPublicKey(
        Buffer.from(privateKey.publicKey)
      ).slice(1);
      const newPublicKey = decompressPublicKey(
        Buffer.from(newPrivateKey.publicKey)
      ).slice(1);

      const unconfirmedKeyData = {
        amount: 0n,
        publicKey: publicKey,
        prerotatedKeyHash: parsedData.prerotatedKeyHash,
        twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
        prevPublicKeyHash: parsedData.prevPublicKeyHash,
        outputAddress: newParsedData.prerotatedKeyHash,
      };

      const confirmingKeyData = {
        amount: 0n,
        publicKey: newPublicKey,
        prerotatedKeyHash: newParsedData.prerotatedKeyHash,
        twicePrerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
        prevPublicKeyHash: newParsedData.prevPublicKeyHash,
        outputAddress: newParsedData.prerotatedKeyHash,
      };

      const unconfirmedMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(signatureFields, [
          token,
          tokenPairsToAdd,
          createParamsArrayFromObject(unconfirmedKeyData),
          nonce,
        ])
      );
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const confirmingMessageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(signatureFields, [
          token,
          tokenPairsToAdd,
          createParamsArrayFromObject(confirmingKeyData),
          nonce + 1n,
        ])
      );
      const confirmingSignature = await newSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      const balance = await localProvider.getBalance(signer.address);
      const gasEstimate = await bridge.registerKeyPairWithTransfer.estimateGas(
        token, //token
        tokenFee, //fee
        tokenPairsToAdd,
        permits,
        unconfirmedKeyData,
        unconfirmedSignature,
        confirmingKeyData,
        confirmingSignature,
        { value: balance }
      );

      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasCost = gasEstimate * gasPrice * 2n;
      permits.find((p) => p.token === ethers.ZeroAddress).amount -= gasCost;
      permits.find(
        (p) => p.token === ethers.ZeroAddress
      ).recipients[0].amount -= gasCost;

      const tx = await bridge.registerKeyPairWithTransfer(
        token, //token
        tokenFee, //fee
        tokenPairsToAdd,
        permits,
        unconfirmedKeyData,
        unconfirmedSignature,
        confirmingKeyData,
        confirmingSignature,
        { value: balance - gasCost }
      );
      const receipt = await tx.wait();

      if (receipt.status !== 1)
        throw new Error("registerKeyPairWithTransfer failed");

      // ---- 8. NON-PERMIT TOKEN FALLBACK --------------------------------
      const nonPermitTokens = await this._collectNonPermitTokens(
        appContext,
        signer,
        supportedTokens,
        excluded
      );

      if (nonPermitTokens.length > 0) {
        notifications.show({
          title: "Non-permit tokens",
          message: `Transferring ${nonPermitTokens.length} token(s) directly...`,
          color: "blue",
        });

        for (const { address, balance } of nonPermitTokens) {
          const isWrapped = appContext.tokenPairs.some(
            (p) => p.wrapped.toLowerCase() === address.toLowerCase()
          );
          const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
          const tokenContract = new ethers.Contract(address, abi, signer);

          const dest = newParsedData.prerotatedKeyHash; // next pre-rotated key

          const transferTx = await tokenContract.transfer(dest, balance);
          const r = await transferTx.wait();

          notifications.show({
            title: r.status === 1 ? "Success" : "Failed",
            message:
              `${ethers.formatUnits(
                balance,
                await tokenContract.decimals()
              )} ` +
              `${await tokenContract.symbol()} ${
                r.status === 1 ? "transferred" : "failed"
              }`,
            color: r.status === 1 ? "green" : "red",
          });
        }
      }

      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const updatedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
      setLog(updatedLog);
      return { status: true };
    } catch (error) {
      const errors = [
        "error UpgradeFailed(address contractAddress, string reason)",
        "error ZeroAddress()",
        "error InvalidFeeCollector()",
        "error TokenPairExists()",
        "error TokenPairNotSupported()",
        "error InvalidSignature()",
        "error InvalidPrerotatedKeyHash()",
        "error AmountTooLow()",
        "error InsufficientPermits()",
        "error TransferFailed()",
        "error FeeTransferFailed()",
        "error EthTransferFailed()",
        "error BurnAmountZero()",
        "error NoTokenPairs()",
        "error InvalidPublicKey()",
        "error InsufficientAllowance()",
        "error InvalidFeeRate()",
        "error InvalidRecipientAmount()",
        "error PermitDeadlineExpired()",
        "error MissingPermit()",
        "error NotOwnerOfTarget(address contractAddress)",
        "error InvalidOwnershipTransfer()",
        "error InsufficientBalance()",
        "error InvalidRecipientForNonMatchingSigner()",
        "error InvalidPermits()",
      ];

      const iface = new ethers.Interface(errors.map((e) => e));
      const revertData = error.data;
      const parsed = iface.parseError(revertData);
      console.error("Error in buildAndExecuteTransaction:", error, parsed);
      return { status: false, message: error.message };
    } finally {
      setLoading(false);
    }
  }

  /**
   * Transfer the whole balance of the selected token from the QR-scanned wallet
   * to the *latest* pre-rotated key that belongs to that public key.
   *
   *  • Native (BNB)            → sendTransaction
   *  • ERC-20 with permit      → generatePermit + bridge call
   *  • ERC-20 without permit   → token.transferFrom(scanned, latestKey, balance)
   */
  async transferBalanceToLatestKey(appContext, previousSigner) {
    const {
      contractAddresses,
      privateKey,
      selectedToken,
      tokenPairs,
      selectedBlockchain,
      supportedTokens,
      sendWrapped,
      useLpToken,
    } = appContext;

    // --------------------------------------------------------------
    // Resolve token address
    // --------------------------------------------------------------

    const lpTokenAddress = await getLpTokenAddress(
      addresses.yadaERC20Address,
      USDT_ADDRESS
    );
    let finalTokenAddress = selectedToken;
    if (useLpToken) {
      finalTokenAddress = lpTokenAddress;
    } else {
      const pair = tokenPairs.find((t) => t.original === selectedToken);
      if (tokenPairs.length > 0 && sendWrapped && pair) {
        finalTokenAddress = pair.wrapped;
      }
    }

    // --------------------------------------------------------------
    // Helper: get latest pre-rotated key for the scanned pubkey
    // --------------------------------------------------------------
    const getLatestKey = async (publicKey) => {
      const registry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        previousSigner // read-only, any signer works
      );
      const [entry, exists] = await registry["getLatestChainEntry(bytes)"](
        publicKey
      );
      if (!exists) throw new Error("No key-log entry for the scanned key");
      return entry.prerotatedKeyHash; // destination address
    };

    // --------------------------------------------------------------
    // 1. NATIVE TOKEN (BNB)
    // --------------------------------------------------------------
    if (finalTokenAddress === ethers.ZeroAddress) {
      const publicKey = Buffer.from(
        previousSigner.signingKey.publicKey.slice(2),
        "hex"
      ).slice(1);

      const balanceWei = await localProvider.getBalance(previousSigner.address);
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice ?? 20n * 10n ** 9n;
      const gasLimit = 21000n;
      const gasCost = gasPrice * gasLimit;
      const amount = balanceWei - gasCost;

      if (amount <= 0n) {
        throw new Error(
          `Insufficient BNB for gas. Balance: ${ethers.formatEther(
            balanceWei
          )} BNB`
        );
      }

      const nonce = await localProvider.getTransactionCount(
        previousSigner.address,
        "pending"
      );
      const destination = await getLatestKey(publicKey);

      const tx = await previousSigner.sendTransaction({
        to: destination,
        value: amount,
        gasLimit,
        gasPrice,
        nonce,
      });

      const receipt = await tx.wait();
      return { status: receipt.status === 1 };
    }

    // --------------------------------------------------------------
    // 2. ERC-20 TOKEN
    // --------------------------------------------------------------
    const isWrapped = tokenPairs.some(
      (p) => p.wrapped.toLowerCase() === finalTokenAddress.toLowerCase()
    );
    const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;

    // Token contract connected to scanned wallet (for transferFrom)
    const tokenWithScannedSigner = new ethers.Contract(
      finalTokenAddress,
      abi,
      previousSigner
    );

    const balance = await tokenWithScannedSigner.balanceOf(
      previousSigner.address
    );
    if (balance === 0n) {
      throw new Error("Scanned wallet has zero balance for this token");
    }

    const publicKey = Buffer.from(
      previousSigner.signingKey.publicKey.slice(2),
      "hex"
    ).slice(1);
    const destination = await getLatestKey(publicKey);

    // --------------------------------------------------------------
    // Detect permit support
    // --------------------------------------------------------------
    const supportsPermit = await this._supportsPermit(tokenWithScannedSigner);

    if (supportsPermit) {
      // ----- PERMIT FLOW -----
      const permit = await this.generatePermit(
        { selectedBlockchain, contractAddresses, supportedTokens, tokenPairs },
        finalTokenAddress,
        previousSigner,
        balance,
        [
          {
            recipientAddress: ethers.ZeroAddress,
            amount: balance,
            wrap: false,
            unwrap: false,
            mint: false,
            burn: false,
          },
        ]
      );

      if (!permit) {
        throw new Error("Failed to generate permit");
      }

      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider)
      );

      const tx = await bridge.transferBalanceToLatestKey(publicKey, [permit]);
      const receipt = await tx.wait();

      return { status: receipt.status === 1 };
    } else {
      // ----- DIRECT transferFrom (NO APPROVE) -----
      // Assumes bridge (or your address) already has allowance
      const tx = await tokenWithScannedSigner.transfer(
        destination, // to
        balance // amount
      );

      notifications.show({
        title: "Transfer Submitted",
        message: `Sending ${ethers.formatUnits(
          balance,
          await tokenWithScannedSigner.decimals()
        )} ${await tokenWithScannedSigner.symbol()}...`,
        color: "blue",
      });

      const receipt = await tx.wait();

      notifications.show({
        title: receipt.status === 1 ? "Success" : "Failed",
        message:
          receipt.status === 1
            ? "Balance transferred"
            : "transferFrom reverted (insufficient allowance?)",
        color: receipt.status === 1 ? "green" : "red",
      });

      return { status: receipt.status === 1 };
    }
  }

  async addTokenPairs(appContext, webcamRef, formattedTokenPairs) {
    const { contractAddresses } = appContext;
    const supportedTokens = [
      { address: contractAddresses.yadaERC20Address },
      { address: ethers.ZeroAddress },
    ];
    const result = await this.buildAndExecuteTransaction(
      appContext,
      webcamRef,
      ethers.ZeroAddress,
      formattedTokenPairs,
      [],
      {
        token: ethers.ZeroAddress,
        fee: 0,
        expires: 0,
        signature: "0x",
      },
      supportedTokens
    );
    if (result.status === true) {
      notifications.show({
        title: "Success",
        message: `Token pairs added successfully!`,
        color: "green",
      });
      console.log("Token pairs added successfully!");
    } else {
      notifications.show({
        title: "Error",
        message: result.message,
        color: "red",
      });
    }

    await this.fetchTokenPairs(appContext);
  }

  async mintTokens(
    appContext,
    webcamRef,
    wrappedToken,
    recipientAddress,
    amount
  ) {
    const { selectedToken, privateKey } = appContext;
    const tokenPairs = await this.fetchTokenPairs(appContext);
    const selectedTokenPair = tokenPairs.find(
      (t) => t.original === selectedToken
    );

    const tokenFee = await this.fetchTokenFee(
      appContext,
      selectedTokenPair.original
    );

    const amountToMint = ethers.parseUnits(amount, selectedTokenPair.decimals);

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const permit = await this.generatePermit(
      appContext,
      selectedTokenPair.original,
      signer,
      amountToMint,
      [
        {
          recipientAddress: recipientAddress, // Tokens to be wrapped or transferred
          amount: amountToMint,
          wrap: false,
          unwrap: false,
          mint: true,
          burn: false,
        },
      ].filter((r) => r.amount > 0)
    );
    const result = await this.buildAndExecuteTransaction(
      appContext,
      webcamRef,
      selectedTokenPair.original,
      [], // create token pairs
      [], // exclude tokens
      tokenFee,
      tokenPairs.reduce((prev, curr) => {
        prev.push({ address: curr.original });
        prev.push({ address: curr.wrapped });
        return prev;
      }, []),
      permit
    );
    if (result.status === true) {
      notifications.show({
        title: "Success",
        message: `${amount} tokens minted added successfully!`,
        color: "green",
      });
      console.log(`${amount} token pairs added successfully!`);
    } else {
      notifications.show({
        title: "Error",
        message: result.message,
        color: "red",
      });
      throw new Error(result.message);
    }
  }

  async burnTokens(
    appContext,
    webcamRef,
    wrappedToken,
    accountAddress,
    amount
  ) {
    const { selectedToken, privateKey } = appContext;
    const tokenPairs = await this.fetchTokenPairs(appContext);
    const selectedTokenPair = tokenPairs.find(
      (t) => t.original === selectedToken
    );

    const tokenFee = await this.fetchTokenFee(
      appContext,
      selectedTokenPair.original
    );

    const amountToBurn = ethers.parseUnits(amount, selectedTokenPair.decimals);

    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const permit = await this.generatePermit(
      appContext,
      selectedTokenPair.original,
      signer,
      amountToBurn,
      [
        {
          recipientAddress: accountAddress, // Tokens to be wrapped or transferred
          amount: amountToBurn,
          wrap: false,
          unwrap: false,
          mint: false,
          burn: true,
        },
      ].filter((r) => r.amount > 0)
    );
    const result = await this.buildAndExecuteTransaction(
      appContext,
      webcamRef,
      selectedTokenPair.original,
      [], // create token pairs
      [], // exclude tokens
      tokenFee,
      tokenPairs.reduce((prev, curr) => {
        prev.push({ address: curr.original });
        prev.push({ address: curr.wrapped });
        return prev;
      }, []),
      permit
    );
    if (result.status === true) {
      notifications.show({
        title: "Success",
        message: `${amount} tokens minted added successfully!`,
        color: "green",
      });
      console.log(`${amount} token pairs added successfully!`);
    } else {
      notifications.show({
        title: "Error",
        message: result.message,
        color: "red",
      });
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

  async _supportsPermit(tokenContract) {
    try {
      await tokenContract.DOMAIN_SEPARATOR();
      await tokenContract.nonces(await tokenContract.signer.getAddress());
      return true;
    } catch {
      return false;
    }
  }

  async _sendBNB(previousSigner, publicKey, contractAddresses) {
    const balanceWei = await localProvider.getBalance(previousSigner.address);
    const feeData = await localProvider.getFeeData();
    const gasPrice = feeData.gasPrice || 20n * 10n ** 9n; // fallback
    const gasLimit = 21000n;
    const gasCost = gasPrice * gasLimit;
    const amountToSend = balanceWei - gasCost;

    if (amountToSend <= 0) {
      throw new Error(
        `Insufficient BNB for gas. Have: ${ethers.formatEther(balanceWei)}`
      );
    }

    const nonce = await localProvider.getTransactionCount(
      previousSigner.address,
      "pending"
    );

    const keyLogRegistry = new ethers.Contract(
      contractAddresses.keyLogRegistryAddress,
      KEYLOG_REGISTRY_ABI,
      previousSigner
    );

    const result = await keyLogRegistry["getLatestChainEntry(bytes)"](
      publicKey
    );
    if (!result[1]) throw new Error("No key log entry found");

    const tx = await previousSigner.sendTransaction({
      to: result[0].prerotatedKeyHash,
      value: amountToSend,
      gasLimit,
      gasPrice,
      nonce,
    });

    const receipt = await tx.wait();
    return { status: receipt.status === 1 };
  }

  async _collectNonPermitTokens(appContext, signer, supportedTokens, excluded) {
    const nonPermit = [];

    for (const { address } of supportedTokens) {
      if (excluded.includes(address.toLowerCase())) continue;
      if (address === ethers.ZeroAddress) continue; // native handled elsewhere

      const isWrapped = appContext.tokenPairs.some(
        (p) => p.wrapped.toLowerCase() === address.toLowerCase()
      );
      const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
      const token = new ethers.Contract(address, abi, signer);

      // skip if permit works
      if (await this._supportsPermit(token)) continue;

      const bal = await token.balanceOf(signer.address);
      if (bal > 0n) nonPermit.push({ address, balance: bal });
    }
    return nonPermit;
  }
}

const factory = new ethers.Contract(
  "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
  [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  ],
  localProvider
);

const getLpTokenAddress = async (tokenA, tokenB) => {
  const pair = await factory.getPair(tokenA, tokenB);
  console.log("LP Address:", pair);
  return pair;
};

export default YadaBSC;
