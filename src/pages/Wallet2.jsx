// src/pages/Wallet2.js
import { useState, useEffect, useRef, useMemo } from "react";
import { AppShell, Container, Card, Button, Text, Group } from "@mantine/core";
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
import { fromWIF } from "../utils/hdWallet";
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
    selectedToken,
    contractAddresses,
    setContractAddresses,
    isDeployed,
    setIsDeployed,
    supportedTokens,
    tokenPairs,
    setLoading,
  } = useAppContext();

  const webcamRef = useRef(null);
  const appContext = useAppContext();
  const isDeploymentChecked = useRef(false);

  const [currentScanIndex, setCurrentScanIndex] = useState(0);

  const walletManager = useMemo(
    () => walletManagerFactory(selectedBlockchain, webcamRef),
    [selectedBlockchain, webcamRef]
  );

  // Derive token symbols for the selected token
  const { tokenSymbol, wrappedTokenSymbol } = useMemo(() => {
    let tokenSymbol = "Token";
    let wrappedTokenSymbol = "WToken";

    if (selectedToken) {
      // Find the selected token in supportedTokens
      const token = supportedTokens.find(
        (t) => t.address.toLowerCase() === selectedToken.toLowerCase()
      );
      if (token) {
        tokenSymbol = token.symbol || tokenSymbol;
      }

      // Find the wrapped token symbol in tokenPairs
      const pair = tokenPairs.find(
        (p) => p.original.toLowerCase() === selectedToken.toLowerCase()
      );
      if (pair) {
        wrappedTokenSymbol = pair.symbol || wrappedTokenSymbol;
      } else if (tokenSymbol === "BNB") {
        wrappedTokenSymbol = "BNB"; // Special case for BNB
      } else {
        wrappedTokenSymbol = `Y${tokenSymbol}`; // Fallback: prepend "W" to original symbol
      }
    }

    return { tokenSymbol, wrappedTokenSymbol };
  }, [selectedToken, supportedTokens, tokenPairs]);

  useEffect(() => {
    const checkDeploymentStatus = async () => {
      if (isDeployed && Object.keys(contractAddresses).length > 0) {
        return;
      }
      try {
        const result = await walletManager.checkDeployment(appContext);
        setIsDeployed(result.status);
        if (result.status && result.addresses) {
          setContractAddresses(result.addresses);
        }
      } catch (error) {
        console.error("Deployment check failed:", error);
        notifications.show({
          title: "Error",
          message: "Failed to check deployment status",
          color: "red",
        });
      }
    };

    if (!isDeploymentChecked.current) {
      checkDeploymentStatus();
      isDeploymentChecked.current = true;
    }

    return () => {
      isDeploymentChecked.current = false;
    };
  }, [
    selectedBlockchain,
    isDeployed,
    contractAddresses,
    walletManager,
    setIsDeployed,
    setContractAddresses,
  ]);

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
        if (parsed.blockchain === selectedBlockchain) {
          setPrivateKey(privateKeyObj);
          setWif(storedWif);
          setParsedData({ ...parsed });
          setIsInitialized(storedIsInitialized === "true");
        } else {
          setPrivateKey(null);
          setWif("");
          setParsedData(null);
          setIsInitialized(false);
        }
      } catch (error) {
        console.error("Error restoring private key:", error);
        setPrivateKey(null);
        setWif("");
        setParsedData(null);
        setIsInitialized(false);
      }
    } else {
      setPrivateKey(null);
      setWif("");
      setParsedData(null);
      setIsInitialized(false);
    }
  }, [
    selectedBlockchain,
    setPrivateKey,
    setWif,
    setParsedData,
    setIsInitialized,
  ]);

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

  useEffect(() => {
    const fetchLog = async () => {
      await walletManager.fetchLog(appContext);
    };
    if (
      log.length === 0 &&
      contractAddresses.keyLogRegistryAddress &&
      privateKey
    ) {
      fetchLog();
    }
  }, [contractAddresses, privateKey]);

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
    localStorage.removeItem(`walletParsedData_${selectedBlockchain}_QR1`);
    localStorage.removeItem(`walletParsedData_${selectedBlockchain}_QR2`);
    localStorage.removeItem(`walletParsedData_${selectedBlockchain}_QR3`);
    notifications.show({
      title: "Wallet Reset",
      message:
        "Wallet state cleared. Please scan the QR code for the active key.",
      color: "blue",
    });
  };

  useEffect(() => {
    if (privateKey && isInitialized) {
      walletManager.buildTransactionHistory(appContext);
      if (log.length > 0 && log.length !== parsedData.rotation) {
        walletManager.fetchFeeEstimate(appContext);
      }
    }
  }, [
    privateKey,
    isInitialized,
    selectedToken,
    walletManager,
    log,
    parsedData,
  ]);

  useEffect(() => {
    if (privateKey && !isInitialized && !isSubmitting && parsedData) {
      walletManager.checkStatus(appContext);
    }
  }, [privateKey, isInitialized, isSubmitting, parsedData, walletManager, log]);

  // In Wallet2.js, add this useEffect
  useEffect(() => {
    const { setTokenPairs } = appContext;
    const go = async () => {
      const tp = await walletManager.fetchTokenPairs(appContext);
      if (tp.length === 0) return;
      setTokenPairs(tp);
    };
    if (tokenPairs.length === 0) {
      go();
    }
    if (tokenPairs.length > 0) {
      const originalTokens = tokenPairs.map((pair) => ({
        address: pair.original,
        symbol: pair.symbol,
        name: pair.name,
        decimals: 18, // Assume 18 decimals for wrapped tokens; adjust if needed
      }));
      // Combine original and wrapped tokens, avoiding duplicates
      appContext.setSupportedTokens(originalTokens);
      console.log(
        "Updated supported tokens with wrapped tokens:",
        originalTokens
      );
    }
  }, [tokenPairs, contractAddresses]);

  useEffect(() => {
    if (privateKey && isInitialized) {
      walletManager.fetchBalance(appContext);
    }
  }, [privateKey, isInitialized, log, walletManager, selectedToken]);

  const handleDeployContracts = async () => {
    try {
      const maxScans = 3;
      const qrResults = [];

      for (let i = 0; i < maxScans; i++) {
        notifications.show({
          title: `Scan QR Code for rotation ${i}`,
          message: `Please scan QR code for rotation ${i}. The ${
            i === 0 ? "first" : i === 1 ? "second" : "third"
          } of three for deployment.`,
          color: "blue",
        });

        setCurrentScanIndex(i); // Set the current scan index
        setIsScannerOpen(true);
        let qrData;
        let attempts = 0;
        const maxAttemptsPerScan = 100;
        const scanTimeout = 300;

        while (attempts < maxAttemptsPerScan) {
          try {
            qrData = await capture(webcamRef);
            if (qrData) {
              const [wifString] = qrData.split("|");
              if (
                qrResults.some(
                  (result) => result.newParsedData.wif === wifString
                )
              ) {
                throw new Error(
                  `QR code ${
                    i + 1
                  } is identical to a previously scanned QR code.`
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

        const { newPrivateKey, newParsedData } =
          await walletManager.processScannedQR(appContext, qrData, false, true);
        qrResults.push({ newPrivateKey, newParsedData });

        notifications.show({
          title: `QR Code ${i + 1} Loaded`,
          message: `Wallet key for rotation ${newParsedData.rotation} loaded successfully.`,
          color: "green",
        });

        if (i < maxScans - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      await walletManager.validateDeploymentKeyContinuity(
        appContext,
        qrResults.map((r) => r.newParsedData)
      );

      const [wif1, wif2, wif3] = qrResults.map(
        (result) => result.newParsedData.wif
      );
      const cprkh = qrResults[2].newParsedData.prerotatedKeyHash;
      const ctprkh = qrResults[2].newParsedData.twicePrerotatedKeyHash;
      const clean = true;
      setLoading(true);

      const deployResult = await walletManager.deploy(
        appContext,
        wif1,
        wif2,
        wif3,
        cprkh,
        ctprkh,
        clean
      );

      if (deployResult.status && deployResult.addresses) {
        setContractAddresses(deployResult.addresses);
        setIsDeployed(true);

        const lastResult = qrResults[qrResults.length - 1];
        setPrivateKey(lastResult.newPrivateKey);
        setWif(lastResult.newParsedData.wif);
        setParsedData(lastResult.newParsedData);

        qrResults.forEach((result, index) => {
          localStorage.setItem(
            `walletParsedData_${selectedBlockchain}_QR${index + 1}`,
            JSON.stringify(result.newParsedData)
          );
        });

        const initStatus = await walletManager.checkInitializationStatus(
          appContext
        );
        if (initStatus.status === "no_transaction") {
          notifications.show({
            title: "No Key Event Log Entry",
            message: "Submitting wallet initialization transaction.",
            color: "yellow",
          });
          await walletManager.initializeKeyEventLog(appContext);
        }

        notifications.show({
          title: "Deployment Successful",
          message: "Contracts deployed and wallet initialized.",
          color: "green",
        });
      } else {
        throw new Error(deployResult.error || "Failed to deploy contracts");
      }
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to deploy contracts",
        color: "red",
      });
    } finally {
      setLoading(false);
      setIsScannerOpen(false);
      setCurrentScanIndex(0); // Reset after deployment
    }
  };

  const handleRotateKey = async () => {
    try {
      await walletManager.rotateKey(appContext, webcamRef);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to rotate key",
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
      await walletManager.signTransaction(appContext, webcamRef);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to sign transaction",
        color: "red",
      });
    }
  };

  const handleWrap = async () => {
    try {
      await walletManager.wrap(appContext, webcamRef);
      await walletManager.fetchBalance(appContext);
      await walletManager.buildTransactionHistory(appContext);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to wrap tokens",
        color: "red",
      });
    }
  };

  const handleUnwrap = async () => {
    try {
      await walletManager.unwrap(appContext, webcamRef);
      await walletManager.fetchBalance(appContext);
      await walletManager.buildTransactionHistory(appContext);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to unwrap tokens",
        color: "red",
      });
    }
  };

  const totalItems = combinedHistory.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedHistory = combinedHistory.slice(startIndex, endIndex);
  const selectedBlockchainObject = BLOCKCHAINS.find(
    (item) => item.id === selectedBlockchain
  );

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
                <Group>
                  <Button
                    onClick={handleWrap}
                    disabled={(() => {
                      const isOriginalToken = tokenPairs.some(
                        (p) =>
                          p.original.toLowerCase() ===
                          selectedToken?.toLowerCase()
                      );
                      const hasOriginalBalance =
                        balance && parseFloat(balance.original) > 0
                          ? balance.wrapped
                          : false;
                      return (
                        !isDeployed ||
                        !isInitialized ||
                        !isOriginalToken ||
                        !hasOriginalBalance
                      );
                    })()}
                  >
                    Wrap
                  </Button>
                  <Button
                    onClick={handleUnwrap}
                    disabled={(() => {
                      const isWrappedToken = tokenPairs.some(
                        (p) =>
                          p.original.toLowerCase() ===
                          selectedToken?.toLowerCase()
                      );
                      const hasWrappedBalance =
                        balance && parseFloat(balance.wrapped) > 0
                          ? balance.wrapped
                          : false;
                      return (
                        !isDeployed ||
                        !isInitialized ||
                        !isWrappedToken ||
                        !hasWrappedBalance
                      );
                    })()}
                  >
                    Unwrap
                  </Button>
                </Group>
              </>
            )}
            <WalletStateHandler
              privateKey={privateKey}
              isSubmitting={isSubmitting}
              isInitialized={isInitialized}
              parsedData={parsedData}
              log={log}
              onDeployContracts={handleDeployContracts}
              onRotateKey={handleRotateKey}
              onReset={resetWalletState}
              isDeployed={isDeployed}
              styles={styles}
            />
            {privateKey && isDeployed && log.length === parsedData.rotation && (
              <>
                <WalletBalance
                  balance={balance}
                  parsedData={parsedData}
                  log={log}
                  onRefresh={() => {
                    walletManager.fetchBalance(appContext);
                    walletManager.buildTransactionHistory(appContext);
                  }}
                  onCopyAddress={copyAddressToClipboard}
                  onShowQR={() => setIsQRModalOpen(true)}
                  styles={styles}
                  tokenSymbol={tokenSymbol}
                  wrappedTokenSymbol={wrappedTokenSymbol}
                />
                <Text mb="md">
                  {parsedData.rotation === log.length
                    ? `Wallet is ready. You can send transactions with this key (rotation ${parsedData.rotation}).`
                    : `Please rotate to the next key (rotation ${log.length}) to sign transactions.`}
                </Text>
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
            <Group mt="xl">
              {!isDeployed && (
                <Button
                  onClick={handleDeployContracts}
                  color="blue"
                  variant="filled"
                >
                  Deploy Contracts
                </Button>
              )}
              <Button onClick={resetWalletState} color="red" variant="outline">
                Erase Wallet Cache
              </Button>
            </Group>
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
              currentScanIndex={currentScanIndex} // Pass the new prop
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
