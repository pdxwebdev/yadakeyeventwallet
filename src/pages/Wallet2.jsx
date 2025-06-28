import { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  Button,
  Card,
  Text,
  Title,
  Table,
  Modal,
  TextInput,
  Group,
  Container,
  useMantineColorScheme,
  ActionIcon,
  Stack,
  NumberInput,
  Flex,
  Loader,
  Accordion, // Add Accordion to imports
} from "@mantine/core";
import { Transaction } from "../utils/transaction";
import Webcam from "react-webcam";
import jsQR from "jsqr";
import { Notifications, notifications } from "@mantine/notifications";
import {
  IconTrash,
  IconRefresh,
  IconCopy,
  IconQrcode,
} from "@tabler/icons-react";
import {
  fromWIF,
  generateSHA256,
  getP2PKH,
  validateBitcoinAddress,
} from "../utils/hdWallet";
import { QRCodeSVG } from "qrcode.react"; // Corrected import
import { useAppContext } from "../context/AppContext";

const Wallet2 = () => {
  const { colorScheme } = useMantineColorScheme();
  const [transactions, setTransactions] = useState([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false); // State for QR code modal
  const [parsedData, setParsedData] = useState(null);
  const [recipients, setRecipients] = useState([{ address: "", amount: "" }]);
  const [privateKey, setPrivateKey] = useState(null);
  const [wif, setWif] = useState("");
  const [log, setLog] = useState([]);
  const [balance, setBalance] = useState(null);
  const [focusedRotation, setFocusedRotation] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWaitingForConfirmation, setIsWaitingForConfirmation] =
    useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [submissionTime, setSubmissionTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  const [hasScanned, setHasScanned] = useState(false);
  const [isTransactionFlow, setIsTransactionFlow] = useState(false);

  const webcamRef = useRef(null);
  const pollingRef = useRef(null);
  const { loading, setLoading } = useAppContext();

  // Styles
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

  // Format elapsed time
  const formatElapsedTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `Elapsed time: ${minutes} minute${
      minutes !== 1 ? "s" : ""
    }, ${remainingSeconds} second${remainingSeconds !== 1 ? "s" : ""}`;
  };

  // Update elapsed time every second during confirmation
  useEffect(() => {
    let timer;
    if (isWaitingForConfirmation && submissionTime) {
      timer = setInterval(() => {
        const now = Date.now();
        const elapsedSeconds = Math.floor((now - submissionTime) / 1000);
        setElapsedTime(elapsedSeconds);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isWaitingForConfirmation, submissionTime]);

  // Load state from localStorage on mount
  useEffect(() => {
    const storedPrivateKey = localStorage.getItem("walletPrivateKey");
    const storedWif = localStorage.getItem("walletWif");
    const storedParsedData = localStorage.getItem("walletParsedData");
    const storedIsWaiting = localStorage.getItem(
      "walletIsWaitingForConfirmation"
    );
    const storedSubmissionTime = localStorage.getItem("walletSubmissionTime");
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
        if (storedIsWaiting === "true") {
          setIsWaitingForConfirmation(true);
          setIsPolling(true);
          if (storedSubmissionTime) {
            setSubmissionTime(parseInt(storedSubmissionTime, 10));
          }
        }
        // Fetch key event log if wallet is initialized
        if (storedIsInitialized === "true") {
          getKeyLog(privateKeyObj).then(({ log }) => {
            setLog([...log]);
          });
        }
      } catch (error) {
        console.error("Error restoring private key:", error);
      }
    }
  }, []);

  // Save state to localStorage when it changes
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
    localStorage.setItem(
      "walletIsWaitingForConfirmation",
      isWaitingForConfirmation.toString()
    );
  }, [isWaitingForConfirmation]);

  useEffect(() => {
    if (submissionTime) {
      localStorage.setItem("walletSubmissionTime", submissionTime.toString());
    } else {
      localStorage.removeItem("walletSubmissionTime");
    }
  }, [submissionTime]);

  useEffect(() => {
    localStorage.setItem("walletIsInitialized", isInitialized.toString());
  }, [isInitialized]);

  const resetWalletState = () => {
    setPrivateKey(null);
    setWif("");
    setParsedData(null);
    setIsInitialized(false);
    setIsWaitingForConfirmation(false);
    setIsPolling(false);
    setSubmissionTime(null);
    setLog([]);
    localStorage.removeItem("walletPrivateKey");
    localStorage.removeItem("walletWif");
    localStorage.removeItem("walletParsedData");
    localStorage.removeItem("walletIsWaitingForConfirmation");
    localStorage.removeItem("walletSubmissionTime");
    localStorage.removeItem("walletIsInitialized");
    notifications.show({
      title: "Wallet Reset",
      message:
        "Wallet state cleared. Please scan the QR code for the active key.",
      color: "blue",
    });
  };

  // Fetch key event log
  const getKeyLog = async (privateKey) => {
    const pk = Buffer.from(privateKey.publicKey).toString("hex");
    try {
      const res = await axios.get(
        `${
          import.meta.env.VITE_API_URL
        }/key-event-log?username_signature=asdf&public_key=${pk}`
      );
      const keyEventLog = res.data.key_event_log || [];
      setLog([...keyEventLog]);
      // Calculate confirmed log length (mempool: false or undefined)
      const confirmedLog = keyEventLog.filter((entry) => !entry.mempool);
      console.log(
        "DEBUG: getKeyLog - Confirmed log length set to:",
        confirmedLog.length
      );
      console.log(
        "DEBUG: Key event log:",
        JSON.stringify(keyEventLog, null, 2)
      );
      return { isValidKey: true, log: keyEventLog };
    } catch (error) {
      console.error("DEBUG: Error fetching key event log:", error);
      notifications.show({
        title: "Error",
        message: "Failed to load key event log",
        color: "red",
      });

      return { isValidKey: false, log: [] };
    }
  };

  // Check initialization status
  const checkInitializationStatus = async () => {
    if (!privateKey || !parsedData) {
      console.log("DEBUG: No private key or parsedData available");
      return { status: "no_private_key" };
    }

    try {
      const { isValidKey, log: keyEventLog } = await getKeyLog(privateKey);
      const address = getP2PKH(privateKey.publicKey);
      console.log(
        "DEBUG: Key event log:",
        JSON.stringify(keyEventLog, null, 2)
      );
      console.log("DEBUG: Current public key hash:", address);
      console.log("DEBUG: Parsed data:", JSON.stringify(parsedData, null, 2));
      console.log("DEBUG: isValidKey:", isValidKey);

      if (!isValidKey) {
        console.log("DEBUG: getKeyLog failed");
        return { status: "error" };
      }

      // Check if the current key has a pending transaction in mempool
      const pendingEntry = keyEventLog.find(
        (entry) => entry.public_key_hash === address && entry.mempool === true
      );
      if (pendingEntry && keyEventLog.length === 1) {
        console.log("DEBUG: Current key has a pending transaction in mempool");
        setIsWaitingForConfirmation(true);
        setIsPolling(true);
        if (!submissionTime) {
          setSubmissionTime(Date.now());
        }
        return { status: "pending_mempool" };
      }

      // Check if the current key is the active key (matches prerotated_key_hash of latest confirmed entry)
      if (keyEventLog.length > 0) {
        const latestLogEntry = keyEventLog[keyEventLog.length - 1];
        if (latestLogEntry && latestLogEntry.public_key_hash === address) {
          console.log(
            "DEBUG: Current key is active (matches prerotated_key_hash)"
          );
          return { status: "active" };
        }
      }

      // Check if the key is revoked (in confirmed log as public_key_hash)
      const isKeyInLog = keyEventLog.some(
        (entry) => !entry.mempool && entry.public_key_hash === address
      );
      if (isKeyInLog) {
        const logEntry = keyEventLog.find(
          (entry) => !entry.mempool && entry.public_key_hash === address
        );
        // Validate continuity for revoked key
        const isValidContinuity =
          (parsedData.rotation === 0 && !parsedData.prevaddress1) ||
          (parsedData.prevaddress1 &&
            keyEventLog.some(
              (e) => !e.mempool && e.public_key_hash === parsedData.prevaddress1
            ) &&
            logEntry.prerotated_key_hash === parsedData.address2 &&
            logEntry.twice_prerotated_key_hash === parsedData.address3);

        if (!isValidContinuity) {
          console.log("DEBUG: Continuity check failed for revoked key");
          return { status: "invalid_continuity" };
        }
        console.log("DEBUG: Key found in confirmed log, key is revoked");
        return { status: "revoked" };
      }

      // Key is neither active nor revoked, check if it’s the next key to initialize
      if (parsedData.rotation === keyEventLog.length) {
        // Validate continuity for new key
        if (log.length > 0) {
          const lastLogEntry = keyEventLog[keyEventLog.length - 1];
          const isValidContinuity =
            lastLogEntry.public_key_hash === parsedData.prevaddress1 &&
            lastLogEntry.prerotated_key_hash === address &&
            lastLogEntry.twice_prerotated_key_hash === parsedData.address2;

          if (!isValidContinuity) {
            console.log("DEBUG: Continuity check failed for new key");
            return { status: "invalid_continuity" };
          }
        } else if (parsedData.prevaddress1 && parsedData.rotation !== 0) {
          console.log(
            "DEBUG: No confirmed log entries but prevaddress1 provided"
          );
          return { status: "invalid_continuity" };
        }
        console.log(
          "DEBUG: Key not in confirmed log, ready for initialization"
        );
        return { status: "no_transaction" };
      }

      console.log(
        "DEBUG: Rotation mismatch, expected:",
        keyEventLog.length,
        "got:",
        parsedData.rotation
      );
      return { status: "invalid_rotation" };
    } catch (error) {
      console.error("DEBUG: Error checking key event log:", error);
      notifications.show({
        title: "Error",
        message: "Failed to check wallet status",
        color: "red",
      });
      return { status: "error" };
    }
  };

  // Initialize key event log with zero-value transaction
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
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      setLoading(false);
      if (response.status === 200) {
        notifications.show({
          title: "Success",
          message: "Zero-value transaction submitted for wallet initialization",
          color: "green",
        });
        setIsWaitingForConfirmation(true);
        setIsPolling(true);
        setSubmissionTime(Date.now());
      } else {
        throw new Error("Transaction submission failed");
      }
    } catch (error) {
      console.error("Error initializing key event log:", {
        message: error.message,
        response: error.response ? error.response.data : null,
        status: error.response ? error.response.status : null,
      });
      notifications.show({
        title: "Error",
        message: `Failed to initialize wallet: ${error.message}`,
        color: "red",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Polling effect for key event log
  useEffect(() => {
    if (isPolling && privateKey && parsedData) {
      pollingRef.current = setInterval(async () => {
        console.log("DEBUG: Polling for key event log");
        const initStatus = await checkInitializationStatus();
        console.log("DEBUG: Polling status:", initStatus);
        if (initStatus.status === "pending_mempool") {
          console.log(
            "DEBUG: Transaction still in mempool, continuing polling"
          );
          notifications.show({
            title: "Pending Transaction",
            message: "Waiting for transaction confirmation in mempool.",
            color: "yellow",
          });
        } else if (initStatus.status === "revoked") {
          console.log("DEBUG: Key is revoked, prompting for next key");
          setIsInitialized(true);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setSubmissionTime(null);
          localStorage.setItem("walletIsInitialized", "true");
          const currentRotation = parseInt(parsedData.rotation, 10);
          notifications.show({
            title: "Key Revoked",
            message: `Key at rotation ${currentRotation} is revoked. Please scan the next key (rotation ${log.length}) to sign transactions.`,
            color: "yellow",
          });
          // Do not clear localStorage here; keep parsedData for continuity
        } else if (initStatus.status === "no_transaction") {
          console.log("DEBUG: No transaction, resubmitting");
          notifications.show({
            title: "No Key Event Log Entry",
            message: "Resubmitting wallet initialization transaction.",
            color: "yellow",
          });
          setIsWaitingForConfirmation(false);
          setIsPolling(false);
          setSubmissionTime(null);
          await initializeKeyEventLog();
        } else if (
          initStatus.status === "invalid_rotation" ||
          initStatus.status === "invalid_continuity"
        ) {
          console.log(
            "DEBUG: Invalid rotation or continuity, stopping polling"
          );
          clearInterval(pollingRef.current);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setSubmissionTime(null);
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
          console.log("DEBUG: Error during polling, stopping");
          clearInterval(pollingRef.current);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setSubmissionTime(null);
          notifications.show({
            title: "Error",
            message:
              "An error occurred while checking wallet initialization. Please scan a new key.",
            color: "red",
          });
        } else if (initStatus.status === "active") {
          console.log("DEBUG: Key is active, stopping polling");
          clearInterval(pollingRef.current);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setIsInitialized(true);
          setSubmissionTime(null);
          localStorage.setItem("walletIsInitialized", "true");
        }
      }, 15000);

      return () => clearInterval(pollingRef.current);
    }
  }, [isPolling, privateKey, parsedData, log]); // Updated dependency

  // Check initialization status only for uninitialized keys
  useEffect(() => {
    if (privateKey && !isInitialized && !isSubmitting && parsedData) {
      const checkStatus = async () => {
        console.log("DEBUG: Checking initialization status");
        const initStatus = await checkInitializationStatus();
        console.log("DEBUG: Initial check status:", initStatus);
        if (initStatus.status === "pending_mempool") {
          console.log("DEBUG: Transaction in mempool, setting pending state");
          setIsWaitingForConfirmation(true);
          setIsPolling(true);
          if (!submissionTime) {
            setSubmissionTime(Date.now());
          }
          notifications.show({
            title: "Pending Transaction",
            message: "Waiting for transaction confirmation in mempool.",
            color: "yellow",
          });
        } else if (initStatus.status === "active") {
          console.log("DEBUG: Key is active, setting initialized state");
          setIsInitialized(true);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setSubmissionTime(null);
          localStorage.setItem("walletIsInitialized", "true");
        } else if (initStatus.status === "revoked") {
          console.log("DEBUG: Key revoked, setting initialized state");
          clearInterval(pollingRef.current);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setIsInitialized(true);
          setSubmissionTime(null);
          localStorage.setItem("walletIsInitialized", "true");
          const currentRotation = parseInt(parsedData.rotation, 10);
          notifications.show({
            title: "Key Revoked",
            message: `Key at rotation ${currentRotation} is revoked. Please scan the next key (rotation ${log.length}) to sign transactions.`,
            color: "yellow",
          });
          // Do not clear localStorage here
        } else if (initStatus.status === "no_transaction") {
          console.log("DEBUG: No transaction, initializing");
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
          console.log(
            "DEBUG: Invalid rotation or continuity, resetting wallet state"
          );
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
          console.log("DEBUG: Error checking status, resetting wallet state");
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
  }, [privateKey, isInitialized, isSubmitting, parsedData]); // Updated dependency

  const fetchTransactions = async () => {
    if (!privateKey || !parsedData) return;

    try {
      // Step 1: Get the key event log
      const { log: keyEventLog } = await getKeyLog(privateKey);
      console.log("DEBUG: Key event log for fetchTransactions:", keyEventLog);

      // Initialize key log entries with empty transactions arrays and totals
      const keyLogWithTransactions = keyEventLog.map((entry) => ({
        ...entry,
        transactions: [],
        totalReceived: 0,
        totalSent: 0,
      }));

      // Step 2: Collect all public keys from the key event log
      const publicKeys = keyEventLog
        .map((entry) => entry.public_key)
        .filter((pk) => pk); // Filter out undefined public keys

      console.log("DEBUG: Public keys to fetch transactions:", publicKeys);

      if (publicKeys.length === 0) {
        console.log("DEBUG: No public keys available to fetch transactions");
        setTransactions(keyLogWithTransactions);
        return;
      }

      // Map public keys to their addresses (public_key_hash)
      const publicKeyToAddress = new Map();
      keyEventLog.forEach((entry) => {
        if (entry.public_key) {
          publicKeyToAddress.set(entry.public_key, entry.public_key_hash);
        }
      });

      // Map prerotated and twice_prerotated key hashes to their rotation indices
      const keyHashToRotation = new Map();
      keyEventLog.forEach((entry, index) => {
        keyHashToRotation.set(entry.public_key_hash, index);
        if (entry.prerotated_key_hash) {
          keyHashToRotation.set(entry.prerotated_key_hash, index + 1);
        }
        if (entry.twice_prerotated_key_hash) {
          keyHashToRotation.set(entry.twice_prerotated_key_hash, index + 2);
        }
      });

      console.log(
        "DEBUG: Public key to address mapping:",
        Object.fromEntries(publicKeyToAddress)
      );
      console.log(
        "DEBUG: Key hash to rotation mapping:",
        Object.fromEntries(keyHashToRotation)
      );

      const origin = window.location.origin;
      const endpoints = [
        {
          key: "past_transactions",
          status: "Confirmed",
          type: "Sent",
          getUrl: (publicKey) =>
            `${
              import.meta.env.VITE_API_URL
            }/get-past-sent-txns?page=1&public_key=${publicKey}&origin=${encodeURIComponent(
              origin
            )}`,
        },
        {
          key: "past_pending_transactions",
          status: "Pending",
          type: "Sent",
          getUrl: (publicKey) =>
            `${
              import.meta.env.VITE_API_URL
            }/get-past-pending-sent-txns?page=1&public_key=${publicKey}&origin=${encodeURIComponent(
              origin
            )}`,
        },
        {
          key: "past_transactions",
          status: "Confirmed",
          type: "Received",
          getUrl: (publicKey) =>
            `${
              import.meta.env.VITE_API_URL
            }/get-past-received-txns?page=1&public_key=${publicKey}&origin=${encodeURIComponent(
              origin
            )}`,
        },
        {
          key: "past_pending_transactions",
          status: "Pending",
          type: "Received",
          getUrl: (publicKey) =>
            `${
              import.meta.env.VITE_API_URL
            }/get-past-pending-received-txns?page=1&public_key=${publicKey}&origin=${encodeURIComponent(
              origin
            )}`,
        },
      ];

      // Step 3: Fetch transactions for each public key
      for (const publicKey of publicKeys) {
        const address = publicKeyToAddress.get(publicKey);
        if (!address) {
          console.warn(`No address found for public key: ${publicKey}`);
          continue;
        }

        // Find the current key log entry to access prerotated_key_hash and twice_prerotated_key_hash
        const currentEntry = keyLogWithTransactions.find(
          (entry) => entry.public_key === publicKey
        );
        const prerotatedKeyHash = currentEntry?.prerotated_key_hash;
        const twicePrerotatedKeyHash = currentEntry?.twice_prerotated_key_hash;

        const transactionsForKey = [];
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
            const txns = (data[endpoint.key] || []).map((tx) => {
              const amount = tx.outputs
                .reduce((sum, output) => {
                  if (endpoint.type === "Received") {
                    return output.to === address ? sum + output.value : sum;
                  } else {
                    return output.to !== address ? sum + output.value : sum;
                  }
                }, 0)
                .toFixed(8);
              // Accumulate totals based on transaction type
              if (endpoint.type === "Received") {
                totalReceivedForKey += parseFloat(amount);
              } else if (endpoint.type === "Sent") {
                totalSentForKey += parseFloat(amount);
              }
              // Construct "to" field with actual addresses
              const toAddresses = tx.outputs.map((item) => {
                const outputAddress = item.to;
                // Check if the output is to the next rotation(s)
                if (outputAddress === prerotatedKeyHash) {
                  return `Rotation ${keyHashToRotation.get(
                    outputAddress
                  )} (${outputAddress})`;
                } else if (outputAddress === twicePrerotatedKeyHash) {
                  return `Rotation ${keyHashToRotation.get(
                    outputAddress
                  )} (${outputAddress})`;
                } else if (outputAddress === address) {
                  return `Self (${outputAddress})`;
                } else {
                  return outputAddress;
                }
              });
              const toField = toAddresses.join(", ") || address; // Fallback to own address if no outputs
              return {
                id: tx.id,
                to: toField,
                amount,
                date: new Date(tx.time * 1000).toLocaleDateString(),
                status: endpoint.status,
                type: endpoint.type,
                address: address,
                public_key: publicKey,
              };
            });
            transactionsForKey.push(...txns);
          } catch (error) {
            console.warn(`Error fetching ${url}:`, error);
            continue;
          }
        }

        // Assign transactions and totals to the corresponding key log entry
        const entryIndex = keyLogWithTransactions.findIndex(
          (entry) => entry.public_key === publicKey
        );
        if (entryIndex !== -1) {
          keyLogWithTransactions[entryIndex].transactions = transactionsForKey;
          keyLogWithTransactions[entryIndex].totalReceived =
            totalReceivedForKey.toFixed(8);
          keyLogWithTransactions[entryIndex].totalSent =
            totalSentForKey.toFixed(8);
        }
      }

      // Sort key log entries by rotation (index in original log)
      keyLogWithTransactions.sort((a, b) => {
        const aIndex = keyEventLog.indexOf(a);
        const bIndex = keyEventLog.indexOf(b);
        return aIndex - bIndex;
      });

      setTransactions(keyLogWithTransactions);
      console.log("DEBUG: Key log with transactions:", keyLogWithTransactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      notifications.show({
        title: "Error",
        message: "Failed to load key event log and transactions",
        color: "red",
      });
    }
  };
  // Fetch transactions
  useEffect(() => {
    if (!privateKey || !isInitialized) return;

    fetchTransactions();
  }, [privateKey, isInitialized]);

  // Fetch balance
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

  // Process scanned QR code
  const processScannedQR = async (qrData, isTransactionFlow = false) => {
    try {
      // Parse QR code: wif|address2|address3|prevaddress1|rotation
      const [wifString, address2, address3, prevaddress1, rotation] =
        qrData.split("|");
      console.log("DEBUG: Parsed QR code:", {
        wifString: wifString.slice(0, 10) + "...",
        address2,
        address3,
        prevaddress1,
        rotation,
      });

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
      const newPublicKeyHash = address1;
      console.log("DEBUG: New parsed data:", newParsedData);

      // Fetch key event log for the scanned key
      const { isValidKey, log: fetchedLog } = await getKeyLog(newPrivateKey);
      console.log("DEBUG: Fetched log:", JSON.stringify(fetchedLog, null, 2));

      if (!isValidKey) {
        throw new Error("Failed to fetch key event log");
      }
      if (isTransactionFlow) {
        if (newParsedData.rotation !== fetchedLog.length + 1) {
          throw new Error(
            `Incorrect key rotation. Expected rotation ${
              fetchedLog.length + 1
            }, got ${newParsedData.rotation}`
          );
        }
      } else {
        if (newParsedData.rotation !== fetchedLog.length) {
          throw new Error(
            `Incorrect key rotation. Expected rotation ${fetchedLog.length}, got ${newParsedData.rotation}`
          );
        }
      }

      // Validate continuity for non-initial keys
      if (newParsedData.rotation > 0) {
        if (fetchedLog.length === 0) {
          throw new Error(
            `No confirmed key event log entries found, but rotation ${newParsedData.rotation} requires a previous key`
          );
        }

        let isValidContinuity = false;
        if (isTransactionFlow) {
          // Transaction flow: Validate against current parsedData (rotation N)
          isValidContinuity =
            newParsedData.prevaddress1 === parsedData.address1 &&
            newParsedData.address2 === parsedData.address3 &&
            (!newParsedData.prevaddress1 ||
              parsedData.address1 === newParsedData.prevaddress1);
        } else {
          // Non-transaction flow: Validate against last confirmed log entry (rotation N-1)
          const lastEntry = fetchedLog[fetchedLog.length - 1];
          if (!lastEntry) {
            throw new Error(
              "No confirmed key event log entries found for continuity check"
            );
          }
          isValidContinuity =
            lastEntry.prerotated_key_hash === newPublicKeyHash &&
            lastEntry.twice_prerotated_key_hash === newParsedData.address2 &&
            (!newParsedData.prevaddress1 ||
              lastEntry.public_key_hash === newParsedData.prevaddress1);
        }

        if (!isValidContinuity) {
          throw new Error(
            `The scanned key (rotation ${newParsedData.rotation}) does not maintain continuity with the previous key`
          );
        }
      }

      return { newPrivateKey, newParsedData, newPublicKeyHash };
    } catch (error) {
      console.error("DEBUG: QR code parsing error:", error);
      throw error;
    }
  };
  // Handle key scan for initial wallet setup or key update
  const handleKeyScan = async () => {
    try {
      setIsScannerOpen(true);
      let qrData;
      let attempts = 0;
      const maxAttempts = 100; // ~30 seconds at 300ms intervals

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

      // Update wallet state
      localStorage.removeItem("walletPrivateKey");
      localStorage.removeItem("walletWif");
      localStorage.removeItem("walletParsedData");
      localStorage.removeItem("walletIsWaitingForConfirmation");
      localStorage.removeItem("walletSubmissionTime");
      localStorage.removeItem("walletIsInitialized");

      setPrivateKey(newPrivateKey);
      setWif(newParsedData.wif);
      setParsedData(newParsedData);

      notifications.show({
        title: "Key Loaded",
        message: `Wallet key for rotation ${newParsedData.rotation} loaded successfully. You can now send transactions.`,
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
      console.error("DEBUG: Key scan error:", error);
      notifications.show({
        title: "Error",
        message:
          error.message || "Failed to process QR code. Please try again.",
        color: "red",
      });
      setIsScannerOpen(true); // Reopen scanner for retry
    }
  };

  // Sign transaction with key rotation
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
      // Prompt user to scan the next key
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
      const maxAttempts = 100; // ~30 seconds at 300ms intervals

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
      const { newPrivateKey, newParsedData, newPublicKeyHash } =
        await processScannedQR(qrData, true);

      // Process transaction
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
          public_key_hash: newPublicKeyHash,
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
          // Update wallet state
          localStorage.removeItem("walletPrivateKey");
          localStorage.removeItem("walletWif");
          localStorage.removeItem("walletParsedData");
          localStorage.removeItem("walletIsWaitingForConfirmation");
          localStorage.removeItem("walletSubmissionTime");
          localStorage.removeItem("walletIsInitialized");

          setPrivateKey(newPrivateKey);
          setWif(newParsedData.wif);
          setParsedData(newParsedData);
          setRecipients([{ address: "", amount: "" }]);
          setIsTransactionFlow(false);

          notifications.show({
            title: "Success",
            message:
              "Transaction and key rotation confirmation submitted successfully. Waiting for initialization of the new key.",
            color: "green",
          });
        } else {
          throw new Error("Transaction or confirmation submission failed");
        }
      } catch (error) {
        console.error("DEBUG: Transaction error:", error);
        throw new Error(`Failed to process transaction: ${error.message}`);
      }
    } catch (error) {
      console.error("DEBUG: Transaction scan error:", error);
      notifications.show({
        title: "Error",
        message:
          error.message || "Failed to process QR code. Please try again.",
        color: "red",
      });
      setIsScannerOpen(true); // Reopen scanner for retry
    }
  };

  useEffect(() => {
    let interval;
    if (isScannerOpen && !hasScanned) {
      interval = setInterval(capture, 300);
    }
    return () => clearInterval(interval);
  }, [isScannerOpen, hasScanned]); // Add hasScanned to dependencies

  // Helper functions to manage recipients
  const addRecipient = () => {
    setRecipients([...recipients, { address: "", amount: "" }]);
  };

  const removeRecipient = (rotation) => {
    if (recipients.length > 1) {
      setRecipients(recipients.filter((_, i) => i !== rotation));
    }
  };

  const updateRecipient = (rotation, field, value) => {
    const updatedRecipients = [...recipients];
    updatedRecipients[rotation][field] =
      field === "amount" ? value.toString() : value;
    setRecipients(updatedRecipients);
  };

  const handleBalanceClick = () => {
    if (balance === null || balance <= 0) return;

    if (recipients.length === 1) {
      updateRecipient(0, "amount", balance.toString());
    } else {
      const populatedAmounts = recipients.reduce((sum, r, i) => {
        const amount = parseFloat(r.amount);
        return isNaN(amount) || i === focusedRotation ? sum : sum + amount;
      }, 0);

      const remainingBalance = balance - populatedAmounts;
      if (remainingBalance <= 0) return;

      const recipientsToDistribute = recipients.filter(
        (r, i) =>
          i === focusedRotation || !r.amount || isNaN(parseFloat(r.amount))
      ).length;

      if (recipientsToDistribute === 0) return;

      const amountPerRecipient = (
        remainingBalance / recipientsToDistribute
      ).toFixed(8);

      const updatedRecipients = recipients.map((recipient, rotation) => {
        if (
          rotation === focusedRotation ||
          !recipient.amount ||
          isNaN(parseFloat(recipient.amount))
        ) {
          return { ...recipient, amount: amountPerRecipient.toString() };
        }
        return recipient;
      });

      setRecipients(updatedRecipients);
    }
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
        <Title order={2} mb="md">
          Wallet
        </Title>

        {!privateKey ? (
          <>
            <Text mb="md">Please scan a QR code to load your wallet.</Text>
            <Button
              onClick={handleKeyScan}
              color="teal"
              variant="outline"
              mt="md"
            >
              Scan Key (Rotation: {log.length})
            </Button>
          </>
        ) : isSubmitting ? (
          <Stack align="center" spacing="md">
            <Loader color="teal" />
            <Text>Submitting wallet initialization...</Text>
          </Stack>
        ) : isWaitingForConfirmation ? (
          <Stack align="center" spacing="md">
            <Loader color="teal" />
            <Text>
              Waiting for transaction confirmation in mempool, this should take
              10 to 20 minutes. Current rotation: {parsedData.rotation}
            </Text>
            <Text>{formatElapsedTime(elapsedTime)}</Text>
            <Text>
              In the meantime, send some YDA to your new wallet's address.
            </Text>
            <QRCodeSVG
              value={parsedData.address2}
              size={200}
              bgColor={colorScheme === "dark" ? "#1A1B1E" : "#FFFFFF"}
              fgColor={colorScheme === "dark" ? "#FFFFFF" : "#000000"}
            />
            <Text>{parsedData.address2}</Text>
            <Button onClick={resetWalletState} color="red" variant="outline">
              Reset Wallet State
            </Button>
          </Stack>
        ) : !isInitialized ? (
          <Stack align="center" spacing="md">
            <Text>
              Current key (rotation {parsedData.rotation}) is not initialized.
              Please scan the correct key (rotation {log.length}) to proceed.
            </Text>
            <Button onClick={handleKeyScan} color="teal" variant="outline">
              Scan Key (Rotation: {log.length})
            </Button>
            <Button onClick={resetWalletState} color="red" variant="outline">
              Reset Wallet State
            </Button>
          </Stack>
        ) : (
          <>
            {balance !== null && (
              <Card shadow="xs" padding="md" mb="md" styles={styles.nestedCard}>
                <Flex direction="row" justify="space-between">
                  <Group justify="space-between" align="center">
                    <div
                      onClick={handleBalanceClick}
                      style={{ cursor: "pointer" }}
                    >
                      <Text fw={500} styles={styles.title}>
                        Wallet Balance
                      </Text>
                      <Text>{balance} YDA</Text>
                    </div>
                    <ActionIcon
                      onClick={() => {
                        fetchBalance();
                        fetchTransactions();
                      }}
                      color="teal"
                      variant="outline"
                      title="Refresh Balance"
                    >
                      <IconRefresh size={16} />
                    </ActionIcon>
                  </Group>

                  <Flex direction="column">
                    <Text fw={500}>
                      Address (Rotation:{" "}
                      {parsedData.rotation !== log.length
                        ? parsedData.rotation + 1
                        : parsedData.rotation}
                      )
                    </Text>
                    <Group spacing="xs" align="center">
                      <Text>
                        {parsedData.rotation !== log.length
                          ? parsedData.address2
                          : parsedData.address1}
                      </Text>
                      <ActionIcon
                        onClick={copyAddressToClipboard}
                        color="teal"
                        variant="outline"
                        title="Copy Address"
                      >
                        <IconCopy size={16} />
                      </ActionIcon>
                      <ActionIcon
                        onClick={() => f(true)}
                        color="teal"
                        variant="outline"
                        title="Show QR Code"
                      >
                        <IconQrcode size={16} />
                      </ActionIcon>
                    </Group>
                  </Flex>
                </Flex>
              </Card>
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
              <>
                <Title order={3} mt="lg" mb="md">
                  Send Transaction
                </Title>
                {recipients.map((recipient, rotation) => (
                  <Group key={rotation} mb="sm" align="flex-end">
                    <TextInput
                      label="Recipient Address"
                      placeholder="Enter address"
                      value={recipient.address}
                      onChange={(e) =>
                        updateRecipient(rotation, "address", e.target.value)
                      }
                      styles={{ input: styles.input, label: styles.inputLabel }}
                      style={{ flex: 2 }}
                    />
                    <NumberInput
                      label="Amount (YDA)"
                      placeholder="Enter amount"
                      value={recipient.amount}
                      onChange={(value) =>
                        updateRecipient(rotation, "amount", value)
                      }
                      onFocus={() => setFocusedRotation(rotation)}
                      decimalScale={8}
                      styles={{ input: styles.input, label: styles.inputLabel }}
                      style={{ flex: 1 }}
                      min={0}
                      step={0.00000001}
                    />
                    {recipients.length > 1 && (
                      <ActionIcon
                        color="red"
                        onClick={() => removeRecipient(rotation)}
                        variant="outline"
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                ))}
                <Group mt="md">
                  <Button
                    onClick={addRecipient}
                    color="teal"
                    variant="outline"
                    styles={styles.button}
                  >
                    Add Recipient
                  </Button>
                  <Button
                    onClick={signTransaction}
                    color="teal"
                    styles={styles.button}
                  >
                    Send Transaction
                  </Button>
                </Group>
              </>
            )}

            {transactions.length > 0 && (
              <Card shadow="xs" padding="md" mt="lg" styles={styles.nestedCard}>
                <Title order={3} mb="md">
                  Key Event Log
                </Title>
                <div style={{ overflowX: "auto" }}>
                  <Table striped highlightOnHover styles={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.tableHeader}>Rotation</th>
                        <th style={styles.tableHeader}>Public Key Hash</th>
                        <th style={styles.tableHeader}>Prerotated Key Hash</th>
                        <th style={styles.tableHeader}>
                          Twice Prerotated Key Hash
                        </th>
                        <th style={styles.tableHeader}>Total Received (YDA)</th>
                        <th style={styles.tableHeader}>Total Sent (YDA)</th>
                        <th style={styles.tableHeader}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((entry, index) => (
                        <tr key={entry.public_key_hash || index}>
                          <td>{index}</td>
                          <td>{entry.public_key_hash}</td>
                          <td>{entry.prerotated_key_hash || "N/A"}</td>
                          <td>{entry.twice_prerotated_key_hash || "N/A"}</td>
                          <td>{entry.totalReceived}</td>
                          <td>{entry.totalSent}</td>
                          <td>{entry.mempool ? "Pending" : "Confirmed"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                <Accordion variant="contained" mt="md">
                  {transactions.map((entry, index) => {
                    console.log(entry);
                    return (
                      <Accordion.Item
                        value={entry.public_key_hash || `entry-${index}`}
                        key={entry.public_key_hash || index}
                      >
                        <Accordion.Control>
                          <Text>
                            Transactions for Rotation {index} (
                            {entry.public_key_hash.slice(0, 8)}...)
                          </Text>
                        </Accordion.Control>
                        <Accordion.Panel>
                          {entry.transactions.length > 0 ? (
                            <Table
                              striped
                              highlightOnHover
                              styles={styles.table}
                            >
                              <thead>
                                <tr>
                                  <th style={styles.tableHeader}>ID</th>
                                  <th style={styles.tableHeader}>To</th>
                                  <th style={styles.tableHeader}>
                                    Amount (YDA)
                                  </th>
                                  <th style={styles.tableHeader}>Date</th>
                                  <th style={styles.tableHeader}>Status</th>
                                  <th style={styles.tableHeader}>Type</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entry.transactions.map((txn) => (
                                  <tr key={txn.id}>
                                    <td>
                                      <a
                                        href={`${
                                          import.meta.env.VITE_API_URL
                                        }/explorer?term=${txn.id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        {txn.id.slice(0, 8)}...
                                      </a>
                                    </td>
                                    <td>{txn.to}</td>
                                    <td>{txn.amount}</td>
                                    <td>{txn.date}</td>
                                    <td>{txn.status}</td>
                                    <td>{txn.type}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          ) : (
                            <Text>No transactions for this key.</Text>
                          )}
                        </Accordion.Panel>
                      </Accordion.Item>
                    );
                  })}
                </Accordion>
                <Button
                  onClick={resetWalletState}
                  color="red"
                  variant="outline"
                  mt="xl"
                >
                  Erase Wallet Cache
                </Button>
              </Card>
            )}
          </>
        )}

        {parsedData && (
          <Modal
            opened={isScannerOpen}
            onClose={() => {
              setIsScannerOpen(false);
              setIsTransactionFlow(false);
            }}
            title={`Scan QR Code for ration ${
              parsedData.rotation !== log.length
                ? parsedData.rotation + 1
                : parsedData.rotation
            }`}
            size="lg"
            styles={{ modal: styles.modal, title: styles.title }}
          >
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              width="100%"
              videoConstraints={{ facingMode: "environment" }}
              style={styles.webcam}
            />
          </Modal>
        )}

        <Modal
          opened={isQRModalOpen}
          onClose={() => setIsQRModalOpen(false)}
          title="Wallet Address QR Code"
          size="sm"
          styles={{ modal: styles.qrModal, title: styles.title }}
        >
          {parsedData?.address1 ? (
            <>
              <QRCodeSVG
                value={parsedData.address2}
                size={200}
                bgColor={colorScheme === "dark" ? "#1A1B1E" : "#FFFFFF"}
                fgColor={colorScheme === "dark" ? "#FFFFFF" : "#000000"}
              />
              parsedData.address2
            </>
          ) : (
            <Text>No address available</Text>
          )}
        </Modal>
      </Card>
    </Container>
  );
};

export default Wallet2;
