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
import { fromWIF, generateSHA256, getP2PKH } from "../utils/hdWallet";
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
  const [confirmedLogLength, setConfirmedLogLength] = useState(0); // New state
  const [hasScanned, setHasScanned] = useState(false);
  const [isTransactionFlow, setIsTransactionFlow] = useState(false);
  const confirmedLogLengthRef = useRef(0); // New ref to track latest value
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

  useEffect(() => {
    confirmedLogLengthRef.current = confirmedLogLength;
  }, [confirmedLogLength]);

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
        resetWalletState();
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
    setConfirmedLogLength(0);
    confirmedLogLengthRef.current = 0;
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
      setConfirmedLogLength(confirmedLog.length);
      confirmedLogLengthRef.current = confirmedLog.length; // Update ref synchronously
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
      setConfirmedLogLength(0);
      confirmedLogLengthRef.current = 0; // Reset ref on error
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
      console.log("DEBUG: Confirmed log length:", confirmedLogLength);

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

      // Use confirmedLogLength for expected rotation
      const expectedRotation = confirmedLogLength;

      // Check if the current key is the active key (matches prerotated_key_hash of latest confirmed entry)
      if (confirmedLogLength > 0) {
        const latestLogEntry = keyEventLog.find(
          (entry) =>
            !entry.mempool &&
            keyEventLog.indexOf(entry) === confirmedLogLength - 1
        ); // Newest confirmed entry
        if (latestLogEntry && latestLogEntry.prerotated_key_hash === address) {
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
      if (parsedData.rotation === expectedRotation) {
        // Validate continuity for new key
        if (confirmedLogLength > 0) {
          const lastLogEntry = keyEventLog.find(
            (entry) =>
              !entry.mempool &&
              keyEventLog.indexOf(entry) === confirmedLogLength - 1
          ); // Newest confirmed entry
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
        expectedRotation,
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
      resetWalletState();
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
            message: `Key at rotation ${currentRotation} is revoked. Please scan the next key (rotation ${confirmedLogLength}) to sign transactions.`,
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
                ? `Expected key rotation ${confirmedLogLength}, but current key is rotation ${parsedData.rotation}. Please scan the correct key.`
                : "The key does not maintain continuity with the key event log. Please scan a valid key.",
            color: "red",
          });
          resetWalletState();
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
          resetWalletState();
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
  }, [isPolling, privateKey, parsedData, confirmedLogLength]); // Updated dependency

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
            message: `Key at rotation ${currentRotation} is revoked. Please scan the next key (rotation ${confirmedLogLength}) to sign transactions.`,
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
                ? `Expected key rotation ${confirmedLogLength}, but current key is rotation ${parsedData.rotation}. Please scan the correct key.`
                : "The key does not maintain continuity with the key event log. Please scan a valid key.",
            color: "red",
          });
          resetWalletState();
        } else if (initStatus.status === "error") {
          console.log("DEBUG: Error checking status, resetting wallet state");
          notifications.show({
            title: "Error",
            message:
              "An error occurred while checking wallet status. Please scan the key again.",
            color: "red",
          });
          resetWalletState();
        }
      };
      checkStatus();
    }
  }, [privateKey, isInitialized, isSubmitting, parsedData, confirmedLogLength]); // Updated dependency

  const fetchTransactions = async () => {
    if (!privateKey || !parsedData) return;

    try {
      // Step 1: Get the key event log to find public keys for address2 and address3
      const { log: keyEventLog } = await getKeyLog(privateKey);
      console.log("DEBUG: Key event log for fetchTransactions:", keyEventLog);

      // Map addresses to their public keys
      const addressToPublicKey = new Map();

      // Add public key for address1 (current key)
      const publicKey1 = Buffer.from(privateKey.publicKey).toString("hex");
      addressToPublicKey.set(parsedData.address1, publicKey1);

      // Find public keys for address2 and address3 from pending log entries
      for (const entry of keyEventLog) {
        if (entry.mempool) {
          // Pending entry: prerotated_key_hash corresponds to address2
          if (
            getP2PKH(Buffer.from(entry.public_key, "hex")) ===
            parsedData.address2
          ) {
            addressToPublicKey.set(parsedData.address2, entry.public_key);
          }
          // Pending entry: twice_prerotated_key_hash corresponds to address3
          if (
            getP2PKH(Buffer.from(entry.public_key, "hex")) ===
            parsedData.address3
          ) {
            addressToPublicKey.set(parsedData.address3, entry.public_key);
          }
        }
      }

      console.log(
        "DEBUG: Address to public key mapping:",
        Object.fromEntries(addressToPublicKey)
      );

      // Get unique public keys to fetch transactions (filter out undefined)
      const publicKeys = Array.from(addressToPublicKey.values()).filter(
        (pk) => pk
      );

      if (publicKeys.length === 0) {
        console.log("DEBUG: No public keys available to fetch transactions");
        setTransactions([]);
        return;
      }

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

      const allTransactions = [];

      // Step 2: Fetch transactions for each public key
      for (const publicKey of publicKeys) {
        // Find the address corresponding to this public key
        const address = Array.from(addressToPublicKey.entries()).find(
          ([, pk]) => pk === publicKey
        )?.[0];

        if (!address) {
          console.warn(`No address found for public key: ${publicKey}`);
          continue;
        }

        for (const endpoint of endpoints) {
          const url = endpoint.getUrl(publicKey);
          try {
            const response = await fetch(url);
            if (!response.ok) {
              console.warn(`Failed to fetch ${url}: ${response.statusText}`);
              continue; // Skip to next endpoint if fetch fails
            }
            const data = await response.json();
            const txns = (data[endpoint.key] || []).map((tx) => ({
              id: tx.id,
              to: tx.outputs
                .filter((item) => item.to !== address) // Exclude self-addressed outputs
                .map((item) => item.to)
                .join(", "),
              amount: tx.outputs
                .reduce((sum, output) => {
                  // For Received, sum outputs to this address
                  // For Sent, sum outputs not to this address
                  if (endpoint.type === "Received") {
                    return output.to === address ? sum + output.value : sum;
                  } else {
                    return output.to !== address ? sum + output.value : sum;
                  }
                }, 0)
                .toFixed(8),
              date: new Date(tx.time * 1000).toLocaleDateString(),
              status: endpoint.status,
              type: endpoint.type,
              address: address, // Track which address this transaction belongs to
            }));
            allTransactions.push(...txns);
          } catch (error) {
            console.warn(`Error fetching ${url}:`, error);
            continue; // Continue with next endpoint
          }
        }
      }

      // Remove duplicates by transaction ID
      const uniqueTransactions = Array.from(
        new Map(allTransactions.map((tx) => [tx.id, tx])).values()
      );

      // Sort transactions by date (newest first)
      uniqueTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

      setTransactions(uniqueTransactions);
      console.log("DEBUG: Fetched transactions:", uniqueTransactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      notifications.show({
        title: "Error",
        message: "Failed to load transactions",
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
        const address = getP2PKH(privateKey.publicKey);

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

  const capture = async () => {
    if (hasScanned) return; // Prevent multiple scans

    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) return;

    const img = new Image();
    img.src = imageSrc;
    img.onload = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, img.width, img.height);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code) {
        setHasScanned(true); // Mark as scanned to stop interval
        setIsScannerOpen(false); // Close scanner modal immediately
        try {
          // Parse QR code: wif|address2|address3|prevaddress1|rotation
          const [wifString, address2, address3, prevaddress1, rotation] =
            code.data.split("|");
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
          const { isValidKey, log: fetchedLog } = await getKeyLog(
            newPrivateKey
          );
          console.log(
            "DEBUG: Fetched log:",
            JSON.stringify(fetchedLog, null, 2)
          );
          console.log("DEBUG: Confirmed log length:", confirmedLogLength);

          if (!isValidKey) {
            notifications.show({
              title: "Error",
              message: "Failed to fetch key event log. Please try again.",
              color: "red",
            });
            setHasScanned(false); // Allow rescanning
            setIsScannerOpen(true); // Reopen scanner
            return;
          }

          // Check rotation
          // Determine expected rotation based on context
          const isTransactionFlow = recipients[0].address !== "";
          const expectedRotation = isTransactionFlow
            ? confirmedLogLengthRef.current + 1 // Transaction flow: expect next rotation
            : confirmedLogLengthRef.current; // Non-transaction flow: expect current rotation

          if (newParsedData.rotation !== expectedRotation) {
            notifications.show({
              title: "Incorrect Key Rotation",
              message: `This wallet requires the key for rotation ${expectedRotation} to ${
                isTransactionFlow
                  ? "process the transaction"
                  : "sign transactions"
              }. Please scan the QR code for rotation ${expectedRotation}.`,
              color: "yellow",
              autoClose: 10000,
            });
            setHasScanned(false); // Allow rescanning
            setIsScannerOpen(true); // Reopen scanner
            return;
          }

          // Validate continuity for non-initial keys
          // Continuity check for non-initial keys (rotation > 0)
          if (newParsedData.rotation > 0) {
            if (confirmedLogLengthRef.current === 0) {
              notifications.show({
                title: "Invalid QR Code",
                message: `No confirmed key event log entries found, but rotation ${newParsedData.rotation} requires a previous key.`,
                color: "red",
              });
              resetWalletState();
              setHasScanned(false);
              setIsScannerOpen(true);
              return;
            }

            let isValidContinuity = false;
            if (isTransactionFlow) {
              // Transaction flow: Validate against current parsedData (rotation N)
              // Scanned key is at rotation N+1, so prevaddress1 should be current address1,
              // address2 should be current address3
              isValidContinuity =
                newParsedData.prevaddress1 === parsedData.address1 &&
                newParsedData.address2 === parsedData.address3 &&
                (!newParsedData.prevaddress1 ||
                  parsedData.address1 === newParsedData.prevaddress1);
            } else {
              // Non-transaction flow: Validate against last confirmed log entry (rotation N-1)
              const lastConfirmedEntry = fetchedLog.find(
                (entry) =>
                  !entry.mempool &&
                  fetchedLog.indexOf(entry) ===
                    confirmedLogLengthRef.current - 1
              );
              if (!lastConfirmedEntry) {
                notifications.show({
                  title: "Invalid QR Code",
                  message:
                    "No confirmed key event log entries found for continuity check.",
                  color: "red",
                });
                setHasScanned(false);
                setIsScannerOpen(true);
                return;
              }
              isValidContinuity =
                lastConfirmedEntry.prerotated_key_hash === newPublicKeyHash &&
                lastConfirmedEntry.twice_prerotated_key_hash ===
                  newParsedData.address2 &&
                (!newParsedData.prevaddress1 ||
                  lastConfirmedEntry.public_key_hash ===
                    newParsedData.prevaddress1);
            }

            if (!isValidContinuity) {
              notifications.show({
                title: "Invalid QR Code",
                message: `The scanned key (rotation ${
                  newParsedData.rotation
                }) does not maintain continuity with the previous key (rotation ${
                  isTransactionFlow
                    ? confirmedLogLengthRef.current
                    : confirmedLogLengthRef.current - 1
                }). Please ensure the key is part of the same key chain and scan again.`,
                color: "red",
              });
              setHasScanned(false);
              setIsScannerOpen(true);
              return;
            }
          }

          // Handle transaction or key update
          if (recipients[0].address !== "") {
            // Transaction flow

            // Process transaction (same as original)
            const totalAmount = recipients.reduce(
              (sum, r) => sum + Number(r.amount),
              0
            );
            try {
              const res = await axios.get(
                `${
                  import.meta.env.VITE_API_URL
                }/get-graph-wallet?address=${getP2PKH(
                  privateKey.publicKey
                )}&amount_needed=${balance}`
              );
              const inputs = res.data.unspent_transactions.reduce(
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
                notifications.show({
                  title: "Error",
                  message: "Insufficient funds",
                  color: "red",
                });
                setHasScanned(false);
                return;
              }

              const transactionOutputs = recipients.map((r) => ({
                to: r.address,
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
                  value: 0,
                },
              ];
              newTransactionOutputs[0].value = balance - totalAmount;

              const zeroValueTxn = new Transaction({
                key: newPrivateKey,
                public_key: Buffer.from(newPrivateKey.publicKey).toString(
                  "hex"
                ),
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
                setTransactions([
                  {
                    id: actualTxn.hash,
                    to: transactionOutputs
                      .filter((item) => item.to !== parsedData?.address1)
                      .map((item) => item.to)
                      .join(", "),
                    amount: totalAmount.toFixed(8),
                    date: new Date().toLocaleDateString(),
                    status: "Pending",
                    type: "Sent",
                  },
                  ...transactions,
                ]);

                // Update wallet state
                localStorage.removeItem("walletPrivateKey");
                localStorage.removeItem("walletWif");
                localStorage.removeItem("walletParsedData");
                localStorage.removeItem("walletIsWaitingForConfirmation");
                localStorage.removeItem("walletSubmissionTime");
                localStorage.removeItem("walletIsInitialized");

                setPrivateKey(newPrivateKey);
                setWif(wifString);
                setParsedData(newParsedData);
                setIsInitialized(false);
                setRecipients([{ address: "", amount: "" }]);

                notifications.show({
                  title: "Success",
                  message:
                    "Transaction and key rotation confirmation submitted successfully. Waiting for initialization of the new key.",
                  color: "green",
                });

                const initStatus = await checkInitializationStatus();
                if (initStatus.status === "no_transaction") {
                  await initializeKeyEventLog();
                }
              } else {
                throw new Error(
                  "Transaction or confirmation submission failed"
                );
              }
            } catch (error) {
              console.error("DEBUG: Transaction error:", error);
              notifications.show({
                title: "Transaction Failed",
                message: `Failed to process transaction: ${error.message}`,
                color: "red",
              });
              setHasScanned(false);
              return;
            }
          } else {
            // Non-transaction key scan
            localStorage.removeItem("walletPrivateKey");
            localStorage.removeItem("walletWif");
            localStorage.removeItem("walletParsedData");
            localStorage.removeItem("walletIsWaitingForConfirmation");
            localStorage.removeItem("walletSubmissionTime");
            localStorage.removeItem("walletIsInitialized");

            setPrivateKey(newPrivateKey);
            setWif(wifString);
            setParsedData(newParsedData);
            setIsInitialized(false);

            console.log("DEBUG: privateKey set:", newPrivateKey);
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
          }
        } catch (error) {
          console.error("DEBUG: QR code parsing error:", error);
          notifications.show({
            title: "Error",
            message:
              "Invalid QR code format or invalid WIF. Please check the QR code and try again.",
            color: "red",
          });
          resetWalletState();
          setHasScanned(false);
          setIsScannerOpen(true);
        }
      }
    };
  };

  // Sign transaction
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
      (r) => !r.address || !r.amount || isNaN(r.amount) || Number(r.amount) <= 0
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
      // Step 1: Prompt user to rotate key and scan the next key
      notifications.show({
        title: "Key Rotation Required",
        message: `Please rotate your key to rotation ${
          parsedData.rotation + 1
        } on your device and scan the new QR code to proceed with the transaction.`,
        color: "yellow",
      });
      setIsTransactionFlow(true);
      setIsScannerOpen(true);
      setHasScanned(false);

      // Wait for the new key to be scanned (handled in capture function)
      // The capture function will update privateKey, parsedData, and wif
      // We will proceed with transaction creation after the new key is validated
    } catch (error) {
      console.error("Error preparing transaction:", error);
      notifications.show({
        title: "Transaction Failed",
        message: error.message,
        color: "red",
      });
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
              onClick={() => setIsScannerOpen(true)}
              color="teal"
              variant="outline"
              mt="md"
            >
              Scan Key (Rotation: {confirmedLogLength})
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
            <Button onClick={resetWalletState} color="red" variant="outline">
              Reset Wallet State
            </Button>
          </Stack>
        ) : !isInitialized ? (
          <Stack align="center" spacing="md">
            <Text>
              Current key (rotation {parsedData.rotation}) is not initialized.
              Please scan the correct key (rotation {confirmedLogLength}) to
              proceed.
            </Text>
            <Button
              onClick={() => setIsScannerOpen(true)}
              color="teal"
              variant="outline"
            >
              Scan Key (Rotation: {confirmedLogLength})
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
                      Address (Rotation: {parsedData.rotation})
                    </Text>
                    <Group spacing="xs" align="center">
                      <Text>{parsedData.address1}</Text>
                      <ActionIcon
                        onClick={copyAddressToClipboard}
                        color="teal"
                        variant="outline"
                        title="Copy Address"
                      >
                        <IconCopy size={16} />
                      </ActionIcon>
                      <ActionIcon
                        onClick={() => setIsQRModalOpen(true)}
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
                : confirmedLogLength.ref !== log.length
                ? "Please wait for key log to be updated on the blockchain."
                : `This key (rotation ${parsedData.rotation}) is revoked. Please scan the next key (rotation ${log.length}) to sign transactions.`}
            </Text>
            <Button
              onClick={async () => {
                await getKeyLog(privateKey);
                setHasScanned(false); // Reset scan status
                setIsScannerOpen(true);
              }}
              disabled={confirmedLogLengthRef.current === parsedData.rotation}
              color="teal"
              variant="outline"
              mt="md"
            >
              {confirmedLogLengthRef.current === parsedData.rotation
                ? "Scan not required"
                : `Scan Next Key (Rotation: ${
                    log.length === 0 ? 0 : log.length + 1
                  })`}
            </Button>

            {/* Transaction Form */}
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

            {/* Transaction History Table */}
            {transactions.length > 0 && (
              <Card shadow="xs" padding="md" mt="lg" styles={styles.nestedCard}>
                <Title order={3} mb="md">
                  Transaction History
                </Title>
                <Table striped highlightOnHover styles={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.tableHeader}>ID</th>
                      <th style={styles.tableHeader}>To</th>
                      <th style={styles.tableHeader}>Amount (YDA)</th>
                      <th style={styles.tableHeader}>Date</th>
                      <th style={styles.tableHeader}>Status</th>
                      <th style={styles.tableHeader}>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((txn) => (
                      <tr key={txn.id}>
                        <td>
                          <a
                            href={`${
                              import.meta.env.VITE_API_URL
                            }/explorer?term=${txn.id}`}
                            target="_blank"
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

                <Button
                  onClick={resetWalletState}
                  color="red"
                  variant="outline"
                  mt="xl"
                >
                  Erase Cached Wallet Data
                </Button>
              </Card>
            )}
          </>
        )}

        {/* QR Code Scanner Modal */}
        <Modal
          opened={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          title="Scan QR Code"
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

        {/* QR Code Display Modal */}
        <Modal
          opened={isQRModalOpen}
          onClose={() => setIsQRModalOpen(false)}
          title="Wallet Address QR Code"
          size="sm"
          styles={{ modal: styles.qrModal, title: styles.title }}
        >
          {parsedData?.address1 ? (
            <QRCodeSVG
              value={parsedData.address1}
              size={200}
              bgColor={colorScheme === "dark" ? "#1A1B1E" : "#FFFFFF"}
              fgColor={colorScheme === "dark" ? "#FFFFFF" : "#000000"}
            />
          ) : (
            <Text>No address available</Text>
          )}
        </Modal>
      </Card>
    </Container>
  );
};

export default Wallet2;
