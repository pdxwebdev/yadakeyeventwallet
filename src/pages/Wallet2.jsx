// src/pages/Wallet2.js
import { useState, useEffect, useRef, useMemo } from "react";
import { AppShell, Container, Card, Button, Text } from "@mantine/core";
import { notifications, Notifications } from "@mantine/notifications";
import { useAppContext } from "../context/AppContext";
import { walletManagerFactory } from "../blockchains/WalletManagerFactory";
import WalletHeader from "../components/Wallet2/WalletHeader";
import WalletBalance from "../components/Wallet2/WalletBalance";
import TransactionForm from "../components/Wallet2/TransactionForm";
import TransactionHistory from "../components/Wallet2/TransactionHistory";
import QRScannerModal from "../components/Wallet2/QRScannerModal";
import QRDisplayModal from "../components/Wallet2/QRDisplayModal";
import WalletStateHandler from "../components/Wallet2/WalletStateHandler";
import BlockchainNav from "../components/Wallet2/BlockchainNav";
import { styles } from "../shared/styles";
import { fromWIF, getP2PKH } from "../utils/hdWallet";
import TokenSelector from "../components/Wallet2/TokenSelector";
import { capture } from "../shared/capture";
import { BLOCKCHAINS } from "../shared/constants";
import axios from "axios";

const ITEMS_PER_PAGE = 5;

const Wallet2 = () => {
  const {
    selectedBlockchain,
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
    setBalance,
    selectedToken, // New
    contractAddresses,
    setContractAddresses,
    supportedTokens,
  } = useAppContext();

  const webcamRef = useRef(null);
  const appContext = useAppContext();

  // Instantiate WalletManager based on selected blockchain
  const walletManager = useMemo(
    () => walletManagerFactory(selectedBlockchain, appContext, webcamRef),
    [selectedBlockchain, appContext, webcamRef]
  );

  // Load state from localStorage
  useEffect(() => {
    const storedPrivateKey = localStorage.getItem(
      `walletPrivateKey_${selectedBlockchain}`
    );
    const storedWif = localStorage.getItem(`walletWif_${selectedBlockchain}`);
    const storedParsedData = localStorage.getItem(
      `walletParsedData_${selectedBlockchain}`
    );
    const storedIsInitialized = localStorage.getItem(
      `walletIsInitialized_${selectedBlockchain}`
    );

    if (storedPrivateKey && storedWif && storedParsedData) {
      try {
        const privateKeyObj = fromWIF(storedWif);
        const parsed = JSON.parse(storedParsedData);
        // Only set state if parsedData matches the current blockchain
        if (parsed.blockchain === selectedBlockchain) {
          setPrivateKey(privateKeyObj);
          setWif(storedWif);
          setParsedData({ ...parsed });
          setIsInitialized(storedIsInitialized === "true");
        } else {
          // Clear in-memory state for mismatch but preserve localStorage
          setPrivateKey(null);
          setWif("");
          setParsedData(null);
          setIsInitialized(false);
        }
      } catch (error) {
        console.error("Error restoring private key:", error);
        // Clear in-memory state on error but preserve localStorage
        setPrivateKey(null);
        setWif("");
        setParsedData(null);
        setIsInitialized(false);
      }
    } else {
      // No data for this blockchain, initialize empty state
      setPrivateKey(null);
      setWif("");
      setParsedData(null);
      setIsInitialized(false);
    }
  }, [selectedBlockchain]);

  // Save state to localStorage
  useEffect(() => {
    if (privateKey && parsedData?.blockchain === selectedBlockchain) {
      localStorage.setItem(
        `walletPrivateKey_${selectedBlockchain}`,
        JSON.stringify(privateKey)
      );
    } else {
      localStorage.removeItem(`walletPrivateKey_${selectedBlockchain}`);
    }
  }, [privateKey, parsedData, selectedBlockchain]);

  useEffect(() => {
    if (wif && parsedData?.blockchain === selectedBlockchain) {
      localStorage.setItem(`walletWif_${selectedBlockchain}`, wif);
    } else {
      localStorage.removeItem(`walletWif_${selectedBlockchain}`);
    }
  }, [wif, parsedData, selectedBlockchain]);

  useEffect(() => {
    if (parsedData && parsedData.blockchain === selectedBlockchain) {
      const { ...dataToStore } = parsedData;
      localStorage.setItem(
        `walletParsedData_${selectedBlockchain}`,
        JSON.stringify(dataToStore)
      );
    } else {
      localStorage.removeItem(`walletParsedData_${selectedBlockchain}`);
    }
  }, [parsedData, selectedBlockchain]);

  useEffect(() => {
    if (parsedData?.blockchain === selectedBlockchain) {
      localStorage.setItem(
        `walletIsInitialized_${selectedBlockchain}`,
        isInitialized.toString()
      );
    } else {
      localStorage.removeItem(`walletIsInitialized_${selectedBlockchain}`);
    }
  }, [isInitialized, parsedData, selectedBlockchain]);

  const resetWalletState = () => {
    setPrivateKey(null);
    setWif("");
    setParsedData(null);
    setIsInitialized(false);
    setLog([]);
    setTransactions([]);
    setCombinedHistory([]);
    setBalance(null);
    setRecipients([{ address: "", amount: "" }]);
    setFeeEstimate(null);
    localStorage.removeItem(`walletPrivateKey_${selectedBlockchain}`);
    localStorage.removeItem(`walletWif_${selectedBlockchain}`);
    localStorage.removeItem(`walletParsedData_${selectedBlockchain}`);
    localStorage.removeItem(`walletIsInitialized_${selectedBlockchain}`);
    notifications.show({
      title: "Wallet Reset",
      message:
        "Wallet state cleared. Please scan the QR code for the active key.",
      color: "blue",
    });
  };

  useEffect(() => {
    if (privateKey && isInitialized) {
      walletManager.buildTransactionHistory();
      walletManager.fetchFeeEstimate();
    }
  }, [privateKey, isInitialized]);

  useEffect(() => {
    if (privateKey && !isInitialized && !isSubmitting && parsedData) {
      walletManager.checkStatus();
    }
  }, [privateKey, isInitialized, isSubmitting, parsedData]);

  useEffect(() => {
    walletManager.fetchBalance();
  }, [privateKey, isInitialized, log]);

  const handleKeyScan = async () => {
    try {
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
      const { newPrivateKey, newParsedData } =
        await walletManager.processScannedQR(qrData);

      localStorage.removeItem(`walletPrivateKey_${selectedBlockchain}`);
      localStorage.removeItem(`walletWif_${selectedBlockchain}`);
      localStorage.removeItem(`walletParsedData_${selectedBlockchain}`);
      localStorage.removeItem(`walletIsInitialized_${selectedBlockchain}`);

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
      field === "amount" ? value.toString() : value.trim();
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

  const handleSignTransaction = async () => {
    try {
      await walletManager.signTransaction();
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to sign transaction",
        color: "red",
      });
    }
  };

  const totalItems = combinedHistory.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedHistory = combinedHistory.slice(startIndex, endIndex);
  const selectedBlockchainObject = BLOCKCHAINS.find((item) => {
    return item.id === selectedBlockchain;
  });
  return (
    <AppShell
      navbar={{
        width: 300,
        breakpoint: "sm",
        collapsed: { mobile: !isScannerOpen && !isQRModalOpen },
      }}
      padding="md"
    >
      <AppShell.Navbar p="md">
        <BlockchainNav />
      </AppShell.Navbar>
      <AppShell.Main>
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
            {selectedBlockchainObject.isBridge && <TokenSelector />}
            <>
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
              {privateKey && (
                <>
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
            </>
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
      </AppShell.Main>
    </AppShell>
  );
};

export default Wallet2;
