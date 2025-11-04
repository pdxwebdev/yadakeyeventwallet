import { notifications } from "@mantine/notifications";
import axios from "axios";
import {
  fromWIF,
  generateSHA256,
  getP2PKH,
  validateBitcoinAddress,
} from "../utils/hdWallet";
import { Transaction } from "../utils/transaction";
import { capture } from "../shared/capture";
import { ethers } from "ethers";

class YadaCoin {
  constructor() {
    // No stored properties - all dependencies passed as parameters
  }

  async buildTransactionHistory(appContext, webcamRef) {
    const {
      privateKey,
      isInitialized,
      setLog,
      parsedData,
      setLoading,
      setTransactions,
      setCombinedHistory,
      setCurrentPage,
    } = appContext;

    if (!privateKey || !isInitialized) return;

    try {
      setLoading(true);
      const { log: keyEventLog } = await this.getKeyLog(appContext, privateKey);

      const keyEventTxIds = new Set(keyEventLog.map((entry) => entry.id));
      const currentAddress = getP2PKH(privateKey.publicKey);
      const currentPublicKey = Buffer.from(privateKey.publicKey).toString(
        "hex"
      );
      const currentRotation = parsedData.rotation;

      const keyLogWithTransactions = await Promise.all(
        keyEventLog.map(async (entry, index) => {
          const { transactions, totalReceived, totalSent } =
            await this.fetchTransactionsForKey(
              appContext,
              webcamRef,
              entry.public_key,
              entry.public_key_hash,
              index,
              keyEventTxIds
            );

          const keyEventTransaction = {
            id: entry.id,
            outputs: entry.outputs.map((output) => ({
              to: output.to,
              value: output.value.toFixed(8),
            })),
            date: new Date(entry.time * 1000).toLocaleDateString(),
            status: entry.mempool ? "Pending" : "Confirmed on blockchain",
            type:
              entry.outputs.length !== 1 ||
              entry.prerotated_key_hash !== entry.outputs[0].to
                ? "Unconfirmed rotation"
                : entry.prev_public_key_hash === ""
                ? "Inception"
                : "Confirming rotation",
            address: entry.public_key_hash,
            public_key: entry.public_key,
            rotation: index,
          };

          return {
            ...entry,
            transactions: [keyEventTransaction, ...transactions],
            totalReceived,
            totalSent: (
              parseFloat(totalSent) + parseFloat(entry.outputs[0].value)
            ).toFixed(8),
            type: "Key Event",
            rotation: index,
          };
        })
      );

      const currentKeyPending = await this.fetchTransactionsForKey(
        appContext,
        webcamRef,
        currentPublicKey,
        currentAddress,
        currentRotation,
        keyEventTxIds
      );

      setTransactions(keyLogWithTransactions);

      const combined = [
        ...keyLogWithTransactions.flatMap((entry) =>
          entry.transactions.map((txn) => ({
            ...txn,
            rotation: entry.rotation,
            public_key_hash: entry.public_key_hash,
          }))
        ),
        ...currentKeyPending.transactions.map((txn) => ({
          ...txn,
          rotation: currentRotation,
          public_key_hash: currentAddress,
        })),
      ];

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

  async checkInitializationStatus(appContext, webcamRef) {
    const { privateKey, parsedData } = appContext;

    if (!privateKey || !parsedData) {
      return { status: "no_private_key" };
    }

    try {
      const { isValidKey, log: keyEventLog } = await this.getKeyLog(
        appContext,
        privateKey
      );
      const address = getP2PKH(privateKey.publicKey);

      if (!isValidKey) {
        return { status: "error" };
      }

      if (keyEventLog.length > 0) {
        const latestLogEntry = keyEventLog[keyEventLog.length - 1];
        if (latestLogEntry && latestLogEntry.public_key_hash === address) {
          return { status: "active" };
        }
      }

      const isKeyInLog = keyEventLog.some(
        (entry) => !entry.mempool && entry.public_key_hash === address
      );
      if (isKeyInLog) {
        const logEntry = keyEventLog.find(
          (entry) => !entry.mempool && entry.public_key_hash === address
        );
        const isValidContinuity =
          (parsedData.rotation === 0 && !parsedData.prevPublicKeyHash) ||
          (parsedData.prevPublicKeyHash &&
            keyEventLog.some(
              (e) =>
                !e.mempool && e.public_key_hash === parsedData.prevPublicKeyHash
            ) &&
            logEntry.prerotated_key_hash === parsedData.prerotatedKeyHash &&
            logEntry.twice_prerotated_key_hash ===
              parsedData.twicePrerotatedKeyHash);

        if (!isValidContinuity) {
          return { status: "invalid_continuity" };
        }
        return { status: "revoked" };
      }

      if (parsedData.rotation === keyEventLog.length) {
        if (keyEventLog.length > 0) {
          const lastLogEntry = keyEventLog[keyEventLog.length - 1];
          const isValidContinuity =
            lastLogEntry.public_key_hash === parsedData.prevPublicKeyHash &&
            lastLogEntry.prerotated_key_hash === address &&
            lastLogEntry.twice_prerotated_key_hash ===
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

  async checkStatus(appContext, webcamRef) {
    const { setIsInitialized, parsedData, log } = appContext;

    const initStatus = await this.checkInitializationStatus(
      appContext,
      webcamRef
    );
    if (initStatus.status === "pending_mempool") {
      notifications.show({
        title: "Pending Transaction",
        message: "Waiting for transaction confirmation in mempool.",
        color: "yellow",
      });
    } else if (initStatus.status === "active") {
      setIsInitialized(true);
      localStorage.setItem("walletIsInitialized", "true");
    } else if (initStatus.status === "revoked") {
      setIsInitialized(true);
      localStorage.setItem("walletIsInitialized", "true");
      notifications.show({
        title: "Key Revoked",
        message: `Key at rotation ${parsedData.rotation} is revoked. Please scan the next key (rotation ${log.length}) to sign transactions.`,
        color: "yellow",
      });
    } else if (initStatus.status === "no_transaction") {
      notifications.show({
        title: "No Key Event Log Entry",
        message: "Submitting wallet initialization transaction.",
        color: "yellow",
      });
      await this.initializeKeyEventLog(appContext, webcamRef);
    } else if (
      initStatus.status === "invalid_rotation" ||
      initStatus.status === "invalid_continuity"
    ) {
      notifications.show({
        title:
          initStatus.status === "invalid_rotation"
            ? "Invalid Key Rotation"
            : "Invalid Key Continuity",
        message:
          initStatus.status === "invalid_rotation"
            ? `Expected key rotation ${log.length}, but current key is rotation ${parsedData.rotation}. Please scan the correct key.`
            : "The key does not maintain continuity with the key event log. Please scan a valid key.",
        color: "red",
      });
    } else if (initStatus.status === "error") {
      notifications.show({
        title: "Error",
        message:
          "An error occurred while checking wallet status. Please scan the key again.",
        color: "red",
      });
    }
  }

  async fetchFeeEstimate(appContext, webcamRef) {
    const { setFeeEstimate } = appContext;
    try {
      const response = await axios.get(
        `${import.meta.env.VITE_API_URL}/fee-estimate`
      );
      setFeeEstimate(response.data);
    } catch (error) {
      console.error("Error fetching fee estimate:", error);
      notifications.show({
        title: "Error",
        message: "Failed to load fee estimate",
        color: "red",
      });
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
        webcamRef,
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

  async fetchBalance(appContext, webcamRef) {
    const { privateKey, isInitialized, setLoading, setBalance, setSymbol } =
      appContext;
    setSymbol("yda");

    if (privateKey && isInitialized) {
      try {
        const { log: keyEventLog } = await this.getKeyLog(
          appContext,
          privateKey
        );
        if (keyEventLog.length <= 0) return;
        const address = keyEventLog[keyEventLog.length - 1].prerotated_key_hash;

        setLoading(true);
        const response = await axios.get(
          `${import.meta.env.VITE_API_URL}/get-graph-wallet?address=${address}`
        );

        setBalance(
          parseFloat(response.data.chain_balance) +
            parseFloat(response.data.pending_balance)
        );
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
  }

  async fetchTransactionsForKey(
    appContext,
    webcamRef,
    publicKey,
    address,
    rotation,
    keyEventTxIds
  ) {
    try {
      const endpoints = [
        {
          key: "past_transactions",
          status: "Confirmed on blockchain",
          type: "Sent",
          getUrl: (publicKey) =>
            `${
              import.meta.env.VITE_API_URL
            }/get-past-sent-txns?page=1&public_key=${publicKey}&include_zero=1&origin=${encodeURIComponent(
              window.location.origin
            )}`,
        },
        {
          key: "past_pending_transactions",
          status: "Pending",
          type: "Sent",
          getUrl: (publicKey) =>
            `${
              import.meta.env.VITE_API_URL
            }/get-past-pending-sent-txns?page=1&public_key=${publicKey}&include_zero=1&origin=${encodeURIComponent(
              window.location.origin
            )}`,
        },
        {
          key: "past_transactions",
          status: "Confirmed on blockchain",
          type: "Received",
          getUrl: (publicKey) =>
            `${
              import.meta.env.VITE_API_URL
            }/get-past-received-txns?page=1&public_key=${publicKey}&include_zero=1&origin=${encodeURIComponent(
              window.location.origin
            )}`,
        },
        {
          key: "past_pending_transactions",
          status: "Pending",
          type: "Received",
          getUrl: (publicKey) =>
            `${
              import.meta.env.VITE_API_URL
            }/get-past-pending-received-txns?page=1&public_key=${publicKey}&include_zero=1&origin=${encodeURIComponent(
              window.location.origin
            )}`,
        },
      ];

      let transactionsForKey = [];
      let totalReceivedForKey = 0;
      let totalSentForKey = 0;

      for (const endpoint of endpoints) {
        const url = endpoint.getUrl(publicKey);
        try {
          const response = await fetch(url);
          if (!response.ok) {
            console.warn(`Failed to fetch ${url}: ${response.statusText}`);
            continue;
          }
          const data = await response.json();
          const txns = (data[endpoint.key] || [])
            .filter(
              (tx) => !keyEventTxIds.has(tx.id || tx.txid || tx.transaction_id)
            )
            .map((tx) => {
              let outputs = tx.outputs.map((output) => ({
                to: output.to,
                value: output.value.toFixed(8),
              }));

              const receivedAmount = tx.outputs
                .reduce(
                  (sum, output) =>
                    output.to === address ? sum + output.value : sum,
                  0
                )
                .toFixed(8);
              const sentAmount = tx.outputs
                .reduce(
                  (sum, output) =>
                    output.to !== address ? sum + output.value : sum,
                  0
                )
                .toFixed(8);

              if (endpoint.type === "Received") {
                totalReceivedForKey += parseFloat(receivedAmount);
              } else if (endpoint.type === "Sent") {
                totalSentForKey += parseFloat(sentAmount);
              }

              const txId = tx.id || tx.txid || tx.transaction_id || "Unknown";

              return {
                id: txId,
                outputs,
                date: new Date(tx.time * 1000).toLocaleDateString(),
                status: endpoint.status,
                type:
                  endpoint.type === "Sent"
                    ? "Sent Transaction"
                    : "Received Transaction",
                address,
                public_key: publicKey,
                rotation,
              };
            });
          transactionsForKey.push(...txns);
        } catch (error) {
          console.warn(`Error fetching ${url}:`, error);
          continue;
        }
      }

      return {
        transactions: transactionsForKey,
        totalReceived: totalReceivedForKey.toFixed(8),
        totalSent: totalSentForKey.toFixed(8),
      };
    } catch (error) {
      console.error(`Error fetching transactions for key ${publicKey}:`, error);
      notifications.show({
        title: "Error",
        message: `Failed to load transactions for key ${publicKey.slice(
          0,
          8
        )}...`,
        color: "red",
      });
      return { transactions: [], totalReceived: "0", totalSent: "0" };
    }
  }

  async getKeyLog(appContext, privateKey) {
    const privk = privateKey;
    const pk = Buffer.from(privk.publicKey).toString("hex");
    try {
      const res = await axios.get(
        `${
          import.meta.env.VITE_API_URL
        }/key-event-log?username_signature=asdf&public_key=${pk}`
      );
      return { isValidKey: true, log: res.data.key_event_log || [] };
    } catch (error) {
      console.error("Error fetching key event log:", error);
      notifications.show({
        title: "Error",
        message: "Failed to load key event log",
        color: "red",
      });
      return { isValidKey: false, log: [] };
    }
  }

  async initializeKeyEventLog(appContext, webcamRef) {
    const {
      privateKey,
      isSubmitting,
      setIsSubmitting,
      parsedData,
      setLoading,
    } = appContext;

    if (!privateKey || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const address = getP2PKH(privateKey.publicKey);
      const transactionOutputs = [
        { to: parsedData.prerotatedKeyHash, value: 0 },
      ];

      const txn = new Transaction({
        key: privateKey,
        public_key: Buffer.from(privateKey.publicKey).toString("hex"),
        twice_prerotated_key_hash: parsedData.twicePrerotatedKeyHash,
        prerotated_key_hash: parsedData.prerotatedKeyHash,
        inputs: [],
        outputs: transactionOutputs,
        relationship: "",
        relationship_hash: await generateSHA256(""),
        public_key_hash: address,
        prev_public_key_hash: parsedData.prevPublicKeyHash || "",
      });

      await txn.hashAndSign();
      setLoading(true);
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/transaction?origin=${
          window.location.origin
        }&username_signature=1`,
        txn.toJson(),
        { headers: { "Content-Type": "application/json" } }
      );

      if (response.status === 200) {
        notifications.show({
          title: "Success",
          message: "Zero-value transaction submitted for wallet initialization",
          color: "green",
        });
      } else {
        throw new Error("Transaction submission failed");
      }
    } catch (error) {
      console.error("Error initializing key event log:", error);
      notifications.show({
        title: "Error",
        message: `Failed to initialize wallet: ${error.message}`,
        color: "red",
      });
    } finally {
      setIsSubmitting(false);
      setLoading(false);
    }
  }

  async processScannedQR(
    appContext,
    webcamRef,
    qrData,
    isTransactionFlow = false
  ) {
    const { setLog, log } = appContext;

    try {
      const [
        wifString,
        prerotatedKeyHash,
        twicePrerotatedKeyHash,
        prevPublicKeyHash,
        rotation,
      ] = qrData.split("|");
      if (
        !validateBitcoinAddress(prerotatedKeyHash) ||
        !validateBitcoinAddress(twicePrerotatedKeyHash)
      ) {
        throw new Error(
          "Incorrect blockchain selected on device. Restart the device and select YadaCoin."
        );
      }

      if (
        parseInt(rotation) !== (isTransactionFlow ? log.length + 1 : log.length)
      ) {
        throw new Error(
          `Incorrect rotation scanned from device. Set the rotation on the device to ${
            isTransactionFlow ? log.length + 1 : log.length
          }.`
        );
      }
      const newPrivateKey = fromWIF(wifString);
      const publicKeyHash = getP2PKH(newPrivateKey.publicKey);
      const newParsedData = {
        publicKeyHash,
        wif: wifString,
        prerotatedKeyHash,
        twicePrerotatedKeyHash,
        prevPublicKeyHash,
        rotation: parseInt(rotation, 10),
        blockchain: "yda",
      };

      const { isValidKey, log: fetchedLog } = await this.getKeyLog(
        appContext,
        newPrivateKey
      );
      if (!isValidKey) {
        throw new Error("Failed to fetch key event log");
      }

      this.validateKeyContinuity(
        appContext,
        newParsedData,
        fetchedLog,
        isTransactionFlow
      );
      setLog(fetchedLog);
      return { newPrivateKey, newParsedData };
    } catch (error) {
      console.error("QR code parsing error:", error);
      throw error;
    }
  }

  async fetchLog(appContext, webcamRef) {
    const { privateKey, setLog } = appContext;
    const { isValidKey, log: fetchedLog } = await this.getKeyLog(
      appContext,
      privateKey
    );
    setLog(fetchedLog);
    return fetchedLog;
  }

  async signTransaction(appContext, webcamRef) {
    const {
      privateKey,
      recipients,
      parsedData,
      feeEstimate,
      balance,
      setIsTransactionFlow,
      setIsScannerOpen,
      setPrivateKey,
      setWif,
      setParsedData,
      setRecipients,
      setLoading,
      setLog,
    } = appContext;

    if (!privateKey || recipients.length === 0) {
      notifications.show({
        title: "Error",
        message: "Please provide private key and at least one recipient",
        color: "red",
      });
      return;
    }

    const invalidRecipient = recipients.find(
      (r) =>
        !r.address ||
        !r.amount ||
        isNaN(r.amount) ||
        Number(r.amount) <= 0 ||
        !validateBitcoinAddress(r.address)
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
      (sum, r) => sum + Number(r.amount),
      0
    );
    const transactionFee =
      feeEstimate?.status === "congested"
        ? feeEstimate.fee_estimate.median_fee
        : feeEstimate?.recommended_fee || 0.0;

    try {
      notifications.show({
        title: "Key Rotation Required",
        message: `Please rotate your key to rotation ${
          parsedData.rotation + 1
        } on your device and scan the new QR code to proceed with the transaction.`,
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
        setIsScannerOpen(false);
        throw new Error("No QR code scanned within time limit");
      }

      setIsScannerOpen(false);
      const { newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        webcamRef,
        qrData,
        true
      );

      try {
        const address = getP2PKH(privateKey.publicKey);
        const res = await axios.get(
          `${
            import.meta.env.VITE_API_URL
          }/get-graph-wallet?address=${address}&amount_needed=${balance}`
        );
        const newUnspent = res.data.unspent_transactions.concat(
          res.data.unspent_mempool_txns
        );
        const inputs = newUnspent.reduce(
          (accumulator, utxo) => {
            if (accumulator.total >= totalAmount + transactionFee)
              return accumulator;

            const utxoValue = utxo.outputs.reduce((sum, output) => {
              if (output.to !== address) return sum;
              return sum + output.value;
            }, 0);
            accumulator.selected.push({ id: utxo.id });
            accumulator.total += utxoValue;
            return accumulator;
          },
          { selected: [], total: 0 }
        );

        if (inputs.total < totalAmount + transactionFee) {
          throw new Error("Insufficient funds");
        }

        const transactionOutputs = recipients.map((r) => ({
          to: validateBitcoinAddress(r.address),
          value: Number(r.amount),
        }));

        transactionOutputs.push({
          to: parsedData.prerotatedKeyHash,
          value: balance - totalAmount - transactionFee,
        });

        const actualTxn = new Transaction({
          key: privateKey,
          public_key: Buffer.from(privateKey.publicKey).toString("hex"),
          twice_prerotated_key_hash: parsedData.twicePrerotatedKeyHash,
          prerotated_key_hash: parsedData.prerotatedKeyHash,
          inputs: inputs.selected,
          outputs: transactionOutputs,
          relationship: "",
          relationship_hash: await generateSHA256(""),
          public_key_hash: getP2PKH(privateKey.publicKey),
          prev_public_key_hash: parsedData.prevPublicKeyHash,
          fee: transactionFee,
        });
        await actualTxn.hashAndSign();

        let newTransactionOutputs = [
          {
            to: newParsedData.prerotatedKeyHash,
            value: balance - totalAmount - transactionFee,
          },
        ];

        const zeroValueTxn = new Transaction({
          key: newPrivateKey,
          public_key: Buffer.from(newPrivateKey.publicKey).toString("hex"),
          twice_prerotated_key_hash: newParsedData.twicePrerotatedKeyHash,
          prerotated_key_hash: newParsedData.prerotatedKeyHash,
          inputs: [{ id: actualTxn.id }],
          outputs: newTransactionOutputs,
          relationship: "",
          relationship_hash: await generateSHA256(""),
          public_key_hash: getP2PKH(newPrivateKey.publicKey),
          prev_public_key_hash: getP2PKH(privateKey.publicKey),
          fee: 0,
        });
        await zeroValueTxn.hashAndSign();

        setLoading(true);
        const actualResponse = await axios.post(
          `${import.meta.env.VITE_API_URL}/transaction?origin=${
            window.location.origin
          }&username_signature=1`,
          [actualTxn.toJson(), zeroValueTxn.toJson()],
          { headers: { "Content-Type": "application/json" } }
        );

        if (actualResponse.status === 200) {
          localStorage.removeItem("walletPrivateKey");
          localStorage.removeItem("walletWif");
          localStorage.removeItem("walletParsedData");
          localStorage.removeItem("walletIsInitialized");

          setPrivateKey(newPrivateKey);
          setWif(newParsedData.wif);
          setParsedData(newParsedData);
          setRecipients([{ address: "", amount: "" }]);
          setIsTransactionFlow(false);

          const { isValidKey, log: fetchedLog } = await this.getKeyLog(
            appContext,
            newPrivateKey
          );
          setLog(fetchedLog);
          notifications.show({
            title: "Success",
            message:
              "Transaction and key rotation confirmation submitted successfully.",
            color: "green",
          });
        } else {
          throw new Error("Transaction or confirmation submission failed");
        }
      } catch (error) {
        throw new Error(`Failed to process transaction: ${error.message}`);
      }
    } catch (error) {
      notifications.show({
        title: "Error",
        message:
          error.message || "Failed to process QR code. Please try again.",
        color: "red",
      });
      setIsScannerOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async wrap(appContext, webcamRef, wrapAmount, wrapAddress) {
    const {
      privateKey,
      parsedData,
      feeEstimate,
      balance,
      setIsTransactionFlow,
      setIsScannerOpen,
      setPrivateKey,
      setWif,
      setParsedData,
      setLoading,
      setLog,
      setRecipients,
    } = appContext;
    const recipients = [
      {
        address: wrapAddress,
        amount: wrapAmount,
      },
    ];

    if (!privateKey || recipients.length === 0) {
      notifications.show({
        title: "Error",
        message: "Please provide private key and at least one recipient",
        color: "red",
      });
      return;
    }

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
        message: "Your wrap address and amount must be valid",
        color: "red",
      });
      return;
    }

    const totalAmount = recipients.reduce(
      (sum, r) => sum + Number(r.amount),
      0
    );
    const transactionFee =
      feeEstimate?.status === "congested"
        ? feeEstimate.fee_estimate.median_fee
        : feeEstimate?.recommended_fee || 0.0;

    try {
      notifications.show({
        title: "Key Rotation Required",
        message: `Please rotate your key to rotation ${
          parsedData.rotation + 1
        } on your device and scan the new QR code to proceed with the transaction.`,
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
        setIsScannerOpen(false);
        throw new Error("No QR code scanned within time limit");
      }

      setIsScannerOpen(false);
      const { newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        webcamRef,
        qrData,
        true
      );

      try {
        const address = getP2PKH(privateKey.publicKey);
        const res = await axios.get(
          `${
            import.meta.env.VITE_API_URL
          }/get-graph-wallet?address=${address}&amount_needed=${balance}`
        );
        const newUnspent = res.data.unspent_transactions.concat(
          res.data.unspent_mempool_txns
        );
        const inputs = newUnspent.reduce(
          (accumulator, utxo) => {
            if (accumulator.total >= totalAmount + transactionFee)
              return accumulator;
            const utxoValue = utxo.outputs.reduce((sum, output) => {
              if (output.to !== address) return sum;
              return sum + output.value;
            }, 0);
            accumulator.selected.push({ id: utxo.id });
            accumulator.total += utxoValue;
            return accumulator;
          },
          { selected: [], total: 0 }
        );

        if (inputs.total < totalAmount + transactionFee) {
          throw new Error("Insufficient funds");
        }

        const transactionOutputs = [
          {
            to: "16U1gAmHazqqEkbRE9KFPShAperjJreMRA",
            value: Number(recipients[0].amount),
          },
        ];

        transactionOutputs.push({
          to: parsedData.prerotatedKeyHash,
          value: balance - totalAmount - transactionFee,
        });

        const actualTxn = new Transaction({
          key: privateKey,
          public_key: Buffer.from(privateKey.publicKey).toString("hex"),
          twice_prerotated_key_hash: parsedData.twicePrerotatedKeyHash,
          prerotated_key_hash: parsedData.prerotatedKeyHash,
          inputs: inputs.selected,
          outputs: transactionOutputs,
          relationship: wrapAddress,
          relationship_hash: await generateSHA256(wrapAddress),
          public_key_hash: getP2PKH(privateKey.publicKey),
          prev_public_key_hash: parsedData.prevPublicKeyHash,
          fee: transactionFee,
        });
        await actualTxn.hashAndSign();

        let newTransactionOutputs = [
          {
            to: newParsedData.prerotatedKeyHash,
            value: balance - totalAmount - transactionFee,
          },
        ];

        const zeroValueTxn = new Transaction({
          key: newPrivateKey,
          public_key: Buffer.from(newPrivateKey.publicKey).toString("hex"),
          twice_prerotated_key_hash: newParsedData.twicePrerotatedKeyHash,
          prerotated_key_hash: newParsedData.prerotatedKeyHash,
          inputs: [{ id: actualTxn.id }],
          outputs: newTransactionOutputs,
          relationship: "",
          relationship_hash: await generateSHA256(""),
          public_key_hash: getP2PKH(newPrivateKey.publicKey),
          prev_public_key_hash: getP2PKH(privateKey.publicKey),
          fee: 0,
        });
        await zeroValueTxn.hashAndSign();

        setLoading(true);
        const actualResponse = await axios.post(
          `${import.meta.env.VITE_API_URL}/transaction?origin=${
            window.location.origin
          }&username_signature=1`,
          [actualTxn.toJson(), zeroValueTxn.toJson()],
          { headers: { "Content-Type": "application/json" } }
        );

        if (actualResponse.status === 200) {
          localStorage.removeItem("walletPrivateKey");
          localStorage.removeItem("walletWif");
          localStorage.removeItem("walletParsedData");
          localStorage.removeItem("walletIsInitialized");

          setPrivateKey(newPrivateKey);
          setWif(newParsedData.wif);
          setParsedData(newParsedData);
          setRecipients([{ address: "", amount: "" }]);
          setIsTransactionFlow(false);

          const { isValidKey, log: fetchedLog } = await this.getKeyLog(
            appContext,
            newPrivateKey
          );
          setLog(fetchedLog);
          notifications.show({
            title: "Success",
            message:
              "Transaction and key rotation confirmation submitted successfully.",
            color: "green",
          });
        } else {
          throw new Error("Transaction or confirmation submission failed");
        }
      } catch (error) {
        throw new Error(`Failed to process transaction: ${error.message}`);
      }
    } catch (error) {
      notifications.show({
        title: "Error",
        message:
          error.message || "Failed to process QR code. Please try again.",
        color: "red",
      });
      setIsScannerOpen(false);
    } finally {
      setLoading(false);
    }
  }

  validateKeyContinuity(
    appContext,
    newParsedData,
    fetchedLog,
    isTransactionFlow
  ) {
    const { parsedData, isInitialized } = appContext;
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

      const isValidContinuity =
        isTransactionFlow && isInitialized
          ? newParsedData.publicKeyHash === parsedData.prerotatedKeyHash &&
            newParsedData.prerotatedKeyHash ===
              parsedData.twicePrerotatedKeyHash &&
            (!newParsedData.prevPublicKeyHash ||
              parsedData.publicKeyHash === newParsedData.prevPublicKeyHash)
          : lastEntry.prerotated_key_hash === newPublicKeyHash &&
            lastEntry.twice_prerotated_key_hash ===
              newParsedData.prerotatedKeyHash &&
            (!newParsedData.prevPublicKeyHash ||
              lastEntry.public_key_hash === newParsedData.prevPublicKeyHash);
      if (!isValidContinuity) {
        throw new Error(
          `The scanned key (rotation ${newParsedData.rotation}) does not maintain continuity with the previous key`
        );
      }
    }
    return true;
  }
}

export default YadaCoin;
