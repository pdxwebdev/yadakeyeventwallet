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
      // Check if deployment exists
      const checkResponse = await axios.post(
        "http://localhost:3001/check-deployment",
        {}
      );
      const maxScans = checkResponse.data.deployed ? 1 : 3; // Scan 1 QR if deployed, 3 if not
      const qrResults = [];

      if (checkResponse.data.deployed) {
        notifications.show({
          title: "Deployment Found",
          message: `Contracts already deployed: ${JSON.stringify(
            checkResponse.data.addresses
          )}`,
          color: "green",
        });
        setContractAddresses(checkResponse.data.addresses);
      } else {
        notifications.show({
          title: "No Deployment Found",
          message: "Proceeding to scan 3 QR codes for deployment.",
          color: "yellow",
        });
      }

      // Scan QR codes
      for (let i = 0; i < maxScans; i++) {
        notifications.show({
          title: `Scan QR Code ${i + 1}`,
          message: `Please scan QR code ${i + 1} of ${maxScans}.`,
          color: "blue",
        });

        setIsScannerOpen(true);
        let qrData;
        let attempts = 0;
        const maxAttemptsPerScan = 100;
        const scanTimeout = 300;

        while (attempts < maxAttemptsPerScan) {
          try {
            qrData = await capture(webcamRef);
            if (qrData) {
              // Check if this QR code is different from previous ones
              const [wifString] = qrData.split("|");
              if (
                qrResults.some(
                  (result) => result.newParsedData.wif === wifString
                )
              ) {
                throw new Error(
                  `QR code ${
                    i + 1
                  } is identical to a previously scanned QR code. Please scan a different QR code.`
                );
              }
              break;
            }
          } catch (error) {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, scanTimeout));
          }
        }

        setIsScannerOpen(false);

        if (!qrData) {
          throw new Error(
            `No QR code scanned for scan ${i + 1} within time limit`
          );
        }

        const { newPrivateKey, newParsedData, status, error } =
          await walletManager.processScannedQR(
            qrData,
            false,
            !checkResponse.data.deployed
          );

        if (error) {
          throw new Error(error || `Failed to process QR code ${i + 1}`);
        }

        qrResults.push({ newPrivateKey, newParsedData });

        notifications.show({
          title: `QR Code ${i + 1} Loaded`,
          message: `Wallet key for rotation ${newParsedData.rotation} loaded successfully.`,
          color: "green",
        });

        // Short delay to allow user to prepare the next QR code (if not the last scan)
        if (i < maxScans - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000)); // 1-second delay
        }
      }

      // Deploy contracts only if no deployment was found
      if (!checkResponse.data.deployed) {
        // Validate that we have 3 QR codes
        if (qrResults.length !== 3) {
          throw new Error("Three QR codes are required for deployment");
        }

        const [wif1, wif2, wif3] = qrResults.map(
          (result) => result.newParsedData.wif
        );
        const cprkh = qrResults[0].newParsedData.prerotatedKeyHash;
        const ctprkh = qrResults[0].newParsedData.twicePrerotatedKeyHash;
        const clean = true;

        const deployResult = await walletManager.deploy(
          wif1,
          wif2,
          wif3,
          cprkh,
          ctprkh,
          clean
        );

        if (deployResult.status && deployResult.addresses) {
          setContractAddresses(deployResult.addresses);
          notifications.show({
            title: "Deployment Successful",
            message: "Contracts deployed successfully.",
            color: "green",
          });
        } else {
          throw new Error(deployResult.error || "Failed to deploy contracts");
        }
      }

      // Set the last scanned key as the active key
      const lastResult = qrResults[qrResults.length - 1];
      setPrivateKey(lastResult.newPrivateKey);
      setWif(lastResult.newParsedData.wif);
      setParsedData(lastResult.newParsedData);

      // Store all parsed data in localStorage
      qrResults.forEach((result, index) => {
        localStorage.setItem(
          `walletParsedData_${selectedBlockchain}_QR${index + 1}`,
          JSON.stringify(result.newParsedData)
        );
      });

      // Check initialization status for the last key
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
          message: `Key at rotation ${lastResult.newParsedData.rotation} has a pending transaction in mempool. Waiting for confirmation.`,
          color: "yellow",
        });
      }

      notifications.show({
        title: checkResponse.data.deployed
          ? "Key Loaded"
          : "All QR Codes Scanned and Deployed",
        message: checkResponse.data.deployed
          ? "Successfully loaded key from QR code."
          : `Successfully processed ${maxScans} QR codes and deployed contracts.`,
        color: "green",
        autoClose: 5000,
      });
    } catch (error) {
      setIsScannerOpen(false);
      notifications.show({
        title: "Error",
        message:
          error.message || "Failed to process QR code(s) or deploy contracts.",
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
            {selectedBlockchainObject.isBridge && (
              <>
                <TokenSelector />
                <Button
                  onClick={() => {
                    walletManager.wrap();
                  }}
                >
                  Wrap
                </Button>
              </>
            )}
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
