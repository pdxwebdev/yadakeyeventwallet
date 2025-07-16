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

const BRIDGE_ABI = BridgeArtifact.abi;
const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
const ERC20_ABI = MockERC20Artifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;

class YadaBSC {
  constructor(appContext) {
    this.appContext = appContext;
  }

  // Helper to generate EIP-2612 permit
  async generatePermit(tokenAddress, signer, amount) {
    const isWrapped = this.appContext.tokenPairs
      .map((pair) => pair.wrapped.toLowerCase())
      .includes(tokenAddress.toLowerCase());
    const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
    const token = new ethers.Contract(tokenAddress, abi, signer);

    try {
      const name = await token.name();
      const domain = {
        name,
        version: "1",
        chainId: 56, // BSC mainnet; adjust for testnet (97) if needed
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
  async buildTransactionHistory() {
    const {
      privateKey,
      userKeyState,
      setLog,
      setLoading,
      setTransactions,
      setCombinedHistory,
      setCurrentPage,
    } = this.appContext;

    if (!privateKey || !userKeyState) return;
    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider)
    
    try {
      setLoading(true);
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);

      // Fetch key log entries
      const currentPublicKey = decompressPublicKey(Buffer.from(privateKey.publicKey)).slice(1)
      const log = await keyLogRegistry.buildFromPublicKey(currentPublicKey);
      setLog(log );

      const keyEventTxIds = new Set(log.map((entry) => entry.publicKeyHash));
      const currentAddress = await signer.getAddress();
      const currentRotation = log.length;

      // Map key log entries to transaction-like objects
      const keyLogWithTransactions = await Promise.all(
        log.map(async (entry, index) => {
          const { transactions, totalReceived, totalSent } =
            await this.fetchTransactionsForKey(
              entry.publicKeyHash,
              index,
              keyEventTxIds
            );

          const keyEventTransaction = {
            id: entry.publicKeyHash,
            outputs: [
              {
                to: entry.outputAddress,
                value: ethers.formatEther(0), // Key events typically have zero value
              },
            ],
            date: new Date().toLocaleDateString(), // Note: Solidity logs don't store timestamps; using current date as placeholder
            status: entry.isOnChain ? "Confirmed on blockchain" : "Pending",
            type: entry.flag === 0 ? "Inception" : entry.flag === 1 ? "Unconfirmed rotation" : "Confirming rotation",
            address: entry.publicKeyHash,
            public_key: entry.publicKey,
            rotation: index,
          };

          return {
            ...entry,
            transactions: [keyEventTransaction, ...transactions],
            totalReceived: ethers.formatEther(totalReceived),
            totalSent: ethers.formatEther(totalSent),
            type: "Key Event",
            rotation: index,
          };
        })
      );

      // Fetch transactions for the current key
      const currentKeyPending = await this.fetchTransactionsForKey(
        currentAddress,
        currentRotation,
        keyEventTxIds
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
        if (a.rotation !== b.rotation) {
          return a.rotation - b.rotation;
        }
        if (a.type.includes("Key Event") && !b.type.includes("Key Event"))
          return -1;
        if (!a.type.includes("Key Event") && b.type.includes("Key Event"))
          return 1;
        return new Date(b.date) - new Date(a.date);
      });

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

  // Fetches token transfer events for a given public key hash
  async fetchTransactionsForKey(publicKeyHash, rotation, keyEventTxIds) {
    try {
      const { privateKey, tokenPairs } = this.appContext;
      if (!privateKey) return
      const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider)
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
      const supportedTokens = await bridge.getSupportedTokens();

      let transactionsForKey = [];
      let totalReceivedForKey = BigInt(0);
      let totalSentForKey = BigInt(0);

      for (const token of supportedTokens) {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, signer);
        const wrappedToken = await bridge.originalToWrapped(token);
        const isWrapped = wrappedToken !== ethers.ZeroAddress;
        const contract = isWrapped
          ? new ethers.Contract(wrappedToken, WRAPPED_TOKEN_ABI, signer)
          : tokenContract;
        const filter = contract.filters.Transfer(null, publicKeyHash);
        const events = await contract.queryFilter(filter);

        const receivedTxns = events
          .filter((event) => !keyEventTxIds.has(event.transactionHash))
          .map((event) => {
            const value = event.args.value;
            totalReceivedForKey += value;
            return {
              id: event.transactionHash,
              outputs: [{ to: publicKeyHash, value: ethers.formatEther(value) }],
              date: new Date().toLocaleDateString(), // Replace with block timestamp if available
              status: "Confirmed on blockchain",
              type: "Received Transaction",
              address: publicKeyHash,
              public_key: publicKeyHash,
              rotation,
            };
          });

        const sentFilter = contract.filters.Transfer(publicKeyHash, null);
        const sentEvents = await contract.queryFilter(sentFilter);
        const sentTxns = sentEvents
          .filter((event) => !keyEventTxIds.has(event.transactionHash))
          .map((event) => {
            const value = event.args.value;
            totalSentForKey += value;
            return {
              id: event.transactionHash,
              outputs: [{ to: event.args.to, value: ethers.formatEther(value) }],
              date: new Date().toLocaleDateString(),
              status: "Confirmed on blockchain",
              type: "Sent Transaction",
              address: publicKeyHash,
              public_key: publicKeyHash,
              rotation,
            };
          });

        transactionsForKey.push(...receivedTxns, ...sentTxns);
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
    const { userKeyState, signer } = this.appContext;

    if (!signer || !userKeyState) {
      return { status: "no_signer" };
    }

    try {
      const { log, keyState } = userKeyState;
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const publicKeyHash = await signer.getAddress();

      if (log.length === 0) {
        return { status: "no_transaction" };
      }

      const latestEntry = log[log.length - 1];
      if (latestEntry.publicKeyHash === publicKeyHash) {
        return { status: "active" };
      }

      const isKeyInLog = log.some(
        (entry) => entry.isOnChain && entry.publicKeyHash === publicKeyHash
      );
      if (isKeyInLog) {
        const logEntry = log.find(
          (entry) => entry.isOnChain && entry.publicKeyHash === publicKeyHash
        );
        const isValidContinuity =
          (log.length === 0 && !logEntry.prevPublicKeyHash) ||
          (logEntry.prevPublicKeyHash &&
            log.some(
              (e) =>
                e.isOnChain && e.publicKeyHash === logEntry.prevPublicKeyHash
            ) &&
            logEntry.prerotatedKeyHash === keyState.nextDerivedKey?.signer.address &&
            logEntry.twicePrerotatedKeyHash ===
              keyState.nextNextDerivedKey?.signer.address);

        if (!isValidContinuity) {
          return { status: "invalid_continuity" };
        }
        return { status: "revoked" };
      }

      const currentIndex = await keyLogRegistry.getCurrentIndex(
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1)
      );
      if (currentIndex === log.length) {
        if (log.length > 0) {
          const lastLogEntry = log[log.length - 1];
          const isValidContinuity =
            lastLogEntry.publicKeyHash === keyState.prevDerivedKey?.signer.address &&
            lastLogEntry.prerotatedKeyHash === publicKeyHash &&
            lastLogEntry.twicePrerotatedKeyHash ===
              keyState.nextDerivedKey?.signer.address;

          if (!isValidContinuity) {
            return { status: "invalid_continuity" };
          }
        } else if (keyState.prevDerivedKey && log.length !== 0) {
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
    const { setIsInitialized, userKeyState, setUserKeyState, signer } =
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
        message: `Key at rotation ${userKeyState.log.length} is revoked. Please scan or use the next key.`,
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
            ? `Expected key rotation ${userKeyState.log.length}, but current key is rotation ${userKeyState.log.length}. Please use the correct key.`
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

  // Fetches token balances
  async fetchBalance() {
    const { privateKey, userKeyState, setLoading, setBalance } = this.appContext;
    if (!privateKey) return
    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider)
    try {
      setLoading(true);
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
      const supportedTokens = await bridge.getSupportedTokens();
      let totalBalance = BigInt(0);
      const address = await signer.getAddress();

      for (const token of supportedTokens) {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, signer);
        const balance = await tokenContract.balanceOf(address);
        totalBalance += balance;

        const wrappedToken = await bridge.originalToWrapped(token);
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
        message: "Balance refreshed",
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
    const { privateKey, userKeyState, setUserKeyState, setLoading } = this.appContext;
    if (!privateKey) return

    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider)

    if (!signer || !userKeyState) return;

    try {
      setLoading(true);
      const { keyState } = userKeyState;
      const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );

      const publicKey =
        keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1);
      const publicKeyHash = await signer.getAddress();
      const prerotatedKeyHash = keyState.nextDerivedKey.signer.address;
      const twicePrerotatedKeyHash = keyState.nextNextDerivedKey.signer.address;
      const prevPublicKeyHash = keyState.prevDerivedKey
        ? keyState.prevDerivedKey.signer.address
        : ethers.ZeroAddress;
      const outputAddress = prerotatedKeyHash;
      const hasRelationship = false;

      const supportedTokens = await bridge.getSupportedTokens();
      const permits = [];
      const address = await signer.getAddress();
      for (const token of supportedTokens) {
        const tokenContract = new ethers.Contract(token, ERC20_ABI, signer);
        const balance = await tokenContract.balanceOf(address);
        if (balance > 0) {
          const permit = await this.generatePermit(token, signer, balance);
          if (permit) permits.push(permit);
        }
        const wrappedToken = await bridge.originalToWrapped(token);
        if (wrappedToken !== ethers.ZeroAddress) {
          const wrappedContract = new ethers.Contract(
            wrappedToken,
            WRAPPED_TOKEN_ABI,
            signer
          );
          const wrappedBalance = await wrappedContract.balanceOf(address);
          if (wrappedBalance > 0) {
            const permit = await this.generatePermit(
              wrappedToken,
              signer,
              wrappedBalance
            );
            if (permit) permits.push(permit);
          }
        }
      }

      const balance = await localProvider.getBalance(address);
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
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
        throw new Error(
          `Insufficient BNB balance: ${ethers.formatEther(balance)} BNB`
        );
      }

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

      const updatedLog = await keyLogRegistry.buildFromPublicKey(publicKey);
      const updatedKeyState = await getKeyState(
        keyState.currentDerivedKey.key,
        updatedLog,
        "defaultPassword" // Adjust password as needed
      );
      setUserKeyState({ log: updatedLog, keyState: updatedKeyState });

      notifications.show({
        title: "Success",
        message: "Key event log initialized",
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

  // Processes QR code in YadaCoin format: wifString|prerotatedKeyHash|twicePrerotatedKeyHash|prevPublicKeyHash|rotation
  async processScannedQR(qrData, isTransactionFlow = false) {
    const { setUserKeyState, setSigner } = this.appContext;

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
      const publicKey = newWallet.publicKey.slice(2); // Remove '0x' prefix
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
        signer2
      );
      const log = await keyLogRegistry.buildFromPublicKey(
        decompressPublicKey(Buffer.from(newWallet.publicKey)).slice(1)
      );

      // Validate key continuity
      this.validateKeyContinuity(newParsedData, log, isTransactionFlow);

      // Update user key state
      setUserKeyState({
        log,
        keyState: {
          currentDerivedKey: { signer: newWallet, key: { uncompressedPublicKey: decompressPublicKey(Buffer.from(newWallet.publicKey)) } },
          nextDerivedKey: { signer: { address: prerotatedKeyHash } },
          nextNextDerivedKey: { signer: { address: twicePrerotatedKeyHash } },
          prevDerivedKey: prevPublicKeyHash ? { signer: { address: prevPublicKeyHash } } : null,
        },
      });

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
      userKeyState,
      recipients,
      feeEstimate,
      balance,
      setIsTransactionFlow,
      setIsScannerOpen,
      setParsedData,
      setRecipients,
      setLoading,
      tokenPairs,
      selectedOriginal,
    } = this.appContext;

    if (!privateKey || !userKeyState || recipients.length === 0) {
      notifications.show({
        title: "Error",
        message: "Please connect wallet and provide at least one recipient",
        color: "red",
      });
      return;
    }
    if (!privateKey) return
    const signer = new ethers.Wallet(ethers.hexlify(privateKey.privateKey), localProvider)

    const invalidRecipient = recipients.find(
      (r) =>
        !r.address ||
        !r.amount ||
        isNaN(r.amount) ||
        Number(r.amount) <= 0 ||
        !ethers.isAddress(r.address)
    );
    if (invalidRecipient) {
      notifications.show({
        title: "Error",
        message: "All recipient addresses and amounts must be valid",
        color: "red",
      });
      return;
    }

    const totalAmount = recipients.reduce(
      (sum, r) => sum + ethers.parseEther(r.amount),
      BigInt(0)
    );
    const bridge = new ethers.Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);
    const isCrossChain = tokenPairs.find(
      (pair) => pair.original === selectedOriginal
    )?.isCrossChain;
    const tokenAddress = isCrossChain
      ? await bridge.originalToWrapped(selectedOriginal)
      : selectedOriginal;

    try {
      notifications.show({
        title: "Key Rotation Required",
        message: `Please scan the QR code for the next key (rotation ${userKeyState.log.length + 1}) to proceed.`,
        color: "yellow",
      });
      setIsTransactionFlow(true);
      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      const maxAttempts = 100;

      while (attempts < maxAttempts) {
        try {
          qrData = await capture(); // Assuming capture() is defined elsewhere
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

      setIsScannerOpen(false);
      const { newParsedData } = await this.processScannedQR(qrData, true);

      const { keyState } = userKeyState;
      const address = await signer.getAddress();
      const nonce = await localProvider.getTransactionCount(address, "latest");
      const bridgeNonce = await bridge.nonces(address);

      const unconfirmedMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [tokenAddress, totalAmount, newParsedData.prerotatedKeyHash, bridgeNonce]
      );
      const unconfirmedMessageHash = ethers.keccak256(unconfirmedMessage);
      const unconfirmedSignature = await signer.signMessage(
        ethers.getBytes(unconfirmedMessageHash)
      );

      const confirmingMessage = ethers.solidityPacked(
        ["address", "uint256", "address", "uint256"],
        [
          tokenAddress,
          0,
          newParsedData.twicePrerotatedKeyHash,
          bridgeNonce + 1n,
        ]
      );
      const confirmingMessageHash = ethers.keccak256(confirmingMessage);
      const confirmingSignature = newParsedData.nextSignature; // From QR code

      const permits = await this.generatePermit(tokenAddress, signer, totalAmount);
      const txParams = [
        tokenAddress,
        {
          amount: totalAmount,
          signature: unconfirmedSignature,
          publicKey: Buffer.from(newParsedData.publicKey, "hex"),
          prerotatedKeyHash: newParsedData.prerotatedKeyHash,
          twicePrerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
          prevPublicKeyHash: keyState.prevDerivedKey
            ? keyState.prevDerivedKey.signer.address
            : ethers.ZeroAddress,
          outputAddress: newParsedData.prerotatedKeyHash,
          hasRelationship: true,
          tokenSource: address,
          permits: permits ? [permits] : [],
        },
        {
          amount: ethers.parseEther("0"),
          signature: confirmingSignature,
          publicKey: Buffer.from(newParsedData.nextPublicKey, "hex"),
          prerotatedKeyHash: newParsedData.twicePrerotatedKeyHash,
          twicePrerotatedKeyHash: ethers.computeAddress(
            `0x${newParsedData.nextPublicKey}`
          ),
          prevPublicKeyHash: newParsedData.publicKeyHash,
          outputAddress: newParsedData.twicePrerotatedKeyHash,
          hasRelationship: false,
          permits: [],
        },
      ];

      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasEstimate = await bridge.wrapPairWithTransfer.estimateGas(
        ...txParams,
        { value: 0n }
      );
      const gasCost = gasEstimate * gasPrice * 2n;
      const ethBalance = await localProvider.getBalance(address);

      if (ethBalance < gasCost) {
        throw new Error(
          `Insufficient BNB balance: ${ethers.formatEther(ethBalance)} BNB`
        );
      }

      const tx = await bridge.wrapPairWithTransfer(...txParams, {
        nonce,
        value: ethBalance - gasCost,
        gasLimit: (gasEstimate * 150n) / 100n,
        gasPrice,
      });
      await tx.wait();

      const keyLogRegistry = new ethers.Contract(
        KEYLOG_REGISTRY_ADDRESS,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      const updatedLog = await keyLogRegistry.buildFromPublicKey(
        Buffer.from(newParsedData.publicKey, "hex")
      );
      const updatedKeyState = {
        currentDerivedKey: { signer },
      };
      setUserKeyState({ log: updatedLog, keyState: updatedKeyState });
      setParsedData(newParsedData);
      setRecipients([{ address: "", amount: "" }]);
      setIsTransactionFlow(false);

      notifications.show({
        title: "Success",
        message: "Transaction and key rotation submitted successfully.",
        color: "green",
      });
    } catch (error) {
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
    const { privateKey, parsedData, userKeyState, isInitialized } = this.appContext;
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