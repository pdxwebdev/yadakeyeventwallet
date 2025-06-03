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
import { IconTrash, IconRefresh, IconCopy } from "@tabler/icons-react";
import { fromWIF, generateSHA256, getP2PKH } from "../utils/hdWallet";

const Wallet2 = () => {
  const { colorScheme } = useMantineColorScheme();
  const [transactions, setTransactions] = useState([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [recipients, setRecipients] = useState([{ address: "", amount: "" }]);
  const [privateKey, setPrivateKey] = useState(null);
  const [wif, setWif] = useState("");
  const [log, setLog] = useState([]);
  const [balance, setBalance] = useState(null);
  const [focusedIndex, setFocusedIndex] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWaitingForConfirmation, setIsWaitingForConfirmation] =
    useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [submissionTime, setSubmissionTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const webcamRef = useRef(null);
  const pollingRef = useRef(null);

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

  // Format elapsed time (unchanged)
  const formatElapsedTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `Elapsed time: ${minutes} minute${
      minutes !== 1 ? "s" : ""
    }, ${remainingSeconds} second${remainingSeconds !== 1 ? "s" : ""}`;
  };

  // Update elapsed time every second during confirmation (unchanged)
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

      // Check if the current key is the active key (matches prerotated_key_hash of latest log entry)
      if (keyEventLog.length > 0) {
        const latestLogEntry = keyEventLog[keyEventLog.length - 1]; // Assuming newest entry is first
        if (latestLogEntry.prerotated_key_hash === address) {
          console.log(
            "DEBUG: Current key is active (matches prerotated_key_hash)"
          );
          return { status: "active" };
        }
      }

      // Check if the key is revoked (in log as public_key_hash)
      const isKeyInLog = keyEventLog.some(
        (entry) => entry.public_key_hash === address
      );
      if (isKeyInLog) {
        const logEntry = keyEventLog.find(
          (entry) => entry.public_key_hash === address
        );
        // Validate continuity for revoked key
        const isValidContinuity =
          (parsedData.index === 0 && !parsedData.prevaddress1) ||
          (parsedData.prevaddress1 &&
            keyEventLog.some(
              (e) => e.public_key_hash === parsedData.prevaddress1
            ) &&
            logEntry.prerotated_key_hash === parsedData.address2 &&
            logEntry.twice_prerotated_key_hash === parsedData.address3);

        if (!isValidContinuity) {
          console.log("DEBUG: Continuity check failed for revoked key");
          return { status: "invalid_continuity" };
        }
        console.log("DEBUG: Key found in log, key is revoked");
        return { status: "revoked" };
      }

      // Key is neither active nor revoked, check if it’s the next key to initialize
      const expectedIndex = keyEventLog.length;
      if (parsedData.index === expectedIndex) {
        // Validate continuity for new key
        if (keyEventLog.length > 0) {
          const lastLogEntry = keyEventLog[0]; // Newest entry
          const isValidContinuity =
            lastLogEntry.public_key_hash === parsedData.prevaddress1 &&
            lastLogEntry.prerotated_key_hash === address &&
            lastLogEntry.twice_prerotated_key_hash === parsedData.address2;

          if (!isValidContinuity) {
            console.log("DEBUG: Continuity check failed for new key");
            return { status: "invalid_continuity" };
          }
        } else if (parsedData.prevaddress1 && parsedData.index !== 0) {
          console.log("DEBUG: No log entries but prevaddress1 provided");
          return { status: "invalid_continuity" };
        }
        console.log("DEBUG: Key not in log, ready for initialization");
        return { status: "no_transaction" };
      }

      console.log(
        "DEBUG: Index mismatch, expected:",
        expectedIndex,
        "got:",
        parsedData.index
      );
      return { status: "invalid_index" };
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

      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/transaction?origin=${
          window.location.origin
        }&username_signature=1`,
        txn.toJson(),
        {
          headers: { "Content-Type": "application/json" },
        }
      );

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
        if (initStatus.status === "revoked") {
          console.log("DEBUG: Key revoked, setting initialized state");
          clearInterval(pollingRef.current);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setIsInitialized(true);
          setSubmissionTime(null);
          localStorage.removeItem("walletPrivateKey");
          localStorage.removeItem("walletWif");
          localStorage.removeItem("walletParsedData");
          localStorage.removeItem("walletIsWaitingForConfirmation");
          localStorage.removeItem("walletSubmissionTime");
          localStorage.setItem("walletIsInitialized", "true");
          const currentIndex = parseInt(parsedData.index, 10);
          notifications.show({
            title: "Key Revoked",
            message: `Key at index ${currentIndex} is revoked. Please scan the next key (index ${log.length}) to sign transactions.`,
            color: "yellow",
          });
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
          initStatus.status === "invalid_index" ||
          initStatus.status === "invalid_continuity"
        ) {
          console.log("DEBUG: Invalid index or continuity, stopping polling");
          clearInterval(pollingRef.current);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setSubmissionTime(null);
          notifications.show({
            title:
              initStatus.status === "invalid_index"
                ? "Invalid Key Index"
                : "Invalid Key Continuity",
            message:
              initStatus.status === "invalid_index"
                ? `Expected key index ${log.length}, but current key is index ${parsedData.index}. Please scan the correct key.`
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
  }, [isPolling, privateKey, parsedData, log.length]);

  // Check initialization status only for uninitialized keys
  useEffect(() => {
    if (privateKey && !isInitialized && !isSubmitting && parsedData) {
      const checkStatus = async () => {
        console.log("DEBUG: Checking initialization status");
        const initStatus = await checkInitializationStatus();
        console.log("DEBUG: Initial check status:", initStatus);
        if (initStatus.status === "active") {
          console.log("DEBUG: Key is active, setting initialized state");
          setIsInitialized(true);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setSubmissionTime(null);
          localStorage.setItem("walletIsInitialized", "true");
        } else if (initStatus.status === "revoked") {
          console.log("DEBUG: Key is revoked, setting initialized state");
          setIsInitialized(true);
          setIsPolling(false);
          setIsWaitingForConfirmation(false);
          setSubmissionTime(null);
          localStorage.removeItem("walletPrivateKey");
          localStorage.removeItem("walletWif");
          localStorage.removeItem("walletParsedData");
          localStorage.removeItem("walletIsWaitingForConfirmation");
          localStorage.removeItem("walletSubmissionTime");
          localStorage.setItem("walletIsInitialized", "true");
          const currentIndex = parseInt(parsedData.index, 10);
          notifications.show({
            title: "Key Revoked",
            message: `Key at index ${currentIndex} is revoked. Please scan the next key (index ${log.length}) to sign transactions.`,
            color: "yellow",
          });
        } else if (initStatus.status === "no_transaction") {
          console.log("DEBUG: No transaction, initializing");
          notifications.show({
            title: "No Key Event Log Entry",
            message: "Submitting wallet initialization transaction.",
            color: "yellow",
          });
          await initializeKeyEventLog();
        } else if (
          initStatus.status === "invalid_index" ||
          initStatus.status === "invalid_continuity"
        ) {
          console.log(
            "DEBUG: Invalid index or continuity, resetting wallet state"
          );
          notifications.show({
            title:
              initStatus.status === "invalid_index"
                ? "Invalid Key Index"
                : "Invalid Key Continuity",
            message:
              initStatus.status === "invalid_index"
                ? `Expected key index ${log.length}, but current key is index ${parsedData.index}. Please scan the correct key.`
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
  }, [privateKey, isInitialized, isSubmitting, parsedData, log.length]);

  // Fetch transactions (unchanged)
  useEffect(() => {
    if (!privateKey || !isInitialized) return;

    const publicKey = Buffer.from(privateKey.publicKey).toString("hex");
    const origin = window.location.origin;
    const endpoints = [
      {
        url: `${
          import.meta.env.VITE_API_URL
        }/get-past-sent-txns?page=1&public_key=${publicKey}&origin=${encodeURIComponent(
          origin
        )}`,
        key: "past_transactions",
        status: "Confirmed",
        type: "Sent",
      },
      {
        url: `${
          import.meta.env.VITE_API_URL
        }/get-past-pending-sent-txns?page=1&public_key=${publicKey}&origin=${encodeURIComponent(
          origin
        )}`,
        key: "past_pending_transactions",
        status: "Pending",
        type: "Sent",
      },
      {
        url: `${
          import.meta.env.VITE_API_URL
        }/get-past-received-txns?page=1&public_key=${publicKey}&origin=${encodeURIComponent(
          origin
        )}`,
        key: "past_pending_transactions",
        status: "Confirmed",
        type: "Received",
      },
      {
        url: `${
          import.meta.env.VITE_API_URL
        }/get-past-pending-received-txns?page=1&public_key=${publicKey}&origin=${encodeURIComponent(
          origin
        )}`,
        key: "past_pending_transactions",
        status: "Pending",
        type: "Received",
      },
    ];

    const fetchTransactions = async () => {
      try {
        const allTransactions = [];
        for (const endpoint of endpoints) {
          const response = await fetch(endpoint.url);
          if (!response.ok) throw new Error(`Failed to fetch ${endpoint.url}`);
          const data = await response.json();
          const txns = (data[endpoint.key] || []).flatMap((block) =>
            block.transactions.map((tx) => ({
              id: tx.hash,
              to: tx.outputs[0]?.to || "Multiple",
              amount: tx.outputs
                .reduce((sum, output) => sum + output.value, 0)
                .toFixed(8),
              date: new Date(block.time).toLocaleDateString(),
              status: endpoint.status,
              type: endpoint.type,
            }))
          );
          allTransactions.push(...txns);
        }
        allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
        setTransactions(allTransactions);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        notifications.show({
          title: "Error",
          message: "Failed to load transactions",
          color: "red",
        });
      }
    };

    fetchTransactions();
  }, [privateKey, isInitialized]);

  // Fetch balance (unchanged)
  const fetchBalance = async () => {
    if (privateKey && isInitialized) {
      try {
        const address = getP2PKH(privateKey.publicKey);
        const response = await axios.get(
          `${import.meta.env.VITE_API_URL}/get-graph-wallet?address=${address}`
        );
        const unspentTransactions = response.data.unspent_transactions || [];
        const totalBalance = unspentTransactions
          .reduce((sum, utxo) => {
            return (
              sum +
              utxo.outputs.reduce(
                (outputSum, output) => outputSum + output.value,
                0
              )
            );
          }, 0)
          .toFixed(8);
        setBalance(totalBalance);
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
    const imageSrc = webcamRef.current.getScreenshot();
    if (imageSrc) {
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
          try {
            // Parse QR code: wif|address2|address3|prevaddress1|index
            const [wifString, address2, address3, prevaddress1, index] =
              code.data.split("|");
            console.log("DEBUG: Parsed QR code:", {
              wifString,
              address2,
              address3,
              prevaddress1,
              index,
            });
            const newPrivateKey = fromWIF(wifString);
            const address1 = getP2PKH(newPrivateKey.publicKey);
            const newParsedData = {
              address1,
              wif: wifString,
              address2,
              address3,
              prevaddress1,
              index: parseInt(index, 10),
            };
            const newPublicKeyHash = address1;

            // Fetch key event log for the scanned key
            const { isValidKey, log: fetchedLog } = await getKeyLog(
              newPrivateKey
            );
            if (!isValidKey) {
              notifications.show({
                title: "Error",
                message: "Failed to fetch key event log",
                color: "red",
              });
              return;
            }

            // Check if the scanned key is revoked (in log as public_key_hash)
            const isKeyInLog = fetchedLog.some(
              (entry) => entry.public_key_hash === newPublicKeyHash
            );
            const expectedIndex = fetchedLog.length;
            console.log(
              "DEBUG: Scanned index:",
              newParsedData.index,
              "Expected index:",
              expectedIndex,
              "Is key in log:",
              isKeyInLog
            );

            if (isKeyInLog) {
              // Validate continuity for revoked key
              const logEntry = fetchedLog.find(
                (entry) => entry.public_key_hash === newPublicKeyHash
              );
              if (logEntry) {
                const isValidContinuity =
                  (newParsedData.index === 0 && !newParsedData.prevaddress1) ||
                  (newParsedData.prevaddress1 &&
                    fetchedLog.find(
                      (e) => e.public_key_hash === newParsedData.prevaddress1
                    ) &&
                    logEntry.prerotated_key_hash === newParsedData.address2 &&
                    logEntry.twice_prerotated_key_hash ===
                      newParsedData.address3);

                if (!isValidContinuity) {
                  notifications.show({
                    title: "Invalid QR Code",
                    message:
                      "The scanned key does not maintain continuity with the key event log.",
                    color: "red",
                  });
                  return;
                }

                // Key is revoked
                setParsedData(newParsedData);
                setWif(wifString);
                setPrivateKey(newPrivateKey);
                setIsInitialized(true);
                setIsScannerOpen(false);
                localStorage.removeItem("walletPrivateKey");
                localStorage.removeItem("walletWif");
                localStorage.removeItem("walletParsedData");
                localStorage.removeItem("walletIsWaitingForConfirmation");
                localStorage.removeItem("walletSubmissionTime");
                localStorage.setItem("walletIsInitialized", "true");
                notifications.show({
                  title: "Revoked Key Detected",
                  message: `Key at index ${newParsedData.index} is revoked. Please scan the next key (index ${fetchedLog.length}).`,
                  color: "yellow",
                });
                return;
              }
            }

            // Check if the scanned key is the active key (prerotated_key_hash of latest entry)
            if (
              fetchedLog.length > 0 &&
              fetchedLog[0].prerotated_key_hash === newPublicKeyHash
            ) {
              setParsedData(newParsedData);
              setWif(wifString);
              setPrivateKey(newPrivateKey);
              setIsInitialized(true);
              setIsScannerOpen(false);
              localStorage.setItem("walletIsInitialized", "true");
              notifications.show({
                title: "Active Key Detected",
                message: `Key at index ${newParsedData.index} is the current active key.`,
                color: "green",
              });
              return;
            }

            // Validate as a new key
            if (newParsedData.index !== expectedIndex) {
              notifications.show({
                title: "Invalid QR Code",
                message: `Expected key at index ${expectedIndex}, but received index ${newParsedData.index}.`,
                color: "red",
              });
              return;
            }

            // Validate continuity for new key
            if (fetchedLog.length > 0) {
              const lastLogEntry = fetchedLog[fetchedLog.length - 1];
              const isValidContinuity =
                lastLogEntry.public_key_hash === newParsedData.prevaddress1 &&
                lastLogEntry.prerotated_key_hash === newPublicKeyHash &&
                lastLogEntry.twice_prerotated_key_hash ===
                  newParsedData.address2;

              if (!isValidContinuity) {
                notifications.show({
                  title: "Invalid QR Code",
                  message:
                    "The scanned key does not maintain continuity with the previous index.",
                  color: "red",
                });
                return;
              }
            } else if (
              newParsedData.prevaddress1 &&
              newParsedData.index !== 0
            ) {
              notifications.show({
                title: "Invalid QR Code",
                message:
                  "No key event log found, but prevaddress1 provided and index is not 0.",
                color: "red",
              });
              return;
            }

            // Clear localStorage before setting new data
            localStorage.removeItem("walletPrivateKey");
            localStorage.removeItem("walletWif");
            localStorage.removeItem("walletParsedData");
            localStorage.removeItem("walletIsWaitingForConfirmation");
            localStorage.removeItem("walletSubmissionTime");
            localStorage.removeItem("walletIsInitialized");
            setParsedData(newParsedData);
            setWif(wifString);
            setPrivateKey(newPrivateKey);
            setIsInitialized(false);
            setIsScannerOpen(false);
            notifications.show({
              title: "QR Code Parsed",
              message: `Address1: ${address1}, Index: ${index}`,
              color: "green",
            });

            // Trigger initialization for new key
            const initStatus = await checkInitializationStatus();
            if (initStatus.status === "no_transaction") {
              notifications.show({
                title: "No Key Event Log Entry",
                message: "Submitting wallet initialization transaction.",
                color: "yellow",
              });
              await initializeKeyEventLog();
            }
          } catch (error) {
            console.error("Error parsing QR code:", error);
            notifications.show({
              title: "Error",
              message: "Invalid QR code format or invalid WIF",
              color: "red",
            });
          }
        }
      };
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

    const res = await axios.get(
      `${import.meta.env.VITE_API_URL}/get-graph-wallet?address=${getP2PKH(
        privateKey.publicKey
      )}`
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
      return;
    }

    try {
      const transactionOutputs = recipients.map((r) => ({
        to: r.address,
        value: Number(r.amount),
      }));

      const txn = new Transaction({
        key: privateKey,
        public_key: Buffer.from(privateKey.publicKey).toString("hex"),
        twice_prerotated_key_hash: parsedData.address3,
        prerotated_key_hash: parsedData.address2,
        inputs: inputs.selected,
        outputs: transactionOutputs,
        relationship: "",
        relationship_hash: await generateSHA256(""),
        public_key_hash: getP2PKH(privateKey.publicKey),
        prev_public_key_hash: parsedData.prevaddress1 || "",
      });
      await txn.hashAndSign();
      setTransactions([
        {
          id: txn.hash,
          to: "Multiple",
          amount: totalAmount.toFixed(8),
          date: new Date().toLocaleDateString(),
          status: "Pending",
          type: "Sent",
        },
        ...transactions,
      ]);
      setRecipients([{ address: "", amount: "" }]);
      notifications.show({
        title: "Success",
        message: "Transaction created successfully",
        color: "green",
      });
      await fetchBalance();
    } catch (error) {
      notifications.show({
        title: "Transaction Failed",
        message: error.message,
        color: "red",
      });
    }
  };

  useEffect(() => {
    let interval;
    if (isScannerOpen) {
      interval = setInterval(capture, 300);
    }
    return () => clearInterval(interval);
  }, [isScannerOpen]);

  // Helper functions to manage recipients (unchanged)
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

  const handleBalanceClick = () => {
    if (balance === null || balance <= 0) return;

    if (recipients.length === 1) {
      updateRecipient(0, "amount", balance.toString());
    } else {
      const populatedAmounts = recipients.reduce((sum, r, i) => {
        const amount = parseFloat(r.amount);
        return isNaN(amount) || i === focusedIndex ? sum : sum + amount;
      }, 0);

      const remainingBalance = balance - populatedAmounts;
      if (remainingBalance <= 0) return;

      const recipientsToDistribute = recipients.filter(
        (r, i) => i === focusedIndex || !r.amount || isNaN(parseFloat(r.amount))
      ).length;

      if (recipientsToDistribute === 0) return;

      const amountPerRecipient = (
        remainingBalance / recipientsToDistribute
      ).toFixed(8);

      const updatedRecipients = recipients.map((recipient, index) => {
        if (
          index === focusedIndex ||
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
              Scan Key (Index: {log.length})
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
              Waiting for wallet initialization, this should take 10 to 20
              minutes. Current index: {parsedData.index}
            </Text>
            <Text>{formatElapsedTime(elapsedTime)}</Text>
            <Button onClick={resetWalletState} color="red" variant="outline">
              Reset Wallet State
            </Button>
          </Stack>
        ) : !isInitialized ? (
          <Stack align="center" spacing="md">
            <Text>
              Current key (index {parsedData.index}) is not initialized. Please
              scan the correct key (index {log.length}) to proceed.
            </Text>
            <Button
              onClick={() => setIsScannerOpen(true)}
              color="teal"
              variant="outline"
            >
              Scan Key (Index: {log.length})
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
                      onClick={fetchBalance}
                      color="teal"
                      variant="outline"
                      title="Refresh Balance"
                    >
                      <IconRefresh size={16} />
                    </ActionIcon>
                  </Group>

                  <Flex direction="column">
                    <Text fw={500}>Address (Index: {parsedData.index})</Text>
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
                    </Group>
                  </Flex>
                </Flex>
              </Card>
            )}

            <Text mb="md">
              {parsedData.index === log.length
                ? `Wallet is ready. You can send transactions with this key (index ${parsedData.index}).`
                : `This key (index ${parsedData.index}) is revoked. Please scan the next key (index ${log.length}) to sign transactions.`}
            </Text>
            <Button
              onClick={async () => {
                await getKeyLog(privateKey);
                setIsScannerOpen(true);
              }}
              color="teal"
              variant="outline"
              mt="md"
            >
              Scan Next Key (Index: {log.length})
            </Button>
            <Button
              onClick={resetWalletState}
              color="red"
              variant="outline"
              mt="md"
            >
              Reset Wallet State
            </Button>

            {/* Transaction Form */}
            {parsedData.index === log.length && (
              <>
                <Title order={3} mt="lg" mb="md">
                  Send Transaction
                </Title>
                {recipients.map((recipient, index) => (
                  <Group key={index} mb="sm" align="flex-end">
                    <TextInput
                      label="Recipient Address"
                      placeholder="Enter address"
                      value={recipient.address}
                      onChange={(e) =>
                        updateRecipient(index, "address", e.target.value)
                      }
                      styles={{ input: styles.input, label: styles.inputLabel }}
                      style={{ flex: 2 }}
                    />
                    <NumberInput
                      label="Amount (YDA)"
                      placeholder="Enter amount"
                      value={recipient.amount}
                      onChange={(value) =>
                        updateRecipient(index, "amount", value)
                      }
                      onFocus={() => setFocusedIndex(index)}
                      decimalScale={8}
                      styles={{ input: styles.input, label: styles.inputLabel }}
                      style={{ flex: 1 }}
                      min={0}
                      step={0.00000001}
                    />
                    {recipients.length > 1 && (
                      <ActionIcon
                        color="red"
                        onClick={() => removeRecipient(index)}
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
            {parsedData.index === log.length && (
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
                        <td>{txn.id.slice(0, 8)}...</td>
                        <td>{txn.to}</td>
                        <td>{txn.amount}</td>
                        <td>{txn.date}</td>
                        <td>{txn.status}</td>
                        <td>{txn.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}
          </>
        )}

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
      </Card>
    </Container>
  );
};

export default Wallet2;
