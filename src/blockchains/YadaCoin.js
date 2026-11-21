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
        if (latestLogEntry && latestLogEntry.prerotated_key_hash === address) {
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
        message: `Key at rotation ${parsedData.rotation} is revoked. Please scan the next key (rotation ${
          log.length
        }) to sign transactions.`,
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
            ? `Expected key rotation ${
                log.length
              }, but current key is rotation ${parsedData.rotation}. Please scan the correct key.`
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
      let rotationLog = log;
      if (privateKey) {
        const fetched = await this.getKeyLog(appContext, privateKey);
        if (fetched.isValidKey) {
          rotationLog = fetched.log || [];
          setLog(rotationLog);
        }
      }
      const scanRotation = rotationLog?.length || 0;
      appContext.setScanPrompt?.(`Scan YadaCoin rotation ${scanRotation}`);
      notifications.show({
        title: "Scan Key",
        message: `Scan rotation ${scanRotation} on the device.`,
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
        {
          ...appContext,
          log: rotationLog,
        },
        webcamRef,
        qrData,
        false
      );
      setParsedData(newParsedData);
      setPrivateKey(newPrivateKey);
      setWif(newParsedData.wif);
      this._persistYadaKey(newParsedData);

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
      appContext.setScanPrompt?.("");
    }
  }

  _applyBalance(appContext, value, epoch) {
    if (
      epoch !== undefined &&
      typeof appContext.getBalanceEpoch === "function" &&
      appContext.getBalanceEpoch() !== epoch
    ) {
      return;
    }
    if (typeof appContext.setBalanceForChain === "function") {
      appContext.setBalanceForChain("yda", value);
    } else if (appContext.selectedBlockchain?.id === "yda") {
      appContext.setBalance(value);
    }
  }

  async _resolveBalanceAddresses(appContext, address) {
    const { parsedData, log, privateKey } = appContext;
    const addresses = this._balanceAddresses(address, parsedData, log);
    const rotation = Number(parsedData?.rotation);
    if (
      addresses.length > 1 ||
      !privateKey ||
      !Number.isInteger(rotation) ||
      rotation <= 0
    ) {
      return addresses;
    }
    // No parent is known from the stored key or the loaded log. Resolve the
    // KEL so a mempool-only active key still picks up its funding parent.
    try {
      const { log: fetched } = await this.getKeyLog(
        { ...appContext, log: log || [] },
        privateKey
      );
      const resolved = this._balanceAddresses(address, parsedData, fetched);
      return resolved.length > addresses.length ? resolved : addresses;
    } catch {
      return addresses;
    }
  }

  async fetchBalance(appContext, addressOverride, setStateVars = true) {
    const { privateKey, parsedData, log, setLoading, setSymbol } = appContext;
    let returnVars = 0;
    const address =
      addressOverride ||
      parsedData?.publicKeyHash ||
      (privateKey ? getP2PKH(privateKey.publicKey) : "");
    if (privateKey && address) {
      // Only the newest balance request may write state. Older requests can
      // resolve after a newer one (including across a chain switch) and would
      // otherwise overwrite the correct balance with a stale zero.
      const requestId = (this._balanceRequestId =
        (this._balanceRequestId || 0) + 1);
      const epoch =
        typeof appContext.getBalanceEpoch === "function"
          ? appContext.getBalanceEpoch()
          : undefined;
      const isLatest = () => requestId === this._balanceRequestId;
      const isCurrent = () =>
        isLatest() &&
        (epoch === undefined ||
          typeof appContext.getBalanceEpoch !== "function" ||
          appContext.getBalanceEpoch() === epoch);
      try {
        setLoading(true);
        // The active signing key and the previous rotation share the identity
        // balance. The active key can spend the prior rotation's change via
        // KEL cross-key auth, so show the union under the current address.
        const addresses = await this._resolveBalanceAddresses(
          appContext,
          address
        );
        const { total } = await this._spendableUtxosForAddresses(addresses);
        returnVars = total;
        if (setStateVars && isCurrent()) {
          if (setSymbol) setSymbol("yda");
          this._applyBalance(appContext, total, epoch);
        }
        if (isCurrent()) {
          notifications.show({
            title: "Success",
            message: "Balance refreshed",
            color: "green",
          });
        }
      } catch (error) {
        console.error("Error fetching balance:", error);
        if (isCurrent()) {
          notifications.show({
            title: "Error",
            message: "Failed to load wallet balance",
            color: "red",
          });
        }
        // Keep the last known positive balance on a transient fetch error.
        const known = appContext.balance;
        const keepKnown = typeof known === "number" && known > 0;
        if (setStateVars && isCurrent() && !keepKnown) {
          this._applyBalance(appContext, null, epoch);
        }
      } finally {
        if (isLatest()) setLoading(false);
      }
    }
    return returnVars;
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

  async _fetchMempoolTransactions() {
    const txns = [];
    const pageSize = 100;
    for (let page = 1; page <= 20; page++) {
      const res = await axios.get(
        `${import.meta.env.VITE_API_URL}/get-mempool?page=${page}&page_size=${pageSize}`
      );
      const batch = res.data?.transactions || [];
      txns.push(...batch.map((tx) => ({ ...tx, mempool: true })));
      const total = res.data?.total;
      if (!batch.length || (total != null && txns.length >= total)) break;
    }
    return txns;
  }

  _extendLogWithMempool(log, mempoolTxns) {
    const chain = [...(log || [])];
    const seenAddresses = new Set(
      chain.map((entry) => entry.public_key_hash).filter(Boolean)
    );
    let guard = 0;
    while (chain.length && guard < 100) {
      guard += 1;
      const last = chain[chain.length - 1];
      const next = (mempoolTxns || []).find(
        (tx) =>
          tx.public_key &&
          tx.public_key_hash &&
          !seenAddresses.has(tx.public_key_hash) &&
          tx.prev_public_key_hash === last.public_key_hash &&
          tx.public_key_hash === last.prerotated_key_hash
      );
      if (!next) break;
      chain.push(next);
      seenAddresses.add(next.public_key_hash);
    }
    return chain;
  }

  async _explorerPublicKey(address) {
    try {
      const res = await axios.get(
        `${import.meta.env.VITE_API_URL}/explorer-search?term=${encodeURIComponent(
          address
        )}`
      );
      const rows = Array.isArray(res.data?.result) ? res.data.result : [];
      const txns = rows.flatMap((row) =>
        row.transactions ? row.transactions : [row.txn || row]
      );
      const match = txns.find(
        (tx) => tx.public_key_hash === address && tx.public_key
      );
      return match?.public_key || null;
    } catch {
      return null;
    }
  }

  async _publicKeyForAddress(address, mempoolTxns) {
    const refs = (mempoolTxns || []).filter(
      (tx) =>
        tx.public_key &&
        (tx.public_key_hash === address ||
          tx.prerotated_key_hash === address ||
          tx.twice_prerotated_key_hash === address)
    );
    const direct = refs.find((tx) => tx.public_key_hash === address);
    if (direct) return direct.public_key;
    // The node's get_inception only consults on-chain blocks, so a key that is
    // only referenced by a mempool entry (as prerotated/twice) cannot resolve
    // itself. The txn that references it was signed by a key that *is* anchored
    // to the on-chain inception, so resolve through that signer.
    if (refs.length) return refs[0].public_key;
    return this._explorerPublicKey(address);
  }

  async _confirmedKeyLog(publicKey) {
    const res = await axios.get(
      `${
        import.meta.env.VITE_API_URL
      }/key-event-log?username_signature=asdf&public_key=${publicKey}`
    );
    return res.data.key_event_log || [];
  }

  _scanRotation(log, privateKey, forTransaction) {
    const chain = log || [];
    const address = privateKey ? getP2PKH(privateKey.publicKey) : "";
    const head = chain[chain.length - 1];
    const activeAddress = head
      ? head.prerotated_key_hash || head.prerotatedKeyHash || ""
      : "";
    // The active key is the tip's prerotated key. Each unwrap adds an
    // unconfirmed and a confirming entry, so the rotation number of the
    // active key always equals the number of key-event log entries.
    const activeRotation = chain.length;
    const haveHead = !activeAddress || activeAddress === address;
    if (forTransaction && head && !haveHead) {
      throw new Error(
        `Stored YadaCoin key is not the key event log head. Scan rotation ${activeRotation} on the YadaCoin chain first.`
      );
    }
    // Signing with the active key consumes it, so the transaction scan
    // presents the next rotation (the confirming key).
    return forTransaction ? activeRotation + 1 : activeRotation;
  }

  async getKeyLog(appContext, privateKey) {
    const privk = privateKey;
    const pk = Buffer.from(privk.publicKey).toString("hex");
    const address = getP2PKH(privk.publicKey);
    const data = appContext?.parsedData;
    try {
      const mempoolTxns = await this._fetchMempoolTransactions().catch(
        () => []
      );
      let log = await this._confirmedKeyLog(pk);
      if (!log.length) {
        const seeds = [
          address,
          data?.publicKeyHash,
          data?.prevPublicKeyHash,
          data?.prerotatedKeyHash,
        ].filter(Boolean);
        for (const seed of [...new Set(seeds)]) {
          const signer = await this._publicKeyForAddress(seed, mempoolTxns);
          if (!signer || signer === pk) continue;
          log = await this._confirmedKeyLog(signer);
          if (log.length) break;
        }
      }
      return {
        isValidKey: true,
        log: this._extendLogWithMempool(log, mempoolTxns),
      };
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
    const { setLog, log, privateKey } = appContext;

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
        { ...appContext, parsedData: appContext.parsedData || newParsedData },
        privateKey || newPrivateKey
      );
      if (!isValidKey) {
        throw new Error("Failed to fetch key event log");
      }
      const debugHead = fetchedLog[fetchedLog.length - 1];
      console.info("[yada-qr]", {
        scanned: {
          rotation: parseInt(rotation, 10),
          publicKeyHash,
          prevPublicKeyHash,
          prerotatedKeyHash,
          twicePrerotatedKeyHash,
        },
        head: debugHead && {
          public_key_hash: debugHead.public_key_hash,
          prev_public_key_hash: debugHead.prev_public_key_hash,
          prerotated_key_hash: debugHead.prerotated_key_hash,
          twice_prerotated_key_hash: debugHead.twice_prerotated_key_hash,
          mempool: debugHead.mempool,
        },
        logLength: fetchedLog.length,
      });
      let logForScan = fetchedLog;
      if (isTransactionFlow) {
        const expectedRotation = this._scanRotation(
          fetchedLog,
          privateKey,
          true
        );
        if (parseInt(rotation, 10) !== expectedRotation) {
          console.warn(
            `Scanned rotation ${rotation}, expected ${expectedRotation}. ` +
              "Continuing because key continuity is valid."
          );
        }
        this.validateKeyContinuity(
          appContext,
          newParsedData,
          fetchedLog,
          true
        );
      } else {
        const own = await this.getKeyLog(appContext, newPrivateKey).catch(
          () => null
        );
        if (own?.isValidKey) logForScan = own.log;
        try {
          this._validateKeyMembership(newParsedData, logForScan);
        } catch (error) {
          console.warn(
            `Loaded rotation ${newParsedData.rotation} is not in the current key chain:`,
            error.message
          );
        }
      }
      setLog(logForScan);
      return { newPrivateKey, newParsedData };
    } catch (error) {
      console.error("QR code parsing error:", error);
      throw error;
    }
  }

  _validateKeyMembership(newParsedData, log) {
    const addr = newParsedData.publicKeyHash;
    if (newParsedData.rotation === 0) return true;
    if (!log.length) {
      throw new Error(
        "This wallet has no key event log yet. Scan rotation 0 to initialize it."
      );
    }
    const belongs = log.some(
      (entry) =>
        entry.public_key_hash === addr ||
        entry.prerotated_key_hash === addr ||
        entry.twice_prerotated_key_hash === addr
    );
    if (!belongs) {
      throw new Error(
        "The scanned key is not part of this wallet's key chain."
      );
    }
    return true;
  }

  async fetchLog(appContext, webcamRef) {
    const { privateKey, setLog } = appContext;
    if (!privateKey) return [];
    const { isValidKey, log: fetchedLog } = await this.getKeyLog(
      appContext,
      privateKey
    );
    // A transient API failure must not erase the last known good log and
    // reset the displayed rotation to zero.
    if (!isValidKey) return fetchedLog;
    if (
      typeof appContext.shouldApplyLog === "function" &&
      !appContext.shouldApplyLog()
    ) {
      return fetchedLog;
    }
    setLog(fetchedLog);
    return fetchedLog;
  }

  _persistYadaKey(parsedData) {
    if (!parsedData?.wif) return;
    const stored = { ...parsedData, blockchain: "yda" };
    localStorage.setItem("walletWif_yda", stored.wif);
    localStorage.setItem("walletPrivateKey_yda", stored.wif);
    localStorage.setItem("walletParsedData_yda", JSON.stringify(stored));
    localStorage.setItem("walletIsInitialized_yda", "true");
  }

  _storedYadaContext(appContext) {
    const wif = localStorage.getItem("walletWif_yda");
    const parsedRaw = localStorage.getItem("walletParsedData_yda");
    if (!wif || !parsedRaw) {
      throw new Error(
        "Scan the YadaCoin payout key on the YadaCoin chain before unwrapping."
      );
    }
    const parsedData = JSON.parse(parsedRaw);
    const privateKey = fromWIF(wif);
    return {
      ...appContext,
      privateKey,
      parsedData,
      wif,
      isInitialized: false,
      log: [],
      setPrivateKey: () => {},
      setWif: (nextWif) => {
        localStorage.setItem("walletWif_yda", nextWif);
      },
      setParsedData: (data) => {
        this._persistYadaKey(data);
      },
      setLog: () => {},
      setRecipients: () => {},
      setIsInitialized: (value) => {
        localStorage.setItem("walletIsInitialized_yda", String(!!value));
      },
    };
  }

  async signTransaction(appContext, webcamRef, overrides = {}) {
    if (
      overrides.useStoredYadaKey &&
      appContext.selectedBlockchain?.id !== "yda"
    ) {
      appContext = this._storedYadaContext(appContext);
      const { isValidKey, log } = await this.getKeyLog(
        appContext,
        appContext.privateKey
      );
      if (!isValidKey) {
        throw new Error("Could not load the YadaCoin key log. Unwrap was not started.");
      }
      appContext = {
        ...appContext,
        log: log || [],
        isInitialized: true,
          expectedRotation: this._scanRotation(
            log || [],
            appContext.privateKey,
            true
          ),
      };
    } else if (appContext.privateKey) {
      const { isValidKey, log } = await this.getKeyLog(
        appContext,
        appContext.privateKey
      );
      if (isValidKey) {
        appContext.setLog?.(log || []);
        appContext = {
          ...appContext,
          log: log || [],
        expectedRotation: this._scanRotation(
          log || [],
          appContext.privateKey,
          true
        ),
        };
      }
    }
    const {
      privateKey,
      parsedData,
      feeEstimate,
      setIsTransactionFlow,
      setIsScannerOpen,
      setPrivateKey,
      setWif,
      setParsedData,
      setRecipients,
      setLoading,
      setLog,
    } = appContext;
    const recipients = overrides.recipients || appContext.recipients;
    const relationship = overrides.relationship || "";

    if (!overrides.scanOnly && (!privateKey || !recipients?.length)) {
      notifications.show({
        title: "Error",
        message: "Please provide private key and at least one recipient",
        color: "red",
      });
      return;
    }

    const invalidRecipient = overrides.scanOnly
      ? null
      : (recipients || []).find(
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
      let newPrivateKey = overrides.scanned?.newPrivateKey;
      let newParsedData = overrides.scanned?.newParsedData;
      if (newPrivateKey && newParsedData) {
        // QR was already validated before the swap.
      } else {
      const expectedRotation =
        appContext.expectedRotation ??
        (appContext.log?.length
          ? appContext.log.length + 1
          : parsedData.rotation + 1);
      notifications.show({
        title: "Key Rotation Required",
        message: overrides.useStoredYadaKey
          ? `Select YadaCoin on the device, rotate to ${expectedRotation}, and scan that QR.`
          : `Please rotate your key to rotation ${expectedRotation} on your device and scan the new QR code to proceed with the transaction.`,
        color: "yellow",
      });
      appContext.setScanPrompt?.(`Scan YadaCoin rotation ${expectedRotation}`);
      setIsTransactionFlow(true);
      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      const maxAttempts = overrides.useStoredYadaKey ? 200 : 100;

      while (attempts < maxAttempts) {
        try {
          const scanned = await capture(webcamRef);
          if (overrides.useStoredYadaKey) {
            const parts = String(scanned).split("|");
            if (
              !validateBitcoinAddress(parts[1] || "") ||
              !validateBitcoinAddress(parts[2] || "")
            ) {
              attempts++;
              await new Promise((resolve) => setTimeout(resolve, 300));
              continue;
            }
          }
          qrData = scanned;
          break;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      if (!qrData) {
        setIsScannerOpen(false);
        if (appContext.setScanPrompt) appContext.setScanPrompt("");
        throw new Error("No QR code scanned within time limit");
      }

      setIsScannerOpen(false);
      if (appContext.setScanPrompt) appContext.setScanPrompt("");
      ({ newPrivateKey, newParsedData } = await this.processScannedQR(
        appContext,
        webcamRef,
        qrData,
        true
      ));
      if (overrides.scanOnly) {
        return { appContext, newPrivateKey, newParsedData };
      }
      }

      try {
        const address = getP2PKH(privateKey.publicKey);
        const walletAddress = parsedData?.publicKeyHash || address;
        const needed = totalAmount + transactionFee;
        const { utxos: utxosWithValues } =
          await this._spendableUtxosForAddresses(
            await this._resolveBalanceAddresses(appContext, walletAddress)
          );
        let selectedInputs = [];
        let inputsTotal = 0;
        for (const u of utxosWithValues) {
          if (inputsTotal >= needed) break;
          selectedInputs.push({ id: u.id });
          inputsTotal += u.value;
        }

        if (inputsTotal + 1e-8 < needed) {
          const spendable = Math.floor(inputsTotal * 1e8) / 1e8;
          const rotationLabel = Number.isInteger(Number(parsedData?.rotation))
            ? ` at rotation ${parsedData.rotation}`
            : "";
          throw new Error(
            `Insufficient funds: send of ${totalAmount} YDA needs ${needed} YDA ` +
              `but only ${spendable.toFixed(8)} YDA is spendable for wallet ` +
              `${walletAddress}${rotationLabel}.`
          );
        }

        const transactionOutputs = recipients.map((r) => ({
          to: validateBitcoinAddress(r.address),
          value: Number(r.amount),
        }));

        const changeValue = inputsTotal - totalAmount - transactionFee;
        transactionOutputs.push({
          to: parsedData.prerotatedKeyHash,
          value: changeValue,
        });

        const actualTxn = new Transaction({
          key: privateKey,
          public_key: Buffer.from(privateKey.publicKey).toString("hex"),
          twice_prerotated_key_hash: parsedData.twicePrerotatedKeyHash,
          prerotated_key_hash: parsedData.prerotatedKeyHash,
          inputs: selectedInputs,
          outputs: transactionOutputs,
          relationship,
          relationship_hash: await generateSHA256(relationship),
          public_key_hash: getP2PKH(privateKey.publicKey),
          prev_public_key_hash: parsedData.prevPublicKeyHash,
          fee: transactionFee,
        });
        await actualTxn.hashAndSign();

        let newTransactionOutputs = [
          {
            to: newParsedData.prerotatedKeyHash,
            value: changeValue,
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
          if (appContext.setIsInitialized) appContext.setIsInitialized(true);
          this._persistYadaKey(newParsedData);
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
      if (appContext.setScanPrompt) appContext.setScanPrompt("");
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async unwrapPair(appContext, webcamRef, { destination, amount, relationship }) {
    const {
      privateKey,
      parsedData,
      feeEstimate,
      setIsScannerOpen,
      setIsTransactionFlow,
      setScanPrompt,
      setPrivateKey,
      setWif,
      setParsedData,
      setLog,
    } = appContext;

    const { isValidKey, log } = await this.getKeyLog(appContext, privateKey);
    if (!isValidKey) {
      throw new Error("Could not load the YadaCoin key log");
    }
    // Prefer getKeyLog's tip: _extendLogWithMempool only appends mempool
    // entries that hash-link to the prior tip as a valid action/confirming
    // pair. The /key-event-log endpoint can also return unpaired mempool
    // entries, so keep it only as a fallback.
    const confirmedLog = await this._confirmedKeyLog(
      Buffer.from(privateKey.publicKey).toString("hex")
    );
    const tipLog = log?.length ? log : confirmedLog;
    const tip = tipLog[tipLog.length - 1];
    if (!tip) {
      throw new Error(
        "No key event log entry found. Initialize the YadaCoin wallet first."
      );
    }
    const actionAddress = tip.prerotated_key_hash;
    const confirmingAddress = tip.twice_prerotated_key_hash;
    if (!actionAddress || !confirmingAddress) {
      throw new Error("Key event log tip is missing its next key commitments");
    }
    // The action key is the active key (rotation == confirmed log length);
    // the confirming key is the next rotation after it.
    const actionRotation = tipLog.length;
    const confirmingRotation = actionRotation + 1;

    // A new unwrap must start from a confirming entry. If the tip is an
    // action entry (it has inputs), its confirming rotation has not arrived;
    // building another action here would be invalid.
    const tipHasSpend = Array.isArray(tip.inputs) && tip.inputs.length > 0;
    if (tipHasSpend) {
      throw new Error(
        `Key log tip is an unconfirmed action entry (${tip.public_key_hash}). ` +
          `Wait for its confirming rotation before unwrapping again.`
      );
    }
    const walletAddress =
      parsedData?.publicKeyHash || getP2PKH(privateKey.publicKey);
    const walletRotation = Number(parsedData?.rotation);

    // Preflight the spendable balance before asking for QR scans. Use the
    // same address set as the Wallet Balance card so the reported address and
    // balance match the error exactly.
    const transactionFee =
      feeEstimate?.status === "congested"
        ? feeEstimate.fee_estimate.median_fee
        : feeEstimate?.recommended_fee || 0.0;
    const totalAmount = Number(amount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new Error(`Invalid unwrap amount: ${amount}`);
    }
    const needed = totalAmount + transactionFee;

    const { utxos } = await this._spendableUtxosForAddresses(
      await this._resolveBalanceAddresses(
        { ...appContext, log: tipLog },
        walletAddress
      )
    );
    const selectedInputs = [];
    let inputsTotal = 0;
    for (const utxo of utxos) {
      if (inputsTotal >= needed) break;
      selectedInputs.push({ id: utxo.id });
      inputsTotal += utxo.value;
    }
    if (inputsTotal + 1e-8 < needed) {
      const spendable = Math.floor(inputsTotal * 1e8) / 1e8;
      const rotationLabel = Number.isFinite(walletRotation)
        ? ` at rotation ${walletRotation}`
        : "";
      throw new Error(
        `Insufficient funds: unwrap of ${totalAmount} YDA needs ${needed} YDA ` +
          `but only ${spendable.toFixed(8)} YDA is spendable for wallet ` +
          `${walletAddress}${rotationLabel}.`
      );
    }

    const decode = (qrData) => {
      const [wif, pre, twice, prev, rotation] = String(qrData)
        .trim()
        .split("|")
        .map((part) => (part || "").trim());
      if (
        !validateBitcoinAddress(pre || "") ||
        !validateBitcoinAddress(twice || "")
      ) {
        return null;
      }
      const key = fromWIF(wif);
      return {
        key,
        pkh: getP2PKH(key.publicKey),
        parsed: {
          publicKeyHash: getP2PKH(key.publicKey),
          wif,
          prerotatedKeyHash: pre,
          twicePrerotatedKeyHash: twice,
          prevPublicKeyHash: prev,
          rotation: parseInt(rotation, 10),
          blockchain: "yda",
        },
      };
    };

    const readKey = async (expected, label) => {
      const cancelRef = appContext.scanCancelRef;
      const deadline = Date.now() + 90000;
      let formatNotified = false;
      let mismatchNotified = false;
      let lastCameraError = null;
      let loggedCameraError = false;
      const sleep = () =>
        new Promise((resolve) => setTimeout(resolve, 400));

      while (Date.now() < deadline) {
        if (cancelRef?.current) {
          throw new Error("Scan cancelled");
        }

        let raw;
        try {
          raw = await capture(webcamRef);
        } catch (error) {
          if (cancelRef?.current) throw new Error("Scan cancelled");
          // "No QR code found" is normal while the user is aligning the code.
          // Remember anything else (camera not ready, bad image, etc.) so a
          // timeout reports the real reason instead of swallowing it.
          if (error?.message && !/No QR code found/i.test(error.message)) {
            lastCameraError = error;
            if (!loggedCameraError) {
              loggedCameraError = true;
              console.warn("[yada-scan] capture failed:", error.message);
            }
          }
          await sleep();
          continue;
        }

        let scanned;
        try {
          scanned = decode(raw);
        } catch (error) {
          if (!formatNotified) {
            formatNotified = true;
            notifications.show({
              title: "Not a YadaCoin key QR",
              message:
                `Scanned data is not a YadaCoin rotation key (${error.message}). ` +
                "Open the YadaCoin key QR on your device and scan that.",
              color: "red",
            });
          }
          await sleep();
          continue;
        }
        if (!scanned) {
          if (!formatNotified) {
            formatNotified = true;
            notifications.show({
              title: "Not a YadaCoin key QR",
              message:
                "That QR is not a YadaCoin rotation key. Scan the key QR shown on your device.",
              color: "yellow",
            });
          }
          await sleep();
          continue;
        }

        // Match on the address only. The prev-public-key field is validated
        // implicitly by the action/confirming link check below; rejecting a
        // scan on that field made valid device QRs appear to be ignored.
        if (scanned.pkh !== expected) {
          console.info("[yada-scan] key does not match expected", {
            label,
            expected,
            scanned: {
              publicKeyHash: scanned.pkh,
              prevPublicKeyHash: scanned.parsed.prevPublicKeyHash,
              rotation: scanned.parsed.rotation,
            },
          });
          if (!mismatchNotified) {
            mismatchNotified = true;
            notifications.show({
              title: `Wrong ${label} key`,
              message:
                `Scanned rotation ${scanned.parsed.rotation} (${scanned.pkh}). ` +
                `Expected ${expected}. Rotate the device to the requested key ` +
                "and hold the QR steady.",
              color: "yellow",
            });
          }
          await sleep();
          continue;
        }
        notifications.show({
          title: `${label === "action" ? "Action" : "Confirming"} key scanned`,
          message: `Rotation ${scanned.parsed.rotation} (${scanned.pkh})`,
          color: "green",
        });
        return scanned;
      }
      throw new Error(
        `No ${label} key scanned within time limit. Expected ${expected}.` +
          (lastCameraError
            ? ` Last camera error: ${lastCameraError.message}.`
            : "")
      );
    };

    if (appContext.scanCancelRef) appContext.scanCancelRef.current = false;
    setIsTransactionFlow(true);
    setIsScannerOpen(true);
    // The wallet already holds the active key. When its commitments match the
    // log tip it signs the action transaction directly, so only the
    // confirming key needs a fresh scan.
    const storedActionKey =
      privateKey &&
      parsedData &&
      parsedData.publicKeyHash === actionAddress &&
      parsedData.prevPublicKeyHash === tip.public_key_hash &&
      parsedData.prerotatedKeyHash === confirmingAddress &&
      parsedData.twicePrerotatedKeyHash
        ? { key: privateKey, pkh: parsedData.publicKeyHash, parsed: parsedData }
        : null;
    if (storedActionKey) {
      notifications.show({
        title: "Active key loaded",
        message: `Using stored rotation ${actionRotation} key. Scan the confirming key (rotation ${confirmingRotation}).`,
        color: "blue",
      });
    }
    let actionKey = storedActionKey;
    let confirmingKey;
    try {
      if (!actionKey) {
        setScanPrompt?.(`Scan action key: rotation ${actionRotation}`);
        notifications.show({
          title: "Scan action key",
          message: `Present rotation ${actionRotation} (${actionAddress})`,
          color: "yellow",
        });
        actionKey = await readKey(actionAddress, "action");
      }

      setScanPrompt?.(`Scan confirming key: rotation ${confirmingRotation}`);
      notifications.show({
        title: "Scan confirming key",
        message: `Present rotation ${confirmingRotation} (${confirmingAddress})`,
        color: "yellow",
      });
      confirmingKey = await readKey(confirmingAddress, "confirming");
    } finally {
      setIsScannerOpen(false);
      setIsTransactionFlow(false);
      setScanPrompt?.("");
    }

    if (
      actionKey.parsed.twicePrerotatedKeyHash !==
      confirmingKey.parsed.prerotatedKeyHash
    ) {
      throw new Error(
        "Scanned keys do not link: action twice-prerotated does not match confirming prerotated"
      );
    }

    const changeValue = Math.max(0, inputsTotal - needed);
    const outputs = [
      { to: validateBitcoinAddress(destination), value: totalAmount },
      { to: actionKey.parsed.prerotatedKeyHash, value: changeValue },
    ];

    const baseCounter = Number.isInteger(tip.counter) ? tip.counter : 0;
    const inceptionTag =
      tip.inception_public_key_hash || tip.public_key_hash;

    const action = new Transaction({
      key: actionKey.key,
      public_key: Buffer.from(actionKey.key.publicKey).toString("hex"),
      twice_prerotated_key_hash: actionKey.parsed.twicePrerotatedKeyHash,
      prerotated_key_hash: actionKey.parsed.prerotatedKeyHash,
      inputs: selectedInputs,
      outputs,
      relationship: relationship || "",
      relationship_hash: await generateSHA256(relationship || ""),
      public_key_hash: actionKey.pkh,
      prev_public_key_hash: tip.public_key_hash,
      fee: transactionFee,
      counter: baseCounter + 1,
      inception_public_key_hash: inceptionTag,
    });
    await action.hashAndSign();

    const confirming = new Transaction({
      key: confirmingKey.key,
      public_key: Buffer.from(confirmingKey.key.publicKey).toString("hex"),
      twice_prerotated_key_hash: confirmingKey.parsed.twicePrerotatedKeyHash,
      prerotated_key_hash: confirmingKey.parsed.prerotatedKeyHash,
      inputs: [],
      outputs: [
        { to: confirmingKey.parsed.prerotatedKeyHash, value: 0 },
      ],
      relationship: "",
      relationship_hash: await generateSHA256(""),
      public_key_hash: confirmingKey.pkh,
      prev_public_key_hash: actionKey.pkh,
      fee: 0,
      counter: baseCounter + 2,
      inception_public_key_hash: inceptionTag,
    });
    await confirming.hashAndSign();

    const url = `${
      import.meta.env.VITE_API_URL
    }/transaction?origin=${window.location.origin}&username_signature=1`;
    const response = await axios.post(
      url,
      [action.toJson(), confirming.toJson()],
      { headers: { "Content-Type": "application/json" } }
    );
    if (response.status !== 200) {
      throw new Error("Unwrap transaction submission failed");
    }

    setPrivateKey?.(confirmingKey.key);
    setWif?.(confirmingKey.parsed.wif);
    setParsedData?.(confirmingKey.parsed);
    this._persistYadaKey(confirmingKey.parsed);
    const refreshed = await this.getKeyLog(appContext, confirmingKey.key);
    if (refreshed.isValidKey) setLog?.(refreshed.log);

    // The change is now held by the confirming key, so refresh the displayed
    // balance against that key instead of the previous (now spent) rotation.
    try {
      if (typeof appContext.setBalance === "function") {
        await this.fetchBalance(
          {
            ...appContext,
            privateKey: confirmingKey.key,
            parsedData: confirmingKey.parsed,
          },
          confirmingKey.parsed.publicKeyHash
        );
      }
    } catch (error) {
      console.warn("Failed to refresh YadaCoin balance after unwrap:", error);
    }

    return { action, confirming, parsed: confirmingKey.parsed };
  }

  async transferBalanceToLatestKey(appContext, previousSigner, qrdata) {
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

    if (!privateKey) {
      notifications.show({
        title: "Error",
        message: "Please provide private key",
        color: "red",
      });
      return;
    }

    try {
      try {
        const { isValidKey, log: fetchedLog } = await this.getKeyLog(
          appContext,
          previousSigner
        );
        const parsedQRData = qrdata.split("|");
        const address = getP2PKH(previousSigner.publicKey);
        const res = await axios.get(
          `${
            import.meta.env.VITE_API_URL
          }/get-graph-wallet?address=${address}&amount_needed=21000000`
        );
        const totalAmount =
          parseFloat(res.data.chain_balance) +
          parseFloat(res.data.pending_balance || 0);
        const newUnspent = res.data.unspent_transactions.concat(
          res.data.unspent_mempool_txns
        );

        const utxosWithValues = this._mapKelUtxos(newUnspent);

        // Verify total available funds
        const availableTotal = utxosWithValues.reduce(
          (sum, u) => sum + u.value,
          0
        );
        if (parseFloat(availableTotal.toFixed(8)) < totalAmount) {
          throw new Error("Insufficient funds");
        }

        const batches = this._batchUtxos(utxosWithValues);

        const lastestLogEntry = fetchedLog[fetchedLog.length - 1];
        const destinationAddress = lastestLogEntry.prerotated_key_hash;

        const txns = [];
        for (const batch of batches) {
          const batchValue = batch.reduce((sum, u) => sum + u.value, 0);
          const batchInputs = batch.map((u) => ({ id: u.id }));
          const txn = new Transaction({
            key: previousSigner,
            public_key: Buffer.from(previousSigner.publicKey).toString("hex"),
            twice_prerotated_key_hash: parsedQRData[2],
            prerotated_key_hash: parsedQRData[1],
            inputs: batchInputs,
            outputs: [{ to: destinationAddress, value: batchValue }],
            relationship: "",
            relationship_hash: await generateSHA256(""),
            public_key_hash: getP2PKH(previousSigner.publicKey),
            prev_public_key_hash: parsedQRData[3],
            fee: 0,
          });
          await txn.hashAndSign();
          txns.push(txn);
        }

        setLoading(true);
        for (const txn of txns) {
          const response = await axios.post(
            `${import.meta.env.VITE_API_URL}/transaction?origin=${
              window.location.origin
            }&username_signature=1`,
            [txn.toJson()],
            { headers: { "Content-Type": "application/json" } }
          );
          if (response.status !== 200) {
            throw new Error("Transaction or confirmation submission failed");
          }
        }

        localStorage.removeItem("walletPrivateKey");
        localStorage.removeItem("walletWif");
        localStorage.removeItem("walletParsedData");
        localStorage.removeItem("walletIsInitialized");

        notifications.show({
          title: "Success",
          message:
            "Transaction and key rotation confirmation submitted successfully.",
          color: "green",
        });
        return { status: 1 };
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
      const expectedRotation =
        appContext.expectedRotation ??
        (appContext.log?.length
          ? appContext.log.length + 1
          : parsedData.rotation + 1);
      appContext.setScanPrompt?.(`Scan YadaCoin rotation ${expectedRotation}`);
      notifications.show({
        title: "Key Rotation Required",
        message: `Please rotate your key to rotation ${expectedRotation} on your device and scan the new QR code to proceed with the transaction.`,
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
        const walletAddress = parsedData?.publicKeyHash || address;
        const needed = totalAmount + transactionFee;
        const { utxos: utxosForWrap } =
          await this._spendableUtxosForAddresses(
            await this._resolveBalanceAddresses(appContext, walletAddress)
          );
        let selectedInputs = [];
        let inputsTotal = 0;
        for (const u of utxosForWrap) {
          if (inputsTotal >= needed) break;
          selectedInputs.push({ id: u.id });
          inputsTotal += u.value;
        }

        if (inputsTotal + 1e-8 < needed) {
          const spendable = Math.floor(inputsTotal * 1e8) / 1e8;
          const rotationLabel = Number.isInteger(Number(parsedData?.rotation))
            ? ` at rotation ${parsedData.rotation}`
            : "";
          throw new Error(
            `Insufficient funds: wrap of ${totalAmount} YDA needs ${needed} YDA ` +
              `but only ${spendable.toFixed(8)} YDA is spendable for wallet ` +
              `${walletAddress}${rotationLabel}.`
          );
        }

        const transactionOutputs = [
          {
            to: "16U1gAmHazqqEkbRE9KFPShAperjJreMRA",
            value: Number(recipients[0].amount),
          },
        ];

        const changeValue = inputsTotal - totalAmount - transactionFee;
        transactionOutputs.push({
          to: parsedData.prerotatedKeyHash,
          value: changeValue,
        });

        const actualTxn = new Transaction({
          key: privateKey,
          public_key: Buffer.from(privateKey.publicKey).toString("hex"),
          twice_prerotated_key_hash: parsedData.twicePrerotatedKeyHash,
          prerotated_key_hash: parsedData.prerotatedKeyHash,
          inputs: selectedInputs,
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
            value: changeValue,
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
          if (appContext.setIsInitialized) appContext.setIsInitialized(true);
          this._persistYadaKey(newParsedData);
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
      appContext.setScanPrompt?.("");
    }
  }

  _mapKelUtxos(unspent) {
    return (unspent || [])
      .map((utxo) => ({
        id: utxo.id,
        value: (utxo.outputs || []).reduce(
          (sum, output) => sum + Number(output.value || 0),
          0
        ),
      }))
      .filter((u) => u.value > 0);
  }

  _balanceAddresses(address, parsedData, log) {
    if (!address) return [];
    const addresses = [address];
    const rotation = Number(parsedData?.rotation);
    const fundingEntry =
      Number.isInteger(rotation) && rotation > 0 ? log?.[rotation - 1] : null;
    // Include both sources: the stored key's predecessor and the log entry at
    // the stored rotation. A stale/off-by-one rotation must not hide the
    // change that is actually held by the previous key.
    for (const parent of [
      fundingEntry?.public_key_hash,
      parsedData?.prevPublicKeyHash,
    ]) {
      if (parent && !addresses.includes(parent)) addresses.push(parent);
    }
    return addresses;
  }

  async _spendableUtxosForAddresses(addresses) {
    const unique = [...new Set((addresses || []).filter(Boolean))];
    if (!unique.length) return { utxos: [], total: 0 };

    const responses = await Promise.all(
      unique.map((address) =>
        axios.get(
          `${
            import.meta.env.VITE_API_URL
          }/get-graph-wallet?address=${address}&amount_needed=21000000`
        )
      )
    );

    const seen = new Set();
    const unspent = [];
    let reported = 0;
    for (const res of responses) {
      const data = res.data || {};
      reported = Math.max(
        reported,
        parseFloat(data.chain_balance || 0) +
          parseFloat(data.pending_balance || 0)
      );
      for (const utxo of [
        ...(data.unspent_transactions || []),
        ...(data.unspent_mempool_txns || []),
      ]) {
        if (utxo?.id && !seen.has(utxo.id)) {
          seen.add(utxo.id);
          unspent.push(utxo);
        }
      }
    }

    const utxos = this._mapKelUtxos(unspent).sort((a, b) => b.value - a.value);
    const total = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
    return {
      utxos,
      total: total > 0 ? Math.floor(total * 1e8) / 1e8 : reported,
    };
  }

  _mapUtxosForAddress(unspent, address) {
    return unspent
      .map((utxo) => ({
        id: utxo.id,
        value: utxo.outputs.reduce((sum, output) => {
          if (output.to !== address) return sum;
          return sum + output.value;
        }, 0),
      }))
      .filter((u) => u.value > 0);
  }

  _batchUtxos(utxos, batchSize = 100) {
    const batches = [];
    for (let i = 0; i < utxos.length; i += batchSize) {
      batches.push(utxos.slice(i, i + batchSize));
    }
    return batches;
  }

  validateKeyContinuity(
    appContext,
    newParsedData,
    fetchedLog,
    isTransactionFlow
  ) {
    const newPublicKeyHash = newParsedData.publicKeyHash;

    if (newParsedData.rotation > 0) {
      if (fetchedLog.length === 0) {
        throw new Error(
          `No key event log found for this wallet, so rotation ${newParsedData.rotation} cannot be verified`
        );
      }
      const head = fetchedLog[fetchedLog.length - 1];
      // Loading the active key presents the tip's prerotated key; a
      // transaction presents the following key, which the tip commits to as
      // its twice-prerotated hash.
      const isActiveKey =
        head.prerotated_key_hash === newPublicKeyHash &&
        head.twice_prerotated_key_hash === newParsedData.prerotatedKeyHash &&
        (!newParsedData.prevPublicKeyHash ||
          head.public_key_hash === newParsedData.prevPublicKeyHash);
      const isNextKey =
        head.twice_prerotated_key_hash === newPublicKeyHash &&
        (!newParsedData.prevPublicKeyHash ||
          head.prerotated_key_hash === newParsedData.prevPublicKeyHash);
      const isValidContinuity =
        isActiveKey || (isTransactionFlow && isNextKey);
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
