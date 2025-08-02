import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import { useAppContext } from "../context/AppContext";
import { createHDWallet, fromWIF, decompressPublicKey } from "../utils/hdWallet";
import {
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
import { useMemo } from "react";

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
  async generatePermit(tokenAddress, signer, amount, nonce) {
    const {contractAddresses} = this.appContext
    // Skip permit generation for BNB (native currency)
    if (tokenAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      console.warn(`Permits not applicable for BNB (${tokenAddress}). Skipping permit generation.`);
      return null;
    }
  
    const isWrapped = this.appContext.supportedTokens
      .map((token) => token.address.toLowerCase())
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
      const permitDeadline = Math.floor(Date.now() / 1000) + 60 * 60;
      const message = {
        owner,
        spender: contractAddresses.bridgeAddress,
        value: amount.toString(),
        nonce: nonce.toString(),
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
    contractAddresses
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
      contractAddresses.keyLogRegistryAddress,
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
    const { privateKey, supportedTokens, contractAddresses } = this.appContext;
    if (!privateKey) {
      return { transactions: [], totalReceived: BigInt(0), totalSent: BigInt(0) };
    }
    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);
    const bridge = new ethers.Contract(contractAddresses.bridgeAddress, BRIDGE_ABI, signer);
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
    const { privateKey, setLog, parsedData, contractAddresses } = this.appContext;

    if (!privateKey || !contractAddresses.keyLogRegistryAddress) {
      return { status: "no_signer" };
    }

    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider)

    try {
      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
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
      const bridge = new ethers.Contract(contractAddresses.bridgeAddress, BRIDGE_ABI, signer);
      
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
    const { privateKey, selectedToken, setLoading, setBalance, setSymbol, supportedTokens, contractAddresses } = this.appContext;
    
    if (!privateKey || !selectedToken) return;

    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);
    try {
      setLoading(true);
      const address = await signer.getAddress();
      let totalBalance = BigInt(0);

      if (selectedToken === ethers.ZeroAddress) {

        setSymbol('bnb');
        // Fetch native coin (BNB) balance
        const nativeBalance = await localProvider.getBalance(address);
        totalBalance += nativeBalance;
      } else {
        // Fetch ERC20 token balance
        const bridge = new ethers.Contract(contractAddresses.bridgeAddress, BRIDGE_ABI, signer);

        const token = supportedTokens.find(item => item.address === selectedToken)
        setSymbol(token.symbol);

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
async initializeKeyEventLog() {
  const { privateKey, setLoading, parsedData, contractAddresses } = this.appContext;
  if (!privateKey) return;

  const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);
  if (!signer) return;

  try {
    setLoading(true);
    const bridge = new ethers.Contract(contractAddresses.bridgeAddress, BRIDGE_ABI, signer);
    const keyLogRegistry = new ethers.Contract(
      contractAddresses.keyLogRegistryAddress,
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
          const isWrapped = this.appContext.supportedTokens
            .map((token) => token.address.toLowerCase())
            .includes(tokenAddress.toLowerCase());
          const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
          const tokenContract = new ethers.Contract(tokenAddress, abi, signer);
          const balance = await tokenContract.balanceOf(signer.address);
          if (balance > 0n) {
            const nonce = await tokenContract.nonces(signer.address);
            const permit = await this.generatePermit(tokenAddress, signer, balance, nonce);
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
    setLog,
    contractAddresses
  } = this.appContext;

  // Validate ethers
  if (!ethers) {
    throw new Error('ethers is not defined. Ensure ethers@6.13.5 is imported correctly in YadaBSC.js');
  }

  if (!privateKey || recipients.length === 0) {
    throw new Error('Please connect wallet and provide at least one recipient');
  }

  const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);
  const address = await signer.getAddress();
  const token = supportedTokens.find((t) => t.address === selectedToken);
  if (!token) {
    throw new Error('Selected token not supported');
  }
  const tokenAddress = token.address;
  const tokenDecimals = token.decimals || 18;
  const isBNB = tokenAddress.toLowerCase() === '0x0000000000000000000000000000000000000000';

  try {
    setLoading(true);
    notifications.show({
      title: 'Key Rotation Required',
      message: `Please scan the QR code for the next key (rotation ${log.length + 1}) to proceed.`,
      color: 'yellow',
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
      throw new Error('No QR code scanned within time limit');
    }

    setIsScannerOpen(false);
    const { newPrivateKey, newParsedData } = await this.processScannedQR(qrData, true);
    const newSigner = new ethers.Wallet(ethers.hexlify(newPrivateKey.privateKey), localProvider);
    const newAddress = await newSigner.getAddress();


    const bridge = new ethers.Contract(contractAddresses.bridgeAddress, BRIDGE_ABI, signer);

    const nonce = await localProvider.getTransactionCount(address, 'latest');
    const bridgeNonce = await bridge.nonces(address);

    // Calculate total recipient value for the selected token
    const totalRecipientValue = recipients.reduce((sum, r) => {
      return sum + ethers.parseUnits(r.amount, tokenDecimals);
    }, BigInt(0));

    // Calculate remaining token balance (for ERC-20 tokens)
    let remainingTokenBalance = BigInt(0);
    if (!isBNB) {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      remainingTokenBalance = await tokenContract.balanceOf(signer.address);
      remainingTokenBalance = remainingTokenBalance > totalRecipientValue ? remainingTokenBalance - totalRecipientValue : BigInt(0);
    }

    // Calculate total amount for unconfirmed transaction
    let unconfirmedAmount = totalRecipientValue;
    if (!isBNB && remainingTokenBalance > 0) {
      unconfirmedAmount += remainingTokenBalance;
    }

    // Calculate BNB amounts
    const bnbBalance = await localProvider.getBalance(signer.address);
    const feeData = await localProvider.getFeeData();
    const gasPrice = feeData.gasPrice; // Cap at 1 gwei

    // Calculate total BNB for recipients
    let totalBNBToRecipients = BigInt(0);
    if (isBNB) {
      totalBNBToRecipients = totalRecipientValue;
    }

    // Calculate adjusted amounts for permits (subtract recipient amounts before signing)
    const tokenBalances = new Map();
    const tokenNonces = new Map();
    await Promise.all(
      supportedTokens.map(async (token) => {
        const tAddress = token.address;
        if (tAddress.toLowerCase() === '0x0000000000000000000000000000000000000000') {
          return;
        }
        const isWrapped = this.appContext.supportedTokens
          .map((token) => token.address.toLowerCase())
          .includes(tAddress.toLowerCase());
        const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
        const tokenContract = new ethers.Contract(tAddress, abi, signer);
        const balance = await tokenContract.balanceOf(signer.address);
        if (balance > 0n) {
          tokenBalances.set(tAddress, balance);
          try {
            const nonce = await tokenContract.nonces(signer.address);
            tokenNonces.set(tAddress, nonce);
          } catch (error) {
            console.warn(`Error querying nonce for token ${tAddress}:`, error);
          }
        }
      })
    );

    // Calculate recipient amounts per token
    const recipientTokenAmounts = new Map();
    recipients.forEach((recipient) => {
      if (tokenAddress.toLowerCase() === selectedToken.toLowerCase()) {
        const amount = ethers.parseUnits(recipient.amount, tokenDecimals);
        recipientTokenAmounts.set(tokenAddress, (recipientTokenAmounts.get(tokenAddress) || BigInt(0)) + amount);
      }
    });

    // Adjust permit amounts before generating signatures
    const adjustedPermitAmounts = new Map();
    tokenBalances.forEach((balance, tAddress) => {
      const recipientAmount = recipientTokenAmounts.get(tAddress) || BigInt(0);
      const adjustedAmount = balance > recipientAmount ? balance - recipientAmount : BigInt(0);
      adjustedPermitAmounts.set(tAddress, adjustedAmount);
    });

    // Generate permits for supported tokens (excluding BNB)
    const permits = await Promise.all(
      supportedTokens.map(async (token) => {
        const tAddress = token.address;
        if (tAddress.toLowerCase() === '0x0000000000000000000000000000000000000000') {
          return null;
        }
        const adjustedAmount = adjustedPermitAmounts.get(tAddress) || BigInt(0);
        if (adjustedAmount > 0n) {
          try {
            const nonce = tokenNonces.get(tAddress) || BigInt(0);
            const permit = await this.generatePermit(tAddress, signer, adjustedAmount, nonce);
            if (permit) {
              tokenNonces.set(tAddress, nonce + BigInt(1));
              return {
                token: tAddress,
                amount: adjustedAmount,
                deadline: permit.deadline,
                v: permit.v,
                r: permit.r,
                s: permit.s,
                recipient: newParsedData.prerotatedKeyHash,
              };
            }
          } catch (error) {
            console.warn(`Error generating permit for token ${tAddress}:`, error);
          }
        }
        return null;
      })
    ).then(results => results.filter(permit => permit !== null));

    // Generate permits for recipient transfers
    let recipientPermits = [];
    if (isBNB) {
      recipientPermits = recipients.map(recipient => {
        const amount = ethers.parseUnits(recipient.amount, tokenDecimals);
        return {
          token: ethers.ZeroAddress,
          amount,
          deadline: 0,
          v: 0,
          r: ethers.ZeroHash,
          s: ethers.ZeroHash,
          recipient: recipient.address,
        };
      });
    } else {
      recipientPermits = await Promise.all(
        recipients.map(async (recipient) => {
          const amount = ethers.parseUnits(recipient.amount, tokenDecimals);
          try {
            const nonce = tokenNonces.get(tokenAddress) || BigInt(0);
            const permit = await this.generatePermit(tokenAddress, signer, amount, nonce);
            if (permit) {
              tokenNonces.set(tokenAddress, nonce + BigInt(1));
              return {
                token: tokenAddress,
                amount,
                deadline: permit.deadline,
                v: permit.v,
                r: permit.r,
                s: permit.s,
                recipient: recipient.address,
              };
            }
            return null;
          } catch (error) {
            console.warn(`Error generating permit for recipient ${recipient.address}:`, error);
            return null;
          }
        })
      ).then(results => results.filter(permit => permit !== null));
    }

    // Combine all permits
    permits.push(...recipientPermits);

    // Generate signatures
    const unconfirmedMessage = ethers.solidityPacked(
      ['address', 'uint256', 'address', 'uint256'],
      [tokenAddress, unconfirmedAmount.toString(), parsedData.prerotatedKeyHash, bridgeNonce.toString()]
    );
    const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
    const unconfirmedSignature = await signer.signMessage(ethers.getBytes(unconfirmedMessageHash));

    const confirmingMessage = ethers.solidityPacked(
      ['address', 'uint256', 'address', 'uint256'],
      [tokenAddress, '0', newParsedData.prerotatedKeyHash, (bridgeNonce + 1n).toString()]
    );
    const confirmingMessageHash = ethers.keccak256(confirmingMessage);
    const confirmingSignature = await newSigner.signMessage(ethers.getBytes(confirmingMessageHash));

    const currentPublicKey = decompressPublicKey(Buffer.from(privateKey.publicKey)).slice(1);
    const nextPublicKey = decompressPublicKey(Buffer.from(newPrivateKey.publicKey)).slice(1);

    // Verify public key and signature
    console.log('nextPublicKey:', Buffer.from(nextPublicKey).toString('hex'));
    console.log('nextPublicKey Length:', nextPublicKey.length);
    const computedConfirmingAddress = ethers.computeAddress(`0x04${Buffer.from(nextPublicKey).toString('hex')}`);
    if (computedConfirmingAddress.toLowerCase() !== newAddress.toLowerCase()) {
      throw new Error(`Public key mismatch: computed ${computedConfirmingAddress}, expected ${newAddress}`);
    }
    const confirmingRecovered = ethers.verifyMessage(ethers.getBytes(confirmingMessageHash), confirmingSignature);
    if (confirmingRecovered.toLowerCase() !== newAddress.toLowerCase()) {
      throw new Error(`Signature mismatch: recovered ${confirmingRecovered}, expected ${newAddress}`);
    }

    // Define txParams
    const txParams = [
      {
        amount: unconfirmedAmount,
        signature: unconfirmedSignature,
        publicKey: Buffer.from(currentPublicKey),
        prerotatedKeyHash: parsedData.prerotatedKeyHash,
        twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
        prevPublicKeyHash: parsedData.prevPublicKeyHash,
        outputAddress: parsedData.prerotatedKeyHash,
        hasRelationship: true,
        tokenSource: address,
        permits: permits,
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

    // Log permits for debugging
    console.log('Permits:', permits);

    // Estimate gas
    let gasEstimate;
    try {
      gasEstimate = await bridge.registerKeyPairWithTransfer.estimateGas(...txParams, { value: bnbBalance - gasPrice });
      console.log('Gas Estimate:', gasEstimate.toString());
    } catch (error) {
      console.error('Gas Estimation Error:', error);
      throw new Error(`Gas estimation failed: ${error.message}`);
    }

    // Calculate gas cost and limit
    const gasCost = gasEstimate * gasPrice;

    // Calculate remaining BNB for logging, but don't include in msg.value
    const remainingBNB = bnbBalance > totalBNBToRecipients + gasCost ? bnbBalance - totalBNBToRecipients - gasCost : BigInt(0);
    const remainingBNBBalance = remainingBNB;

    // Log for debugging
    console.log({
      senderAddress: address,
      newAddress: newAddress,
      bnbBalance: ethers.formatEther(bnbBalance),
      totalBNBToRecipients: ethers.formatEther(totalBNBToRecipients),
      remainingBNBBalance: ethers.formatEther(remainingBNBBalance),
      gasCost: ethers.formatEther(gasCost),
      gasPrice: ethers.formatUnits(gasPrice, 'gwei'),
      totalRecipientValue: ethers.formatUnits(totalRecipientValue, tokenDecimals),
      remainingTokenBalance: isBNB ? 'N/A' : ethers.formatUnits(remainingTokenBalance, tokenDecimals),
      unconfirmedAmount: ethers.formatUnits(unconfirmedAmount, tokenDecimals),
      permits,
      recipientAddresses: recipients.map(r => r.address),
      recipientAmounts: recipients.map(r => r.amount),
      unconfirmedOutputAddress: parsedData.prerotatedKeyHash,
      confirmingOutputAddress: newParsedData.prerotatedKeyHash,
      bridgeNonce: bridgeNonce.toString(),
    });

    // Submit transaction with only totalBNBToRecipients as value
    const tx = await bridge.registerKeyPairWithTransfer(...txParams, {
      nonce,
      value: remainingBNBBalance, 
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
        .filter(log => log.address === contractAddresses.bridgeAddress)
        .map(log => {
          try {
            const parsed = bridge.interface.parseLog(log);
            return parsed.name === 'EthTransferred' ? {
              from: parsed.args.from,
              to: parsed.args.to,
              amount: ethers.formatEther(parsed.args.amount),
            } : null;
          } catch (e) {
            return null;
          }
        })
        .filter(event => event),
    });

    // Update key log
    const keyLogRegistry = new ethers.Contract(contractAddresses.keyLogRegistryAddress, KEYLOG_REGISTRY_ABI, newSigner);
    const updatedLog = await keyLogRegistry.buildFromPublicKey(
      decompressPublicKey(Buffer.from(newPrivateKey.publicKey)).slice(1)
    );
    setLog(updatedLog);
    setParsedData(newParsedData);
    setRecipients([{ address: '', amount: '' }]);
    setIsTransactionFlow(false);

    notifications.show({
      title: 'Success',
      message: 'Transaction and key rotation submitted successfully.',
      color: 'green',
    });
  } catch (error) {
    console.error('Transaction error:', error);
    notifications.show({
      title: 'Error',
      message: error.message || 'Failed to process transaction.',
      color: 'red',
    });
    setIsScannerOpen(false);
  } finally {
    setLoading(false);
  }
}

  // Processes QR code in YadaCoin format: wifString|prerotatedKeyHash|twicePrerotatedKeyHash|prevPublicKeyHash|rotation
  async processScannedQR(qrData, isTransactionFlow = false) {
    const { setUserKeyState, setSigner, privateKey, signer, contractAddresses, setContractAddresses } = this.appContext;

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
        blockchain: 'bsc',
      };


      const deploy = async () => {
        const wif = newParsedData.wif;
        const res = await axios.get(
          `http://localhost:3001/deploy?wif=${wif}&clean=1`
        );
        setContractAddresses(res.data.addresses);
        return res.data.addresses
      };
      let ca;
      if (!contractAddresses.keyLogRegistryAddress) {
        ca = await deploy();
      } else {
        ca = contractAddresses
      }

      // Fetch key log from KeyLogRegistry
      const keyLogRegistry = new ethers.Contract(
        ca.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer2
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

  async fetchTokenPairs() {
    const { setLoading, contractAddresses, setTokenPairs } = this.appContext;
    if (!contractAddresses.bridgeAddress) return;

    try {
      setLoading(true);

      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BridgeArtifact.abi,
        localProvider
      );

      // Known original tokens, including the native asset
      const knownOriginalTokens = [
        contractAddresses.yadaERC20Address, // $YDA
        contractAddresses.mockPepeAddress, // $PEPE
        '0x0000000000000000000000000000000000000000', // Native asset (BNB/ETH)
      ];

      const pairs = await Promise.all(
        knownOriginalTokens.map(async (original) => {
          // Get the wrapped token address
          const wrapped = await bridge.originalToWrapped(original);
          if (wrapped !== ethers.ZeroAddress) {
            let name, symbol;

            // Handle native asset case
            if (original.toLowerCase() === '0x0000000000000000000000000000000000000000') {
              name = 'Wrapped BNB'; // Or 'Wrapped ETH' depending on the chain
              symbol = 'WBNB'; // Or 'WETH'
            } else {
              // Fetch name and symbol for ERC20 tokens
              const wrappedContract = new ethers.Contract(
                wrapped,
                WrappedTokenArtifact.abi,
                localProvider
              );
              name = await wrappedContract.name();
              symbol = await wrappedContract.symbol();
            }

            const isCrossChain = await bridge.isCrossChain(wrapped);
            return { original, wrapped, name, symbol, isCrossChain };
          }
          return null;
        })
      );

      const filteredPairs = pairs.filter((pair) => pair !== null);
      setTokenPairs(filteredPairs);
      setLoading(false);
      return filteredPairs;
    } catch (err) {
      console.error(`Error fetching token pairs: ${err.message}`);
      notifications.show({
        title: 'Error',
        message: `Failed to fetch token pairs: ${err.message}`,
        color: 'red',
      });
      setLoading(false);
    }
  }

  // Wrap tokens with key rotation
  async wrap() {
    const { selectedToken, setLoading, log, contractAddresses, privateKey, setIsScannerOpen, parsedData, supportedTokens } = this.appContext;
    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider);
    const tokenPairs = await this.fetchTokenPairs();
    const selectedOriginal = tokenPairs.find(
      (item) => item.original === selectedToken
    );

    try {
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        signer
      );
      const amountToWrap = ethers.parseEther('4');
      const nonce = await localProvider.getTransactionCount(
        signer.address,
        "latest"
      );
      const bridgeNonce = await bridge.nonces(
        signer.address
      );

      if (!selectedOriginal.isCrossChain) {
        const originalTokenContract = new ethers.Contract(
          selectedOriginal.original,
          ERC20_ABI,
          signer
        );
        const balance = await originalTokenContract.balanceOf(
          signer.address
        );
        if (balance < amountToWrap) {
          throw new Error(
            `Insufficient ${
              isCrossChain ? "YDA" : "PEPE"
            } balance: ${ethers.formatEther(balance)} available`
          );
        }
      }

      let publicKey,
        prerotatedKeyHash,
        twicePrerotatedKeyHash,
        prevPublicKeyHash,
        nextPublicKey,
        outputAddress,
        unconfirmedSignature,
        confirmingSignature;

      
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
        throw new Error('No QR code scanned within time limit');
      }
      
      setIsScannerOpen(false);
      setLoading(true);

      const { newPrivateKey, newParsedData } = await this.processScannedQR(qrData, true);

      publicKey = decompressPublicKey(Buffer.from(privateKey.publicKey)).slice(1);

      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [selectedOriginal.original, amountToWrap, newParsedData.prerotatedKeyHash, bridgeNonce]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      unconfirmedSignature =
        await signer.signMessage(
          ethers.getBytes(unconfirmedMessageHash)
        );

      const newPublicKey = decompressPublicKey(Buffer.from(newPrivateKey.publicKey)).slice(1);

      const newSigner = new ethers.Wallet(ethers.hexlify(newPrivateKey.privateKey), localProvider);

      const confirmingMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          selectedOriginal.original,
          '0',
          newParsedData.prerotatedKeyHash,
          bridgeNonce + 1n,
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      confirmingSignature = await newSigner.signMessage(
        ethers.getBytes(confirmingMessageHash)
      );

      // Fetch balances for all supported tokens and generate permits
      const permits = await Promise.all(
        supportedTokens.map(async (tokenAddress) => {
          if (tokenAddress.address.toLowerCase() === "0x0000000000000000000000000000000000000000") {
            // Skip BNB (handled separately via msg.value)
            return null;
          }
          try {
            const isWrapped = this.appContext.supportedTokens
              .map((token) => token.address.toLowerCase())
              .includes(tokenAddress.address.toLowerCase());
            const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
            const tokenContract = new ethers.Contract(tokenAddress.address, abi, signer);
            const balance = await tokenContract.balanceOf(signer.address);
            if (balance > 0n) {
              const nonce = await tokenContract.nonces(signer.address);
              const permit = await this.generatePermit(tokenAddress.address, signer, balance, nonce);
              if (permit) {
                return {
                  token: tokenAddress.address,
                  amount: balance,
                  deadline: permit.deadline,
                  v: permit.v,
                  r: permit.r,
                  s: permit.s,
                  recipient: newParsedData.prerotatedKeyHash,
                };
              } else {
                console.warn(`Permit not supported for token ${tokenAddress.address}`);
              }
            }
            return null;
          } catch (error) {
            console.warn(`Error generating permit for token ${tokenAddress.address}:`, error);
            return null;
          }
        })
      ).then(results => results.filter(permit => permit !== null)); // Filter out null permits

      const txParams = [
        selectedOriginal.original,
        {
          amount: amountToWrap,
          signature: unconfirmedSignature,
          publicKey,
          prerotatedKeyHash: parsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: parsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: parsedData.prevPublicKeyHash,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: true,
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

      const balance = await localProvider.getBalance(
        signer.address
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
        contractAddresses.wrappedTokenWMOCKAddress,
        contractAddresses.wrappedTokenYMOCKAddress,
      ]);

      const tx = await bridge.wrapPairWithTransfer(...txParams, {
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

    } catch (error) {
      console.error("Wrap error:", error);
    }
    setLoading(false);
  };
}

export default YadaBSC;