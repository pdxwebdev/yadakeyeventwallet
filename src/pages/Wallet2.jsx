import { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  Container,
  Text,
  useMantineColorScheme,
  Card,
  Button,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { Transaction } from "../utils/transaction";
import jsQR from "jsqr";
import { notifications } from "@mantine/notifications";
import {
  fromWIF,
  generateSHA256,
  getP2PKH,
  validateBitcoinAddress,
} from "../utils/hdWallet";
import { useAppContext } from "../context/AppContext";
import WalletHeader from "../components/Wallet2/WalletHeader";
import WalletBalance from "../components/Wallet2/WalletBalance";
import TransactionForm from "../components/Wallet2/TransactionForm";
import TransactionHistory from "../components/Wallet2/TransactionHistory";
import QRScannerModal from "../components/Wallet2/QRScannerModal";
import QRDisplayModal from "../components/Wallet2/QRDisplayModal";
import WalletStateHandler from "../components/Wallet2/WalletStateHandler";

const ITEMS_PER_PAGE = 5;

const Wallet2 = () => {
  const { colorScheme } = useMantineColorScheme();
  const [transactions, setTransactions] = useState([]);
  const [combinedHistory, setCombinedHistory] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [recipients, setRecipients] = useState([{ address: "", amount: "" }]);
  const [privateKey, setPrivateKey] = useState(null);
  const [wif, setWif] = useState("");
  const [log, setLog] = useState([]);
  const [balance, setBalance] = useState(null);
  const [focusedRotation, setFocusedRotation] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isTransactionFlow, setIsTransactionFlow] = useState(false);

  const webcamRef = useRef(null);
  const pollingRef = useRef(null);
  const { loading, setLoading } = useAppContext();

  // Styles (unchanged)
  const styles = (theme) => ({
    card: {
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[7]
          : theme.colors.gray[0],
      color: theme.colorScheme === "dark" ? theme.colors.dark[0] : theme.black,
    },
    nestedCard: {
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[6]
          : theme.colors.gray[1],
      color: theme.colorScheme === "dark" ? theme.colors.dark[2] : theme.black,
    },
    title: {
      color: theme.colorScheme === "dark" ? theme.white : theme.black,
    },
    table: {
      backgroundColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[6]
          : theme.colors.gray[1],
      color: theme.colorScheme === "dark" ? theme.colors.dark[2] : theme.black,
    },
    tableHeader: {
      color: theme.colorScheme === "dark" ? theme.white : theme.black,
    },
    input: {
      backgroundColor:
        theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.white,
      color: theme.colorScheme === "dark" ? theme.colors.dark[2] : theme.black,
      borderColor:
        theme.colorScheme === "dark"
          ? theme.colors.dark[4]
          : theme.colors.gray[4],
    },
    inputLabel: {
      color: theme.colorScheme === "dark" ? theme.white : theme.black,
    },
    modal: {
      backgroundColor:
        theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.white,
    },
    qrModal: {
      backgroundColor:
        theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.white,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: "20px",
    },
    webcam: {
      borderRadius: "8px",
      border: `1px solid ${
        theme.colorScheme === "dark"
          ? theme.colors.dark[4]
          : theme.colors.gray[4]
      }`,
    },
    button: {
      "&:hover": {
        backgroundColor:
          theme.colorScheme === "dark"
            ? theme.colors.teal[7]
            : theme.colors.teal[5],
      },
    },
  });

  // Load state from localStorage (unchanged)
  useEffect(() => {
    const storedPrivateKey = localStorage.getItem("walletPrivateKey");
    const storedWif = localStorage.getItem("walletWif");
    const storedParsedData = localStorage.getItem("walletParsedData");
    const storedIsInitialized = localStorage.getItem("walletIsInitialized");

    if (storedPrivateKey && storedWif && storedParsedData) {
      try {
        const privateKeyObj = fromWIF(storedWif);
        const parsed = JSON.parse(storedParsedData);
        const address1 = getP2PKH(privateKeyObj.publicKey);
        if (parsed.address1 && parsed.address1 !== address1) {
          throw new Error("Invalid restored key: address mismatch");
        }
        setPrivateKey(privateKeyObj);
        setWif(storedWif);
        setParsedData({ ...parsed, address1 });
        setIsInitialized(storedIsInitialized === "true");
      } catch (error) {
        console.error("Error restoring private key:", error);
      }
    }
  }, []);

  // Save state to localStorage (unchanged)
  useEffect(() => {
    if (privateKey) {
      localStorage.setItem("walletPrivateKey", JSON.stringify(privateKey));
    } else {
      localStorage.removeItem("walletPrivateKey");
    }
  }, [privateKey]);

  useEffect(() => {
    if (wif) {
      localStorage.setItem("walletWif", wif);
    } else {
      localStorage.removeItem("walletWif");
    }
  }, [wif]);

  useEffect(() => {
    if (parsedData) {
      const { address1, ...dataToStore } = parsedData;
      localStorage.setItem("walletParsedData", JSON.stringify(dataToStore));
    } else {
      localStorage.removeItem("walletParsedData");
    }
  }, [parsedData]);

  useEffect(() => {
    localStorage.setItem("walletIsInitialized", isInitialized.toString());
  }, [isInitialized]);

  const resetWalletState = () => {
    setPrivateKey(null);
    setWif("");
    setParsedData(null);
    setIsInitialized(false);
    setLog([]);
    setTransactions([]);
    setCombinedHistory([]);
    localStorage.removeItem("walletPrivateKey");
    localStorage.removeItem("walletWif");
    localStorage.removeItem("walletParsedData");
    localStorage.removeItem("walletIsInitialized");
    notifications.show({
      title: "Wallet Reset",
      message:
        "Wallet state cleared. Please scan the QR code for the active key.",
      color: "blue",
    });
  };

  // Helper function to fetch transaction details (unchanged)
  const fetchKeyEventAmount = async (txId, prerotatedKeyHash) => {
    try {
      const response = await axios.get(
        `${
          import.meta.env.VITE_API_URL
        }/transaction/${txId}?origin=${encodeURIComponent(
          window.location.origin
        )}`
      );
      if (response.status !== 200) {
        console.warn(
          `Failed to fetch transaction ${txId}: ${response.statusText}`
        );
        return "0";
      }
      const tx = response.data;
      const amount = tx.outputs
        .reduce((sum, output) => {
          if (output.to === prerotatedKeyHash) {
            return sum + (output.value || 0);
          }
          return sum;
        }, 0)
        .toFixed(8);
      return amount;
    } catch (error) {
      console.error(`Error fetching transaction ${txId}:`, error);
      return "0";
    }
  };

  // Fetch key event log (unchanged)
  const getKeyLog = async (privateKey) => {
    const pk = Buffer.from(privateKey.publicKey).toString("hex");
    try {
      const res = await axios.get(
        `${
          import.meta.env.VITE_API_URL
        }/key-event-log?username_signature=asdf&public_key=${pk}`
      );
      const keyEventLog = res.data.key_event_log || [];
      return { isValidKey: true, log: keyEventLog };
    } catch (error) {
      console.error("Error fetching key event log:", error);
      notifications.show({
        title: "Error",
        message: "Failed to load key event log",
        color: "red",
      });
      return { isValidKey: false, log: [] };
    }
  };

  // Validate key continuity (unchanged)
  const validateKeyContinuity = (
    newParsedData,
    fetchedLog,
    isTransactionFlow
  ) => {
    const newPublicKeyHash = newParsedData.address1;
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
          ? newParsedData.prevaddress1 === parsedData.address1 &&
            newParsedData.address2 === parsedData.address3 &&
            (!newParsedData.prevaddress1 ||
              parsedData.address1 === newParsedData.prevaddress1)
          : lastEntry.prerotated_key_hash === newPublicKeyHash &&
            lastEntry.twice_prerotated_key_hash === newParsedData.address2 &&
            (!newParsedData.prevaddress1 ||
              lastEntry.public_key_hash === newParsedData.prevaddress1);
      if (!isValidContinuity) {
        throw new Error(
          `The scanned key (rotation ${newParsedData.rotation}) does not maintain continuity with the previous key`
        );
      }
    }
    return true;
  };

  // Fetch transactions for key (unchanged)
  const fetchTransactionsForKey = async (
    publicKey,
    address,
    rotation,
    keyEventTxIds
  ) => {
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
  };

  // Build transaction history
  const buildTransactionHistory = async () => {
    if (!privateKey || !isInitialized) return;

    try {
      const { log: keyEventLog } = await getKeyLog(privateKey);
      setLog(keyEventLog);

      const keyEventTxIds = new Set(keyEventLog.map((entry) => entry.id));
      const currentAddress = getP2PKH(privateKey.publicKey);
      const currentPublicKey = Buffer.from(privateKey.publicKey).toString(
        "hex"
      );
      const currentRotation = parsedData.rotation;

      // Fetch transactions for all keys in the key event log
      const keyLogWithTransactions = await Promise.all(
        keyEventLog.map(async (entry, index) => {
          const { transactions, totalReceived, totalSent } =
            await fetchTransactionsForKey(
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

      // Fetch pending transactions for the current key
      const currentKeyPending = await fetchTransactionsForKey(
        currentPublicKey,
        currentAddress,
        currentRotation,
        keyEventTxIds
      );

      // Combine key event log transactions and current key pending transactions
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

      // Sort transactions by rotation and date
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
    }
  };

  // Fetch history on initialization or key change (unchanged)
  useEffect(() => {
    if (privateKey && isInitialized) {
      buildTransactionHistory();
    }
  }, [privateKey, isInitialized]);

  // Check initialization status (unchanged)
  const checkInitializationStatus = async () => {
    if (!privateKey || !parsedData) {
      return { status: "no_private_key" };
    }

    try {
      const { isValidKey, log: keyEventLog } = await getKeyLog(privateKey);
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
          (parsedData.rotation === 0 && !parsedData.prevaddress1) ||
          (parsedData.prevaddress1 &&
            keyEventLog.some(
              (e) => !e.mempool && e.public_key_hash === parsedData.prevaddress1
            ) &&
            logEntry.prerotated_key_hash === parsedData.address2 &&
            logEntry.twice_prerotated_key_hash === parsedData.address3);

        if (!isValidContinuity) {
          return { status: "invalid_continuity" };
        }
        return { status: "revoked" };
      }

      if (parsedData.rotation === keyEventLog.length) {
        if (keyEventLog.length > 0) {
          const lastLogEntry = keyEventLog[keyEventLog.length - 1];
          const isValidContinuity =
            lastLogEntry.public_key_hash === parsedData.prevaddress1 &&
            lastLogEntry.prerotated_key_hash === address &&
            lastLogEntry.twice_prerotated_key_hash === parsedData.address2;

          if (!isValidContinuity) {
            return { status: "invalid_continuity" };
          }
        } else if (parsedData.prevaddress1 && parsedData.rotation !== 0) {
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
  };

  // Initialize key event log (unchanged)
  const initializeKeyEventLog = async () => {
    if (!privateKey || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const address = getP2PKH(privateKey.publicKey);
      const transactionOutputs = [{ to: parsedData.address2, value: 0 }];

      const txn = new Transaction({
        key: privateKey,
        public_key: Buffer.from(privateKey.publicKey).toString("hex"),
        twice_prerotated_key_hash: parsedData.address3,
        prerotated_key_hash: parsedData.address2,
        inputs: [],
        outputs: transactionOutputs,
        relationship: "",
        relationship_hash: await generateSHA256(""),
        public_key_hash: address,
        prev_public_key_hash: parsedData.prevaddress1 || "",
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

      setLoading(false);
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
    }
  };

  // Check initialization status (unchanged)
  useEffect(() => {
    if (privateKey && !isInitialized && !isSubmitting && parsedData) {
      const checkStatus = async () => {
        const initStatus = await checkInitializationStatus();
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
          clearInterval(pollingRef.current);
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
          await initializeKeyEventLog();
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
      };
      checkStatus();
    }
  }, [privateKey, isInitialized, isSubmitting, parsedData]);

  // Fetch balance (unchanged)
  const fetchBalance = async () => {
    if (privateKey && isInitialized) {
      try {
        const address =
          parsedData.rotation !== log.length
            ? parsedData.address2
            : parsedData.address1;

        setLoading(true);
        const response = await axios.get(
          `${import.meta.env.VITE_API_URL}/get-graph-wallet?address=${address}`
        );

        setLoading(false);
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
      }
    }
  };

  useEffect(() => {
    fetchBalance();
  }, [privateKey, isInitialized]);

  // Capture QR code (unchanged)
  const capture = () => {
    return new Promise((resolve, reject) => {
      const imageSrc = webcamRef.current?.getScreenshot();
      if (!imageSrc) {
        reject(new Error("Failed to capture image from webcam"));
        return;
      }

      const img = new Image();
      img.src = imageSrc;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, img.width, img.height);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
          resolve(code.data);
        } else {
          reject(new Error("No QR code found"));
        }
      };
      img.onerror = () => reject(new Error("Failed to load captured image"));
    });
  };

  // Process scanned QR code (unchanged)
  const processScannedQR = async (qrData, isTransactionFlow = false) => {
    try {
      const [wifString, address2, address3, prevaddress1, rotation] =
        qrData.split("|");
      const newPrivateKey = fromWIF(wifString);
      const address1 = getP2PKH(newPrivateKey.publicKey);
      const newParsedData = {
        address1,
        wif: wifString,
        address2,
        address3,
        prevaddress1,
        rotation: parseInt(rotation, 10),
      };

      const { isValidKey, log: fetchedLog } = await getKeyLog(newPrivateKey);
      if (!isValidKey) {
        throw new Error("Failed to fetch key event log");
      }
      if (isTransactionFlow && isInitialized) {
        if (newParsedData.rotation !== fetchedLog.length + 1) {
          throw new Error(
            `Incorrect key rotation. Expected rotation ${log.length + 1}, got ${
              newParsedData.rotation
            }`
          );
        }
      } else {
        if (newParsedData.rotation !== fetchedLog.length) {
          throw new Error(
            `Incorrect key rotation. Expected rotation ${log.length}, got ${newParsedData.rotation}`
          );
        }
      }

      validateKeyContinuity(newParsedData, fetchedLog, isTransactionFlow);

      return { newPrivateKey, newParsedData };
    } catch (error) {
      console.error("QR code parsing error:", error);
      throw error;
    }
  };

  // Handle key scan (unchanged)
  const handleKeyScan = async () => {
    try {
      setIsScannerOpen(true);
      let qrData;
      let attempts = 0;
      const maxAttempts = 100;

      while (attempts < maxAttempts) {
        try {
          qrData = await capture();
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
      const { newPrivateKey, newParsedData } = await processScannedQR(qrData);

      localStorage.removeItem("walletPrivateKey");
      localStorage.removeItem("walletWif");
      localStorage.removeItem("walletParsedData");
      localStorage.removeItem("walletIsInitialized");

      setPrivateKey(newPrivateKey);
      setWif(newParsedData.wif);
      setParsedData(newParsedData);

      notifications.show({
        title: "Key Loaded",
        message: `Wallet key for rotation ${newParsedData.rotation} loaded successfully.`,
        color: "green",
      });

      const initStatus = await checkInitializationStatus();
      if (initStatus.status === "no_transaction") {
        notifications.show({
          title: "No Key Event Log Entry",
          message: "Submitting wallet initialization transaction.",
          color: "yellow",
        });
        await initializeKeyEventLog();
      } else if (initStatus.status === "pending_mempool") {
        notifications.show({
          title: "Pending Transaction",
          message: `Key at rotation ${newParsedData.rotation} has a pending transaction in mempool. Waiting for confirmation.`,
          color: "yellow",
        });
      }
    } catch (error) {
      notifications.show({
        title: "Error",
        message:
          error.message || "Failed to process QR code. Please try again.",
        color: "red",
      });
      setIsScannerOpen(true);
    }
  };

  // Sign transaction (unchanged)
  const signTransaction = async () => {
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
          qrData = await capture();
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
      const { newPrivateKey, newParsedData } = await processScannedQR(
        qrData,
        true
      );

      try {
        const res = await axios.get(
          `${import.meta.env.VITE_API_URL}/get-graph-wallet?address=${getP2PKH(
            privateKey.publicKey
          )}&amount_needed=${balance}`
        );
        const newUnspent = res.data.unspent_transactions.concat(
          res.data.unspent_mempool_txns
        );
        const inputs = newUnspent.reduce(
          (accumulator, utxo) => {
            if (accumulator.total >= totalAmount) return accumulator;
            const utxoValue = utxo.outputs.reduce(
              (sum, output) => sum + output.value,
              0
            );
            accumulator.selected.push({ id: utxo.id });
            accumulator.total += utxoValue;
            return accumulator;
          },
          { selected: [], total: 0 }
        );

        if (inputs.total < totalAmount) {
          throw new Error("Insufficient funds");
        }

        const transactionOutputs = recipients.map((r) => ({
          to: validateBitcoinAddress(r.address),
          value: Number(r.amount),
        }));

        transactionOutputs.push({
          to: parsedData.address2,
          value: balance - totalAmount,
        });

        const actualTxn = new Transaction({
          key: privateKey,
          public_key: Buffer.from(privateKey.publicKey).toString("hex"),
          twice_prerotated_key_hash: parsedData.address3,
          prerotated_key_hash: parsedData.address2,
          inputs: inputs.selected,
          outputs: transactionOutputs,
          relationship: "",
          relationship_hash: await generateSHA256(""),
          public_key_hash: getP2PKH(privateKey.publicKey),
          prev_public_key_hash: parsedData.prevaddress1,
        });
        await actualTxn.hashAndSign();

        let newTransactionOutputs = [
          {
            to: newParsedData.address2,
            value: balance - totalAmount,
          },
        ];

        const zeroValueTxn = new Transaction({
          key: newPrivateKey,
          public_key: Buffer.from(newPrivateKey.publicKey).toString("hex"),
          twice_prerotated_key_hash: newParsedData.address3,
          prerotated_key_hash: newParsedData.address2,
          inputs: [{ id: actualTxn.id }],
          outputs: newTransactionOutputs,
          relationship: "",
          relationship_hash: await generateSHA256(""),
          public_key_hash: getP2PKH(newPrivateKey.publicKey),
          prev_public_key_hash: getP2PKH(privateKey.publicKey),
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

        setLoading(false);
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
    }
  };

  // Recipient management (unchanged)
  const addRecipient = () => {
    setRecipients([...recipients, { address: "", amount: "" }]);
  };

  const removeRecipient = (index) => {
    if (recipients.length > 1) {
      setRecipients(recipients.filter((_, i) => i !== index));
    }
  };

  const updateRecipient = (index, field, value) => {
    const updatedRecipients = [...recipients];
    updatedRecipients[index][field] =
      field === "amount" ? value.toString() : value;
    setRecipients(updatedRecipients);
  };

  const copyAddressToClipboard = () => {
    if (parsedData?.address1) {
      navigator.clipboard
        .writeText(parsedData.address1)
        .then(() => {
          notifications.show({
            title: "Success",
            message: "Address copied to clipboard",
            color: "green",
          });
        })
        .catch(() => {
          notifications.show({
            title: "Error",
            message: "Failed to copy address",
            color: "red",
          });
        });
    }
  };

  // Pagination (unchanged)
  const totalItems = combinedHistory.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedHistory = combinedHistory.slice(startIndex, endIndex);

  return (
    <Container size="lg" py="xl">
      <Notifications position="top-center" />
      <Card
        shadow="sm"
        padding="lg"
        radius="md"
        withBorder
        styles={styles.card}
      >
        <WalletHeader styles={styles} />
        <WalletStateHandler
          privateKey={privateKey}
          isSubmitting={isSubmitting}
          isInitialized={isInitialized}
          parsedData={parsedData}
          log={log}
          onScanKey={handleKeyScan}
          onReset={resetWalletState}
          styles={styles}
        />
        {privateKey && isInitialized && (
          <>
            {balance !== null && (
              <WalletBalance
                balance={balance}
                parsedData={parsedData}
                log={log}
                onRefresh={() => {
                  fetchBalance();
                  buildTransactionHistory();
                }}
                onCopyAddress={copyAddressToClipboard}
                onShowQR={() => setIsQRModalOpen(true)}
                styles={styles}
              />
            )}
            <Text mb="md">
              {parsedData.rotation === log.length
                ? `Wallet is ready. You can send transactions with this key (rotation ${parsedData.rotation}).`
                : `Please scan the next key (rotation ${log.length}) to sign transactions.`}
            </Text>
            <Button
              onClick={handleKeyScan}
              disabled={log.length === parsedData.rotation}
              color="teal"
              variant="outline"
              mt="md"
            >
              Scan Next Key (Rotation: {log.length})
            </Button>
            {parsedData.rotation === log.length && (
              <TransactionForm
                recipients={recipients}
                onAddRecipient={addRecipient}
                onRemoveRecipient={removeRecipient}
                onUpdateRecipient={updateRecipient}
                onSendTransaction={signTransaction}
                setFocusedRotation={setFocusedRotation}
                styles={styles}
              />
            )}
            {combinedHistory.length > 0 && (
              <TransactionHistory
                combinedHistory={paginatedHistory}
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                styles={styles}
              />
            )}
          </>
        )}

        <Button
          onClick={resetWalletState}
          color="red"
          variant="outline"
          mt="xl"
        >
          Erase Wallet Cache
        </Button>
        <QRScannerModal
          isOpen={isScannerOpen}
          onClose={() => {
            setIsScannerOpen(false);
            setIsTransactionFlow(false);
          }}
          webcamRef={webcamRef}
          parsedData={parsedData}
          log={log}
          styles={styles}
        />
        <QRDisplayModal
          isOpen={isQRModalOpen}
          onClose={() => setIsQRModalOpen(false)}
          parsedData={parsedData}
          log={log}
          styles={styles}
        />
      </Card>
    </Container>
  );
};

export default Wallet2;
