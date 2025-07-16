import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
import WalletManager from "../blockchains/YadaBSC";
import { styles } from "../shared/styles";

const ITEMS_PER_PAGE = 5;

const Wallet2 = () => {
  const {
    transactions,
    setTransactions,
    log,
    setLog,
    wif,
    setWif,
    combinedHistory,
    setCombinedHistory,
    currentPage,
    setCurrentPage,
    isScannerOpen,
    setIsScannerOpen,
    isQRModalOpen,
    setIsQRModalOpen,
    parsedData,
    setParsedData,
    recipients,
    setRecipients,
    privateKey,
    setPrivateKey,
    focusedRotation,
    setFocusedRotation,
    isSubmitting,
    setIsSubmitting,
    isInitialized,
    setIsInitialized,
    isTransactionFlow,
    setIsTransactionFlow,
    feeEstimate,
    setFeeEstimate,
    balance,
  } = useAppContext();
  const webcamRef = useRef(null);

  const appContext = useAppContext();
  const walletManager = useMemo(
    () => new WalletManager(appContext),
    [appContext]
  );

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
        const publicKeyHash = getP2PKH(privateKeyObj.publicKey);
        if (parsed.publicKeyHash && parsed.publicKeyHash !== publicKeyHash) {
          throw new Error("Invalid restored key: address mismatch");
        }
        setPrivateKey(privateKeyObj);
        setWif(storedWif);
        setParsedData({ ...parsed });
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
      const { publicKeyHash, ...dataToStore } = parsedData;
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

  const fetchFeeEstimate = async () => {
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
  };

  useEffect(() => {
    if (privateKey && isInitialized) {
      walletManager.buildTransactionHistory();
      fetchFeeEstimate();
    }
  }, [privateKey, isInitialized]);

  // Fetch history on initialization or key change (unchanged)
  useEffect(() => {
    if (privateKey && isInitialized) {
      walletManager.buildTransactionHistory();
    }
  }, [privateKey, isInitialized]);

  // Check initialization status (unchanged)
  useEffect(() => {
    if (privateKey && !isInitialized && !isSubmitting && parsedData) {
      walletManager.checkStatus();
    }
  }, [privateKey, isInitialized, isSubmitting, parsedData]);

  useEffect(() => {
    walletManager.fetchBalance();
  }, [privateKey, isInitialized, log]);

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
        setIsScannerOpen(false);
        throw new Error("No QR code scanned within time limit");
      }

      setIsScannerOpen(false);
      const { newPrivateKey, newParsedData } =
        await walletManager.processScannedQR(qrData, setLog);

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

      const initStatus = await walletManager.checkInitializationStatus();
      if (initStatus.status === "no_transaction") {
        notifications.show({
          title: "No Key Event Log Entry",
          message: "Submitting wallet initialization transaction.",
          color: "yellow",
        });
        await walletManager.initializeKeyEventLog();
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
    if (parsedData?.publicKeyHash) {
      navigator.clipboard
        .writeText(parsedData.publicKeyHash)
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
  const handleSignTransaction = useCallback(() => {
    const go = async () => {
      await walletManager.signTransaction();
    };
    go();
  }, [walletManager]);

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
                  walletManager.fetchBalance();
                  walletManager.buildTransactionHistory();
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
                onSendTransaction={handleSignTransaction}
                setFocusedRotation={setFocusedRotation}
                styles={styles}
                feeEstimate={feeEstimate}
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
          isTransactionFlow={isTransactionFlow}
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
