import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import { useAppContext } from "../context/AppContext";
import { createHDWallet, fromWIF, decompressPublicKey } from "../utils/hdWallet";
import {
  BRIDGE_ADDRESS,
  KEYLOG_REGISTRY_ADDRESS,
  HARDHAT_MNEMONIC,
  localProvider,
} from "../shared/constants";
import BridgeArtifact from "../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";
import MockERC20Artifact from "../utils/abis/MockERC20.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import { getKeyState } from "../shared/keystate";
import axios from "axios";
import { capture } from "../shared/capture";

const BRIDGE_ABI = BridgeArtifact.abi;
const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
const ERC20_ABI = MockERC20Artifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;

class YadaBSC {
  constructor(appContext, webcamRef) {
    this.appContext = appContext;
    this.webcamRef = webcamRef
  }

  // Helper to generate EIP-2612 permit
  async generatePermit(tokenAddress, signer, amount) {
    // Skip permit generation for BNB (native currency)
    if (tokenAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      console.warn(`Permits not applicable for BNB (${tokenAddress}). Skipping permit generation.`);
      return null;
    }
  
    const isWrapped = this.appContext.tokenPairs
      .map((pair) => pair.wrapped.toLowerCase())
      .includes(tokenAddress.toLowerCase());
    const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
    const token = new ethers.Contract(tokenAddress, abi, signer);
  
    try {
      let name = "Unknown Token"; // Fallback name
      try {
        name = await token.name();
      } catch (error) {
        console.warn(`Failed to fetch name for token ${tokenAddress}: ${error.message}. Using default name: ${name}`);
        notifications.show({
          title: "Warning",
          message: `Token name not available for ${tokenAddress}. Using default name: ${name}.`,
          color: "yellow",
        });
      }
  
      const domain = {
        name,
        version: "1",
        chainId: (await localProvider.getNetwork()).chainId, // Dynamic chainId
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
      return null;
    }
  }

  // Builds transaction history from KeyLogRegistry and token transfer events
// YadaBSC.js
async buildTransactionHistory() {
  const {
    privateKey,
    setLog,
    setLoading,
    setTransactions,
    setCombinedHistory,
    setCurrentPage,
    selectedToken,
  } = this.appContext;

  if (!privateKey || !selectedToken) {
    notifications.show({
      title: "Error",
      message: "Wallet or token not selected",
      color: "red",
    });
    return;
  }

  const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);

  try {
    setLoading(true);
    setCombinedHistory([]); // Clear previous history
    const keyLogRegistry = new ethers.Contract(
      KEYLOG_REGISTRY_ADDRESS,
      KEYLOG_REGISTRY_ABI,
      signer
    );

    // Fetch key log entries
    const currentPublicKey = decompressPublicKey(Buffer.from(privateKey.publicKey)).slice(1);
    let log;
    try {
      log = await keyLogRegistry.buildFromPublicKey(currentPublicKey);
      console.log("KeyLogRegistry log:", log); // Debug log
    } catch (error) {
      console.error("Failed to fetch key log:", error);
      notifications.show({
        title: "Error",
        message: "Failed to fetch key log entries",
        color: "red",
      });
      log = [];
    }

    // Validate log structure
    if (!Array.isArray(log)) {
      console.warn("Log is not an array:", log);
      log = [];
    }

    if (log.length === 0) {
      console.log("No key log entries found for public key:", currentPublicKey);
    }

    setLog(log);

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
              const filter = keyLogRegistry.filters.KeyLogRegistered(entry.publicKeyHash);
              const events = await keyLogRegistry.queryFilter(filter, 0, "latest");
              const event = events.find(e => e.args.publicKeyHash === entry.publicKeyHash);
              if (event) {
                const block = await localProvider.getBlock(event.blockNumber);
                blockNumber = block.number;
                timestamp = block.timestamp;
              } else {
                console.warn(`No KeyLogRegistered event found for ${entry.publicKeyHash}`);
              }
            } catch (error) {
              console.warn(`Error fetching block for ${entry.publicKeyHash}:`, error);
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
      rotationBlocks.map(async ({ rotation, publicKeyHash, blockNumber, timestamp }, index) => {
        const nextBlockNumber = index < rotationBlocks.length - 1 
          ? rotationBlocks[index + 1].blockNumber 
          : "latest";
        const { transactions, totalReceived, totalSent } = await this.fetchTransactionsForKey(
          publicKeyHash,
          rotation,
          blockNumber || 0,
          nextBlockNumber,
          selectedToken
        );

        const keyEventTransaction = {
          id: `key-event-${publicKeyHash}-${rotation}`,
          outputs: [{ to: publicKeyHash, value: "0" }],
          date: timestamp ? new Date(timestamp * 1000).toLocaleDateString() : "N/A",
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
      })
    );

    // Fetch transactions for the current key
    const currentKeyPending = await this.fetchTransactionsForKey(
      currentAddress,
      currentRotation,
      rotationBlocks.length > 0 ? rotationBlocks[rotationBlocks.length - 1].blockNumber : 0,
      "latest",
      selectedToken
    );

    setTransactions(keyLogWithTransactions);

    // Combine key events and transactions
    const combined = [
      ...keyLogWithTransactions.flatMap(entry =>
        entry.transactions.map(txn => ({
          ...txn,
          rotation: entry.rotation,
          public_key_hash: entry.publicKeyHash,
        }))
      ),
      ...currentKeyPending.transactions.map(txn => ({
        ...txn,
        rotation: currentRotation,
        public_key_hash: currentAddress,
      })),
    ];

    // Sort by rotation and date
    combined.sort((a, b) => {
      if (a.rotation !== b.rotation) return a.rotation - b.rotation;
      if (a.type.includes("Key Event") && !b.type.includes("Key Event")) return -1;
      if (!b.type.includes("Key Event") && a.type.includes("Key Event")) return 1;
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

async fetchTransactionsForKey(publicKeyHash, rotation, fromBlock, toBlock, selectedToken) {
  try {
    const { privateKey, supportedTokens } = this.appContext;
    if (!privateKey) {
      return { transactions: [], totalReceived: BigInt(0), totalSent: BigInt(0) };
    }
    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);
    const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
    let transactionsForKey = [];
    let totalReceivedForKey = BigInt(0);
    let totalSentForKey = BigInt(0);

    const toBlockNumber = toBlock === "latest" ? await localProvider.getBlockNumber() : toBlock;

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

      const token = supportedTokens.find(item => item.address === selectedToken)

      for (const block of blocks) {
        for (const txHash of block.transactions) {
          try {
            const tx = await localProvider.getTransaction(txHash);
            if (!tx) continue;

            const receipt = await tx.wait();
            if (receipt.status !== 1) continue; // Skip failed transactions

            const isReceived = tx.to && tx.to.toLowerCase() === publicKeyHash.toLowerCase();
            const isSent = tx.from.toLowerCase() === publicKeyHash.toLowerCase();

            if (isReceived || isSent) {
              const value = tx.value;
              if (isReceived) {
                totalReceivedForKey += value;
              } else if (isSent) {
                totalSentForKey += value;
              }
              transactionsForKey.push({
                id: tx.hash,
                outputs: [{ to: isReceived ? publicKeyHash : tx.to, value: ethers.formatEther(value) }],
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
      const tokenContract = new ethers.Contract(selectedToken, ERC20_ABI, signer);
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
        receivedEvents.map(async event => {
          try {
            const block = await localProvider.getBlock(event.blockNumber);
            const value = event.args.value;
            totalReceivedForKey += value;
            return {
              id: event.transactionHash,
              outputs: [{ to: publicKeyHash, value: ethers.formatEther(value) }],
              date: new Date(block.timestamp * 1000).toLocaleDateString(),
              status: "Confirmed",
              type: `Received ${isWrapped ? "Wrapped Token" : "Token"}`,
              address: publicKeyHash,
              public_key: publicKeyHash,
              rotation,
            };
          } catch (error) {
            console.warn(`Error processing received event ${event.transactionHash}:`, error);
            return null;
          }
        })
      );

      const sentTxns = await Promise.all(
        sentEvents.map(async event => {
          try {
            const block = await localProvider.getBlock(event.blockNumber);
            const value = event.args.value;
            totalSentForKey += value;
            return {
              id: event.transactionHash,
              outputs: [{ to: event.args.to, value: ethers.formatEther(value) }],
              date: new Date(block.timestamp * 1000).toLocaleDateString(),
              status: "Confirmed",
              type: `Sent ${isWrapped ? "Wrapped Token" : "Token"}`,
              address: publicKeyHash,
              public_key: publicKeyHash,
              rotation,
            };
          } catch (error) {
            console.warn(`Error processing sent event ${event.transactionHash}:`, error);
            return null;
          }
        })
      );

      transactionsForKey.push(...receivedTxns.filter(tx => tx !== null), ...sentTxns.filter(tx => tx !== null));
    }

    return {
      transactions: transactionsForKey,
      totalReceived: totalReceivedForKey,
      totalSent: totalSentForKey,
    };
  } catch (error) {
    console.error(`Error fetching transactions for key ${publicKeyHash}:`, error);
    notifications.show({
      title: "Error",
      message: `Failed to load transactions for key ${publicKeyHash.slice(0, 8)}...`,
      color: "red",
    });
    return { transactions: [], totalReceived: BigInt(0), totalSent: BigInt(0) };
  }
}

  // Checks wallet initialization status
  async checkInitializationStatus() {
    const { privateKey, setLog, parsedData } = this.appContext;

    if (!privateKey) {
      return { status: "no_signer" };
    }

    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider)

    try {
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const address = await signer.getAddress();
      const publicKey = Buffer.from(signer.signingKey.publicKey.slice(2), 'hex').slice(1);
      const fetchedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
      setLog(fetchedLog);
      if (fetchedLog.length === 0) {
        return { status: "no_transaction" };
      }

      const latestEntry = fetchedLog[fetchedLog.length - 1];
      if (latestEntry.publicKeyHash === address) {
        return { status: "active" };
      }

      const isKeyInLog = fetchedLog.some(
        (entry) => entry.isOnChain && entry.publicKeyHash === address
      );
      if (isKeyInLog) {
        const logEntry = fetchedLog.find(
          (entry) => !entry.mempool && entry.public_key_hash === address
        );
        const isValidContinuity =
          (parsedData.rotation === 0 && !parsedData.prevPublicKeyHash) ||
          (parsedData.prevPublicKeyHash &&
            fetchedLog.some(
              (e) => !e.mempool && e.publicKeyHash === parsedData.prevPublicKeyHash
            ) &&
            logEntry.prerotatedKeyHash === parsedData.publicKeyHash &&
            logEntry.twicePrerotatedKeyHash === parsedData.prerotatedKeyHash);

        if (!isValidContinuity) {
          return { status: "invalid_continuity" };
        }
        return { status: "revoked" };
      }

      if (parsedData.rotation === fetchedLog.length) {
        if (fetchedLog.length > 0) {
          const lastLogEntry = fetchedLog[fetchedLog.length - 1];
          const isValidContinuity =
            lastLogEntry.publicKeyHash === parsedData.prevPublicKeyHash &&
            lastLogEntry.prerotatedKeyHash === address &&
            lastLogEntry.twicePrerotatedKeyHash === parsedData.prerotatedKeyHash;

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
  async checkStatus() {
    const { setIsInitialized, log } =
      this.appContext;

    const initStatus = await this.checkInitializationStatus();
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
      await this.initializeKeyEventLog();
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
        message: "An error occurred while checking wallet status. Please try again.",
        color: "red",
      });
    }
  }
  
  async fetchFeeEstimate() {
    const { setFeeEstimate, signer, parsedData } = this.appContext;
    
    if (!signer) {
      notifications.show({
        title: "Error",
        message: "No signer available for fee estimation",
        color: "red",
      });
      return;
    }
  
    try {
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
      
      // Estimate gas for a sample transaction (using registerKeyWithTransfer as reference)
      const publicKey = Buffer.from(signer.signingKey.publicKey.slice(2), 'hex').slice(1);
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
      const estimatedFee = gasEstimate * gasPrice * 150n / 100n;
      
      // Format fee in ETH/BNB
      const formattedFee = {
        estimatedFee: ethers.formatEther(estimatedFee),
        gasPrice: ethers.formatUnits(gasPrice, 'gwei'),
        gasLimit: gasEstimate.toString()
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
  async fetchBalance() {
    const { privateKey, selectedToken, setLoading, setBalance } = this.appContext;
    if (!privateKey || !selectedToken) return;

    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);
    try {
      setLoading(true);
      const address = await signer.getAddress();
      let totalBalance = BigInt(0);

      if (selectedToken === ethers.ZeroAddress) {
        // Fetch native coin (BNB) balance
        const nativeBalance = await localProvider.getBalance(address);
        totalBalance += nativeBalance;
      } else {
        // Fetch ERC20 token balance
        const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
        const tokenContract = new ethers.Contract(selectedToken, ERC20_ABI, signer);
        const balance = await tokenContract.balanceOf(address);
        totalBalance += balance;

        // Check if the token has a wrapped version
        const wrappedToken = await bridge.originalToWrapped(selectedToken);
        if (wrappedToken !== ethers.ZeroAddress) {
          const wrappedContract = new ethers.Contract(
            wrappedToken,
            WRAPPED_TOKEN_ABI,
            signer
          );
          const wrappedBalance = await wrappedContract.balanceOf(address);
          totalBalance += wrappedBalance;
        }
      }

      setBalance(ethers.formatEther(totalBalance));
      notifications.show({
        title: "Success",
        message: `Balance refreshed for ${selectedToken === ethers.ZeroAddress ? "BNB" : "selected token"}`,
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
// Initializes key event log
async initializeKeyEventLog() {
  const { privateKey, setLoading, parsedData } = this.appContext;
  if (!privateKey) return;

  const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);
  if (!signer) return;

  try {
    setLoading(true);
    const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
    const keyLogRegistry = new ethers.Contract(
      KEYLOG_REGISTRY_ADDRESS,
      KEYLOG_REGISTRY_ABI,
      signer
    );

    const publicKey = Buffer.from(signer.signingKey.publicKey.slice(2), 'hex').slice(1);
    const publicKeyHash = await signer.getAddress();
    const prerotatedKeyHash = parsedData.prerotatedKeyHash;
    const twicePrerotatedKeyHash = parsedData.twicePrerotatedKeyHash;
    const prevPublicKeyHash = parsedData.prevPublicKeyHash;
    const outputAddress = prerotatedKeyHash;
    const hasRelationship = false;

    // Fetch supported tokens
    const supportedTokens = await bridge.getSupportedTokens();

    // Fetch balances for all supported tokens and generate permits
    const permits = await Promise.all(
      supportedTokens.map(async (tokenAddress) => {
        if (tokenAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") {
          // Skip BNB (handled separately via msg.value)
          return null;
        }
        try {
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
          const balance = await tokenContract.balanceOf(signer.address);
          if (balance > 0n) {
            const permit = await this.generatePermit(tokenAddress, signer, balance);
            if (permit) {
              return {
                token: tokenAddress,
                amount: balance,
                deadline: permit.deadline,
                v: permit.v,
                r: permit.r,
                s: permit.s,
                recipient: outputAddress,
              };
            } else {
              console.warn(`Permit not supported for token ${tokenAddress}`);
            }
          }
          return null;
        } catch (error) {
          console.warn(`Error generating permit for token ${tokenAddress}:`, error);
          return null;
        }
      })
    ).then(results => results.filter(permit => permit !== null)); // Filter out null permits

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
    const amountToSend = balance > gasCost ? balance - gasCost : 0n;

    if (amountToSend <= 0n) {
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
        gasPrice,
      }
    );
    await tx.wait();

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
  }
}


  
async getUserTokensAndPermits(signer, bridge, recipients) {
  const permits = [];
  const supportedTokens = await bridge.getSupportedTokens();
  const deadline = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now

  // Validate recipients
  if (!Array.isArray(recipients) || recipients.length === 0) {
    console.warn("No valid recipients provided for permits");
    return permits;
  }

  for (const recipient of recipients) {
    if (!ethers.isAddress(recipient.address)) {
      console.warn(`Invalid recipient address: ${recipient.address}`);
      continue;
    }
    if (!recipient.amount || isNaN(recipient.amount) || Number(recipient.amount) <= 0) {
      console.warn(`Invalid amount for recipient ${recipient.address}: ${recipient.amount}`);
      continue;
    }

    for (const tokenAddress of supportedTokens) {
      try {
        const tokenContract = new ethers.Contract(tokenAddress, IERC20_ABI, signer);
        const balance = await tokenContract.balanceOf(signer.address);
        const amount = ethers.parseUnits(recipient.amount.toString(), await tokenContract.decimals());
        
        if (balance >= amount && amount > 0n) {
          const permit = await this.generatePermit(tokenAddress, signer, amount);
          if (permit) {
            permits.push({
              token: tokenAddress,
              amount: amount,
              deadline: permit.deadline,
              v: permit.v,
              r: permit.r,
              s: permit.s,
              recipient: recipient.address, // Set recipient to the recipient's address
            });
          } else {
            console.warn(`Skipping permit for token ${tokenAddress} (permit not supported)`);
          }
        } else {
          console.warn(`Insufficient balance for token ${tokenAddress} for recipient ${recipient.address}`);
        }
      } catch (error) {
        console.warn(`Error processing token ${tokenAddress} for recipient ${recipient.address}:`, error);
      }
    }
  }

  console.log("Generated permits:", permits); // Debug log
  return permits;
}

  // Processes QR code in YadaCoin format: wifString|prerotatedKeyHash|twicePrerotatedKeyHash|prevPublicKeyHash|rotation
  async processScannedQR(qrData, isTransactionFlow = false) {
    const { setUserKeyState, setSigner, privateKey, signer } = this.appContext;

    try {
      const [wifString, prerotatedKeyHash, twicePrerotatedKeyHash, prevPublicKeyHash, rotation] = qrData.split("|");
      
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
      const publicKey = newWallet.publicKey; // Remove '0x' prefix
      const signer2 = new ethers.Wallet(
        ethers.hexlify(newWallet.privateKey),
        localProvider
      );
      setSigner(signer2);
      const publicKeyHash = signer2.address;

      const newParsedData = {
        publicKey,
        publicKeyHash,
        prerotatedKeyHash: prerotatedKeyHash,
        twicePrerotatedKeyHash: twicePrerotatedKeyHash,
        prevPublicKeyHash: prevPublicKeyHash || ethers.ZeroAddress,
        rotation: parseInt(rotation, 10),
        wif: wifString,
      };

      // Fetch key log from KeyLogRegistry
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const log = await keyLogRegistry.buildFromPublicKey(
        decompressPublicKey(Buffer.from(privateKey ? privateKey.publicKey : newWallet.publicKey)).slice(1)
      );

      // Validate key continuity
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

  // Signs and submits a token transfer with key rotation
async signTransaction() {
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
    setLog
  } = this.appContext;

  if (!privateKey || recipients.length === 0) {
    throw new Error("Please connect wallet and provide at least one recipient");
  }

  const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);
  const address = await signer.getAddress();

  // Validate recipients
  const invalidRecipient = recipients.find(
    (r) => !r.address || !r.amount || isNaN(r.amount) || Number(r.amount) <= 0 || !ethers.isAddress(r.address)
  );
  if (invalidRecipient) {
    throw new Error(`Invalid recipient: ${JSON.stringify(invalidRecipient)}`);
  }

  const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
  const token = supportedTokens.find((token) => token.address === selectedToken);
  if (!token) {
    throw new Error("Selected token not supported");
  }
  const tokenAddress = token.address;
  const isBNB = tokenAddress.toLowerCase() === "0x0000000000000000000000000000000000000000";
  const tokenDecimals = 18;

  try {
    setLoading(true);
    notifications.show({
      title: "Key Rotation Required",
      message: `Please scan the QR code for the next key (rotation ${log.length + 1}) to proceed.`,
      color: "yellow",
    });
    setIsTransactionFlow(true);
    setIsScannerOpen(true);

    let qrData;
    let attempts = 0;
    const maxAttempts = 100;
    while (attempts < maxAttempts) {
      try {
        qrData = await capture(this.webcamRef);
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
    const { newParsedData } = await this.processScannedQR(qrData, true);

    const nonce = await localProvider.getTransactionCount(address, "latest");
    const bridgeNonce = await bridge.nonces(address);

    // Calculate total BNB amount and prepare permits
    let recipientPermits = [];
    let totalBNBAmount = BigInt(0);
    if (isBNB) {
      totalBNBAmount = recipients.reduce(
        (sum, r) => {
          if (!r.amount || isNaN(r.amount) || Number(r.amount) <= 0) {
            throw new Error(`Invalid amount for recipient ${r.address}: ${r.amount}`);
          }
          return sum + ethers.parseUnits(r.amount.toString(), tokenDecimals);
        },
        BigInt(0)
      );
      recipientPermits = recipients.map(r => ({
        token: tokenAddress,
        amount: ethers.parseUnits(r.amount.toString(), tokenDecimals),
        deadline: 0,
        v: 0,
        r: ethers.ZeroHash,
        s: ethers.ZeroHash,
        recipient: r.address,
      }));
    } else {
      // Handle ERC-20 tokens (unchanged)
      recipientPermits = await Promise.all(
        recipients.map(async (recipient) => {
          const amount = ethers.parseUnits(recipient.amount.toString(), tokenDecimals);
          const permit = await this.generatePermit(tokenAddress, signer, amount);
          if (!permit) {
            throw new Error(`Failed to generate permit for ${recipient.address}`);
          }
          return { ...permit, recipient: recipient.address };
        })
      );
    }

    // Generate signatures
    const signatureAmount = isBNB ? totalBNBAmount : BigInt(0);
    const unconfirmedMessage = ethers.solidityPacked(
      ["address", "uint256", "address", "uint256"],
      [tokenAddress, signatureAmount.toString(), parsedData.prerotatedKeyHash, bridgeNonce.toString()]
    );
    const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
    const unconfirmedSignature = await signer.signMessage(ethers.getBytes(unconfirmedMessageHash));

    const confirmingMessage = ethers.solidityPacked(
      ["address", "uint256", "address", "uint256"],
      [tokenAddress, "0", newParsedData.prerotatedKeyHash, (bridgeNonce + 1n).toString()]
    );
    const confirmingMessageHash = ethers.keccak256(confirmingMessage);
    const confirmingSignature = await signer.signMessage(ethers.getBytes(confirmingMessageHash));

    const currentPublicKey = decompressPublicKey(Buffer.from(privateKey.publicKey)).slice(1);
    const nextPublicKey = decompressPublicKey(Buffer.from(newParsedData.publicKey)).slice(1);

    // Define txParams
    const txParams = [
      {
        amount: BigInt(0),
        signature: unconfirmedSignature,
        publicKey: Buffer.from(currentPublicKey),
        prerotatedKeyHash: parsedData.prerotatedKeyHash,
        twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
        prevPublicKeyHash: parsedData.prevPublicKeyHash,
        outputAddress: parsedData.prerotatedKeyHash,
        hasRelationship: true,
        tokenSource: address,
        permits: recipientPermits,
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
        tokenSource: address,
        permits: [],
      },
    ];

    // Calculate gas cost
    const ethBalance = await localProvider.getBalance(address);
    const feeData = await localProvider.getFeeData();
    const gasPrice = feeData.gasPrice > ethers.parseUnits("5", "gwei") ? ethers.parseUnits("5", "gwei") : feeData.gasPrice;
    const gasEstimate = await bridge.registerKeyPairWithTransfer.estimateGas(...txParams, { value: totalBNBAmount });
    const gasCost = gasEstimate * gasPrice;
    const gasLimit = (gasEstimate * 110n) / 100n;
    const gasBuffer = ethers.parseEther("0.002");

    // Calculate total value
    const remainingBNBBalance = isBNB && ethBalance > totalBNBAmount + gasBuffer
      ? ethBalance - totalBNBAmount - gasBuffer
      : BigInt(0);
    const totalValue = isBNB ? totalBNBAmount + remainingBNBBalance : BigInt(0);

    // Validate balance
    if (ethBalance < gasCost + totalValue) {
      throw new Error(
        `Insufficient BNB balance: ${ethers.formatEther(ethBalance)} BNB. Required: ${ethers.formatEther(gasCost + totalValue)} BNB`
      );
    }

    // Log for debugging
    console.log({
      senderAddress: address,
      totalBNBAmount: ethers.formatEther(totalBNBAmount),
      remainingBNBBalance: ethers.formatEther(remainingBNBBalance),
      totalValue: ethers.formatEther(totalValue),
      ethBalance: ethers.formatEther(ethBalance),
      gasCost: ethers.formatEther(gasCost),
      gasLimit: gasLimit.toString(),
      permits: recipientPermits,
      recipientAddresses: recipients.map(r => r.address),
      recipientAmounts: recipients.map(r => r.amount),
      unconfirmedOutputAddress: parsedData.prerotatedKeyHash,
      confirmingOutputAddress: newParsedData.prerotatedKeyHash,
      bridgeNonce: bridgeNonce.toString(),
    });

    // Submit transaction
    const tx = await bridge.registerKeyPairWithTransfer(...txParams, {
      nonce,
      value: totalValue,
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
      EthTransferredEvents: receipt.logs
        .filter(log => log.address === BRIDGE_ADDRESS)
        .map(log => {
          try {
            const parsed = bridge.interface.parseLog(log);
            return parsed.name === "EthTransferred" ? {
              from: parsed.args.from,
              to: parsed.args.to,
              amount: ethers.formatEther(parsed.args.amount),
            } : null;
          } catch (e) {
            return null;
          }
        })
        .filter(event => event),
      DebugStepEvents: receipt.logs
        .filter(log => log.address === BRIDGE_ADDRESS)
        .map(log => {
          try {
            const parsed = bridge.interface.parseLog(log);
            return parsed.name === "DebugStep" ? {
              step: parsed.args.step,
              value: parsed.args.value.toString(),
            } : null;
          } catch (e) {
            return null;
          }
        })
        .filter(event => event),
    });

    // Update key log
    const keyLogRegistry = new ethers.Contract(KEYLOG_REGISTRY_ADDRESS, KEYLOG_REGISTRY_ABI, signer);
    const publicKey = Buffer.from(signer.signingKey.publicKey.slice(2), 'hex').slice(1);
    const updatedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
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
      message: error.message || "Failed to process transaction.",
      color: "red",
    });
    setIsScannerOpen(false);
  } finally {
    setLoading(false);
  }
}

  // Validates key continuity
  validateKeyContinuity(newParsedData, fetchedLog, isTransactionFlow) {
    const { privateKey, parsedData, isInitialized } = this.appContext;
    const newPublicKeyHash = newParsedData.publicKeyHash;

    if (newParsedData.rotation > 0) {
      if (fetchedLog.length === 0) {
        throw new Error(
          `No confirmed key event log entries found, but rotation ${newParsedData.rotation} requires a previous key`
        );
      }
      const lastEntry = fetchedLog[fetchedLog.length - 1];
      if (!lastEntry) {
        throw new Error(
          "No confirmed key event log entries found for continuity check"
        );
      }
      const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider)
      const isValidContinuity =
        isTransactionFlow && isInitialized
          ? newParsedData.prevPublicKeyHash === signer.address &&
            newParsedData.prerotatedKeyHash === parsedData.twicePrerotatedKeyHash &&
            (!newParsedData.prevPublicKeyHash ||
              signer.address === newParsedData.prevPublicKeyHash)
          : lastEntry.prerotatedKeyHash === newPublicKeyHash &&
            lastEntry.twicePrerotatedKeyHash === newParsedData.prerotatedKeyHash &&
            (!newParsedData.prevPublicKeyHash ||
              lastEntry.publicKeyHash === newParsedData.prevPublicKeyHash);
      if (!isValidContinuity) {
        throw new Error(
          `The scanned key (rotation ${newParsedData.rotation}) does not maintain continuity with the previous key`
        );
      }
    }
    return true;
  }
}

export default YadaBSC;