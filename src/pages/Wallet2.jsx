import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  AppShell,
  Container,
  Card,
  Button,
  Text,
  Group,
  NumberInput,
  Grid,
  Title,
  TextInput,
  Burger,
  Image,
} from "@mantine/core";
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
import TokenPairsForm from "../components/Wallet2/TokenPairsForm";
import { MintForm, BurnForm } from "../components/Wallet2/MintBurnForms"; // Import new components
import { styles } from "../shared/styles";
import { fromWIF } from "../utils/hdWallet";
import TokenSelector from "../components/Wallet2/TokenSelector";
import { capture } from "../shared/capture";
import {
  BLOCKCHAINS,
  BRIDGE_ABI,
  BRIDGE_UPGRADE_ABI,
  localProvider,
  localSwapProvider,
  PANCAKE_ROUTER_ABI,
  PANCAKE_ROUTER_ADDRESS,
} from "../shared/constants";
import axios from "axios";
import { ethers } from "ethers";
import SendBalanceForm from "../components/Wallet2/SendBalanceForm";
import { SwapForm } from "../components/Wallet2/SwapForm";
import { LiquidityForm } from "../components/Wallet2/LiquidityForm";
import { useDisclosure } from "@mantine/hooks";
import AmountInput from "../components/Wallet2/AmountInput";

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
    setTokenPairs,
    setLoading,
    isOwner, // Include isOwner from context
    setIsOwner,
    setSendWrapped,
    tokenPairsFetched,
    setTokenPairsFetched,
    blockchainColor,
    sendWrapped,
  } = useAppContext();

  const webcamRef = useRef(null);
  const appContext = useAppContext();
  const isDeploymentChecked = useRef(false);

  // Add disclosure hook for navbar opened state
  const [opened, { toggle }] = useDisclosure(false);
  const [currentScanIndex, setCurrentScanIndex] = useState(0);
  const [wrapAmount, setWrapAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const [wrapAddress, setWrapAddress] = useState("");
  const [isSecureUpgradeFlow, setIsSecureUpgradeFlow] = useState(false);
  const [secureUpgradeScans, setSecureUpgradeScans] = useState([]); // Store scanned WIFs for unconfirmed + confirming
  const [isNewBridgeVersion, setIsNewBridgeVersion] = useState(null); // null = checking, false = old, true = new

  const walletManager = useMemo(
    () => walletManagerFactory(selectedBlockchain.id),
    [selectedBlockchain]
  );

  // Derive token symbols for the selected token
  const { tokenSymbol, wrappedTokenSymbol } = useMemo(() => {
    if (!selectedBlockchain.isBridge)
      return {
        tokenSymbol: selectedBlockchain.id.toUpperCase(),
        wrappedTokenSymbol: "",
      };
    let tokenSymbol = "Token";
    let wrappedTokenSymbol = "WToken";

    if (selectedToken) {
      const token = supportedTokens.find(
        (t) => t.address.toLowerCase() === selectedToken.toLowerCase()
      );
      if (token) {
        tokenSymbol = token.symbol || tokenSymbol;
      }

      const pair = tokenPairs.find(
        (p) => p.original.toLowerCase() === selectedToken.toLowerCase()
      );
      if (pair) {
        wrappedTokenSymbol = pair.symbol || wrappedTokenSymbol;
      } else if (tokenSymbol === "BNB") {
        wrappedTokenSymbol = "BNB";
      } else {
        wrappedTokenSymbol = null;
      }
    }

    return { tokenSymbol, wrappedTokenSymbol };
  }, [selectedToken, supportedTokens, tokenPairs, selectedBlockchain]);

  // Function to check if the current signer is the owner
  const checkOwnerStatus = async (appContext) => {
    const { setIsOwner } = appContext;
    if (!isDeployed || !contractAddresses.bridgeAddress || !privateKey) {
      setIsOwner(false);
      return;
    }

    try {
      if (selectedBlockchain.id !== "bsc") {
        setIsOwner(false);
        return;
      }
      const bridge = new ethers.Contract(
        contractAddresses.bridgeAddress,
        BRIDGE_ABI,
        localProvider
      );

      const owner = await bridge.getOwner();
      const signerAddress = parsedData?.publicKeyHash;

      if (
        signerAddress &&
        owner.toLowerCase() === signerAddress.toLowerCase()
      ) {
        setIsOwner((prev) => {
          if (prev !== true) {
            console.log("Setting isOwner to true"); // Debugging
            return true;
          }
          return prev;
        });
      } else {
        setIsOwner((prev) => {
          if (prev !== false) {
            console.log("Setting isOwner to false"); // Debugging
            return false;
          }
          return prev;
        });
      }
    } catch (error) {
      console.error("Error checking owner status:", error);
      setIsOwner((prev) => {
        if (prev !== false) {
          console.log("Setting isOwner to false due to error"); // Debugging
          return false;
        }
        return prev;
      });
      notifications.show({
        title: "Error",
        message: "Failed to check owner status",
        color: "red",
      });
    }
  };

  useEffect(() => {
    console.log("isOwner changed:", isOwner);
  }, [isOwner]);

  useEffect(() => {
    const checkDeploymentStatus = async (appContext) => {
      if (isDeployed && Object.keys(contractAddresses).length > 0) {
        await checkOwnerStatus(appContext);
        return;
      }
      try {
        const result = await walletManager.checkDeployment(appContext);
        setIsDeployed(result.status);
        if (result.status && result.addresses) {
          setContractAddresses(result.addresses);
          await checkOwnerStatus(appContext);
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
      checkDeploymentStatus(appContext);
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
    privateKey,
    parsedData,
  ]);

  useEffect(() => {
    const storedPrivateKey = localStorage.getItem(
      `walletPrivateKey_${selectedBlockchain.id}`
    );
    const storedWif = localStorage.getItem(
      `walletWif_${selectedBlockchain.id}`
    );
    const storedParsedData = localStorage.getItem(
      `walletParsedData_${selectedBlockchain.id}`
    );
    const storedIsInitialized = localStorage.getItem(
      `walletIsInitialized_${selectedBlockchain.id}`
    );

    if (storedPrivateKey && storedWif && storedParsedData) {
      try {
        const privateKeyObj = fromWIF(storedWif);
        const parsed = JSON.parse(storedParsedData);
        if (parsed.blockchain === selectedBlockchain.id) {
          setPrivateKey(privateKeyObj);
          setWif(storedWif);
          setParsedData({ ...parsed });
          setIsInitialized(storedIsInitialized === "true");
          checkOwnerStatus(appContext);
        } else {
          setPrivateKey(null);
          setWif("");
          setParsedData(null);
          setIsInitialized(false);
          setIsOwner(false);
        }
      } catch (error) {
        console.error("Error restoring private key:", error);
        setPrivateKey(null);
        setWif("");
        setParsedData(null);
        setIsInitialized(false);
        setIsOwner(false);
      }
    } else {
      setPrivateKey(null);
      setWif("");
      setParsedData(null);
      setIsInitialized(false);
      setIsOwner(false);
    }
  }, [
    selectedBlockchain,
    setPrivateKey,
    setWif,
    setParsedData,
    setIsInitialized,
    setIsOwner,
  ]);

  useEffect(() => {
    if (privateKey && parsedData?.blockchain === selectedBlockchain.id) {
      localStorage.setItem(
        `walletPrivateKey_${selectedBlockchain.id}`,
        JSON.stringify(privateKey)
      );
    } else {
      localStorage.removeItem(`walletPrivateKey_${selectedBlockchain.id}`);
    }
  }, [privateKey, parsedData, selectedBlockchain]);

  useEffect(() => {
    if (wif && parsedData?.blockchain === selectedBlockchain.id) {
      localStorage.setItem(`walletWif_${selectedBlockchain.id}`, wif);
    } else {
      localStorage.removeItem(`walletWif_${selectedBlockchain.id}`);
    }
  }, [wif, parsedData, selectedBlockchain]);

  useEffect(() => {
    if (parsedData && parsedData.blockchain === selectedBlockchain.id) {
      const { ...dataToStore } = parsedData;
      localStorage.setItem(
        `walletParsedData_${selectedBlockchain.id}`,
        JSON.stringify(dataToStore)
      );
    } else {
      localStorage.removeItem(`walletParsedData_${selectedBlockchain.id}`);
    }
  }, [parsedData, selectedBlockchain]);

  useEffect(() => {
    if (parsedData?.blockchain === selectedBlockchain.id) {
      localStorage.setItem(
        `walletIsInitialized_${selectedBlockchain.id}`,
        isInitialized.toString()
      );
    } else {
      localStorage.removeItem(`walletIsInitialized_${selectedBlockchain.id}`);
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
    setIsOwner(false);
    setSendWrapped(false);
    localStorage.removeItem(`walletPrivateKey_${selectedBlockchain.id}`);
    localStorage.removeItem(`walletWif_${selectedBlockchain.id}`);
    localStorage.removeItem(`walletParsedData_${selectedBlockchain.id}`);
    localStorage.removeItem(`walletIsInitialized_${selectedBlockchain.id}`);
    localStorage.removeItem(`walletParsedData_${selectedBlockchain.id}_QR1`);
    localStorage.removeItem(`walletParsedData_${selectedBlockchain.id}_QR2`);
    localStorage.removeItem(`walletParsedData_${selectedBlockchain.id}_QR3`);
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
      if (selectedBlockchain.isBridge && !tokenPairsFetched) return;
      walletManager.checkStatus(appContext);
    }
  }, [
    privateKey,
    isInitialized,
    isSubmitting,
    parsedData,
    walletManager,
    log,
    tokenPairsFetched,
  ]);

  useEffect(() => {
    const go = async () => {
      if (tokenPairsFetched || !walletManager.fetchTokenPairs) return;
      const tp = await walletManager.fetchTokenPairs(appContext);
      setTokenPairsFetched(true);
      if (tp.length === 0) return;
      setTokenPairs(tp);
    };
    if (!tokenPairsFetched && contractAddresses.bridgeAddress) {
      go();
    }
    if (tokenPairs.length > 0) {
      const originalTokens = tokenPairs.map((pair) => ({
        address: pair.original,
        symbol: pair.symbol,
        name: pair.name,
        decimals: 18,
      }));
      appContext.setSupportedTokens(originalTokens);
      console.log(
        "Updated supported tokens with wrapped tokens:",
        originalTokens
      );
    }
  }, [tokenPairs, contractAddresses]);

  useEffect(() => {
    if (privateKey) {
      walletManager.fetchBalance(appContext);
    }
  }, [privateKey, selectedToken]);

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

        setCurrentScanIndex(i);
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
            `walletParsedData_${selectedBlockchain.id}_QR${index + 1}`,
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
          await walletManager.initializeKeyEventLog(appContext, webcamRef);
        }

        await checkOwnerStatus(appContext);

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
      setCurrentScanIndex(0);
    }
  };

  useEffect(() => {
    const checkBridgeVersion = async () => {
      if (!contractAddresses.bridgeAddress || !isDeployed) {
        setIsNewBridgeVersion(false);
        return;
      }

      try {
        const bridge = new ethers.Contract(
          contractAddresses.bridgeAddress,
          BRIDGE_UPGRADE_ABI,
          localProvider
        );
        await bridge.getTestString(); // This function only exists in BridgeUpgrade
        setIsNewBridgeVersion(true);
      } catch (error) {
        setIsNewBridgeVersion(false);
      }
    };

    checkBridgeVersion();
  }, [contractAddresses.bridgeAddress, isDeployed]);

  // === NEW: Secure Key-Rotation Upgrade Flow ===
  const handleSecureUpgrade = async () => {
    setIsSecureUpgradeFlow(true);
    setCurrentScanIndex(0);
    setIsScannerOpen(true);

    notifications.show({
      title: "Scan Confirming Key",
      message: "Scan the NEXT key in your rotation to confirm the upgrade",
      color: "blue",
    });
  };

  const handleLegacyUpgrade = async () => {
    // Directly call secureUpgrade with the single scanned key
    await walletManager.upgrade(appContext);
  };

  // Handle QR scan during secure upgrade
  useEffect(() => {
    if (!isScannerOpen || !isSecureUpgradeFlow) return;

    const handleScan = async () => {
      try {
        const qrData = await capture(webcamRef);
        if (qrData) {
          const [wifString] = qrData.split("|");
          const { newPrivateKey, newParsedData } =
            await walletManager.processScannedQR(
              appContext,
              qrData,
              false,
              true
            );

          setIsScannerOpen(false);

          // Directly call secureUpgrade with the single scanned key
          await walletManager.upgrade(appContext, {
            wif: wifString,
            parsed: newParsedData,
          });

          setIsSecureUpgradeFlow(false);
        }
      } catch (error) {
        console.log(error);
      }
    };

    const interval = setInterval(handleScan, 500);
    return () => clearInterval(interval);
  }, [isScannerOpen, isSecureUpgradeFlow]);

  const handleRotateKey = useCallback(
    async (appContext) => {
      try {
        await walletManager.rotateKey(appContext, webcamRef);
        await checkOwnerStatus(appContext);
      } catch (error) {
        notifications.show({
          title: "Error",
          message: error.message || "Failed to rotate key",
          color: "red",
        });
      }
    },
    [setIsOwner, walletManager]
  );

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
      await walletManager.wrap(appContext, webcamRef, wrapAmount, wrapAddress);
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
      await walletManager.unwrap(appContext, webcamRef, unwrapAmount);
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

  const getPancakeRouter = useCallback(() => {
    if (!privateKey || selectedBlockchain.id !== "bsc") return null;
    const signer = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localSwapProvider
    );
    return new ethers.Contract(
      PANCAKE_ROUTER_ADDRESS,
      PANCAKE_ROUTER_ABI,
      signer
    );
  }, [privateKey, selectedBlockchain.id]);

  const refreshAfterTx = async () => {
    await walletManager.fetchBalance(appContext);
    await walletManager.buildTransactionHistory(appContext);
  };

  appContext.getPancakeRouter = getPancakeRouter;

  const totalItems = combinedHistory.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedHistory = combinedHistory.slice(startIndex, endIndex);

  // Close navbar when modals open
  useEffect(() => {
    if (isScannerOpen || isQRModalOpen) {
      if (opened) toggle();
    }
  }, [isScannerOpen, isQRModalOpen, opened, toggle]);

  useEffect(() => {
    if (opened) toggle();
  }, [selectedBlockchain]);

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 300,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" align="center" position="apart">
          <Burger
            opened={opened}
            onClick={toggle}
            hiddenFrom="sm"
            size="sm"
            color="white"
            mr="xl"
          />
          <Image height="45" src="/wallet/whale-wallet-logo.png"></Image>
          <Text size="lg" weight={500} color="white">
            Whale Wallet
          </Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <BlockchainNav />
        <Text>Request new blockchain/token listings or get support:</Text>
        <Text>info@yadacoin.io</Text>
        <Text>
          <a href="https://linktr.ee/yadacoin" target="_blank">
            linktr.ee/yadacoin
          </a>
        </Text>
      </AppShell.Navbar>
      <AppShell.Main>
        <WalletHeader styles={styles} selectedBlockchain={selectedBlockchain} />
        <Container size="lg" py="xl">
          <Notifications position="top-center" />
          {!selectedBlockchain.disabled && (
            <>
              <WalletStateHandler
                privateKey={privateKey}
                isSubmitting={isSubmitting}
                isInitialized={isInitialized}
                parsedData={parsedData}
                log={log}
                onDeployContracts={handleDeployContracts}
                onRotateKey={() => {
                  handleRotateKey(appContext);
                }}
                onReset={resetWalletState}
                isDeployed={isDeployed}
                styles={styles}
              />
              {privateKey &&
                isDeployed &&
                log.length === parsedData.rotation && (
                  <>
                    <Card
                      withBorder
                      mt="md"
                      radius="md"
                      p="md"
                      style={styles.card}
                    >
                      <Title order={5}>Wallet state</Title>
                      <Text mt="md">
                        {parsedData.rotation === log.length
                          ? `Wallet is ready. You can send transactions with this key (rotation ${parsedData.rotation}).`
                          : `Please rotate to the next key (rotation ${log.length}) to sign transactions.`}
                      </Text>
                      {!isInitialized && (
                        <Button
                          disabled={balance <= 0}
                          onClick={async () => {
                            await walletManager.initializeKeyEventLog(
                              appContext,
                              webcamRef
                            );
                          }}
                        >
                          {balance <= 0
                            ? `Cannot initialize wallet (${
                                selectedBlockchain.isBridge
                                  ? "BNB"
                                  : selectedBlockchain.id.toUpperCase()
                              } balance is 0)`
                            : "Initialize wallet"}
                        </Button>
                      )}
                    </Card>
                    {isInitialized &&
                      selectedBlockchain.isBridge &&
                      log.length === parsedData.rotation && (
                        <TokenSelector styles={styles} />
                      )}
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
                      selectedBlockchain={selectedBlockchain}
                      sendWrapped={sendWrapped}
                    />

                    {isInitialized &&
                      selectedBlockchain.isBridge &&
                      log.length === parsedData.rotation && (
                        <>
                          {isOwner && (
                            <>
                              <TokenPairsForm
                                appContext={appContext}
                                webcamRef={webcamRef}
                                styles={styles}
                              />
                            </>
                          )}
                          {isOwner &&
                            selectedToken ===
                              contractAddresses.yadaERC20Address && (
                              <Card
                                withBorder
                                mt="md"
                                radius="md"
                                p="md"
                                style={styles.card}
                              >
                                <MintForm
                                  walletManager={walletManager}
                                  appContext={appContext}
                                  webcamRef={webcamRef}
                                  tokenSymbol={tokenSymbol}
                                  wrappedTokenSymbol={wrappedTokenSymbol}
                                  styles={styles}
                                />
                                <BurnForm
                                  walletManager={walletManager}
                                  appContext={appContext}
                                  webcamRef={webcamRef}
                                  tokenSymbol={tokenSymbol}
                                  wrappedTokenSymbol={wrappedTokenSymbol}
                                  styles={styles}
                                />
                              </Card>
                            )}
                        </>
                      )}

                    {isInitialized && (
                      <>
                        <Card
                          withBorder
                          mt="md"
                          radius="md"
                          p="md"
                          style={styles.card}
                        >
                          <Title order={4}>Wrap tokens</Title>
                          <Group mt="md" align="flex-end">
                            <div style={{ flex: 1 }}>
                              {!selectedBlockchain.isBridge && (
                                <div style={{ flex: 1 }}>
                                  <TextInput
                                    label={`Wrap to address`}
                                    value={wrapAddress}
                                    onChange={(e) =>
                                      setWrapAddress(e.currentTarget.value)
                                    }
                                    placeholder="0x...."
                                    disabled={
                                      !isDeployed ||
                                      !isInitialized ||
                                      (selectedBlockchain.isBridge &&
                                        !tokenPairs.some(
                                          (p) =>
                                            p.original.toLowerCase() ===
                                            selectedToken?.toLowerCase()
                                        ))
                                    }
                                    styles={styles.input}
                                  />
                                </div>
                              )}
                              <AmountInput
                                label={`Wrap Amount (${
                                  selectedBlockchain.isBridge
                                    ? tokenSymbol
                                    : "YDA to WYDA"
                                })`}
                                value={wrapAmount}
                                onChange={(value) =>
                                  setWrapAmount(
                                    value === undefined ? "" : value.toString()
                                  )
                                }
                                placeholder={`Enter amount of ${
                                  selectedBlockchain.isBridge
                                    ? tokenSymbol
                                    : "YDA"
                                } wrap`}
                                decimalScale={18}
                                disabled={
                                  !isDeployed ||
                                  !isInitialized ||
                                  (selectedBlockchain.isBridge &&
                                    !tokenPairs.some(
                                      (p) =>
                                        p.original.toLowerCase() ===
                                        selectedToken?.toLowerCase()
                                    ))
                                }
                                styles={styles.input}
                              />
                              <Button
                                onClick={handleWrap}
                                color="blue"
                                disabled={
                                  !isDeployed ||
                                  !isInitialized ||
                                  (selectedBlockchain.isBridge &&
                                    !tokenPairs.some(
                                      (p) =>
                                        p.original.toLowerCase() ===
                                        selectedToken?.toLowerCase()
                                    )) ||
                                  !wrapAmount ||
                                  parseFloat(wrapAmount) <= 0 ||
                                  (balance &&
                                    parseFloat(wrapAmount) >
                                      parseFloat(balance.original))
                                }
                                mt="sm"
                              >
                                Wrap{" "}
                                {selectedBlockchain.isBridge
                                  ? tokenSymbol
                                  : "YDA"}
                              </Button>
                            </div>
                            {selectedBlockchain.isBridge && (
                              <div style={{ flex: 1 }}>
                                <AmountInput
                                  label={`Unwrap Amount (${
                                    selectedBlockchain.isBridge
                                      ? wrappedTokenSymbol
                                      : "WYDA to YDA"
                                  })`}
                                  value={unwrapAmount}
                                  onChange={(value) =>
                                    setUnwrapAmount(
                                      value === undefined
                                        ? ""
                                        : value.toString()
                                    )
                                  }
                                  placeholder={`Enter amount of ${
                                    selectedBlockchain.isBridge
                                      ? tokenSymbol
                                      : "YDA"
                                  } unwrap`}
                                  decimalScale={18}
                                  disabled={
                                    !isDeployed ||
                                    !isInitialized ||
                                    !tokenPairs.some(
                                      (p) =>
                                        p.original.toLowerCase() ===
                                        selectedToken?.toLowerCase()
                                    )
                                  }
                                  styles={styles.input}
                                />
                                <Button
                                  onClick={handleUnwrap}
                                  disabled={
                                    !isDeployed ||
                                    !isInitialized ||
                                    !tokenPairs.some(
                                      (p) =>
                                        p.original.toLowerCase() ===
                                        selectedToken?.toLowerCase()
                                    ) ||
                                    !unwrapAmount ||
                                    parseFloat(unwrapAmount) <= 0 ||
                                    (balance &&
                                      parseFloat(unwrapAmount) >
                                        parseFloat(balance.wrapped))
                                  }
                                  mt="sm"
                                >
                                  Unwrap{" "}
                                  {selectedBlockchain.isBridge
                                    ? tokenSymbol
                                    : "YDA"}
                                </Button>
                              </div>
                            )}
                          </Group>
                        </Card>

                        <SendBalanceForm
                          appContext={appContext}
                          webcamRef={webcamRef}
                        />
                        {selectedBlockchain.id === "bsc" && (
                          <>
                            <SwapForm
                              appContext={appContext}
                              webcamRef={webcamRef}
                              walletManager={walletManager}
                              supportedTokens={supportedTokens}
                              balance={balance}
                              tokenSymbol={tokenSymbol}
                              wrappedTokenSymbol={wrappedTokenSymbol}
                              refreshAfterTx={refreshAfterTx}
                            />
                            <LiquidityForm
                              appContext={appContext}
                              webcamRef={webcamRef}
                              walletManager={walletManager}
                              supportedTokens={supportedTokens}
                              balance={balance}
                              refreshAfterTx={refreshAfterTx}
                            />
                          </>
                        )}
                      </>
                    )}
                    {isInitialized && parsedData.rotation === log.length && (
                      <TransactionForm
                        recipients={recipients}
                        onAddRecipient={addRecipient}
                        onRemoveRecipient={removeRecipient}
                        onUpdateRecipient={updateRecipient}
                        onSendTransaction={handleSignTransaction}
                        setFocusedRotation={setFocusedRotation}
                        styles={styles}
                        feeEstimate={feeEstimate}
                        selectedBlockchain={selectedBlockchain}
                      />
                    )}
                  </>
                )}
              {isOwner && (
                <Card
                  mt="md"
                  shadow="sm"
                  padding="lg"
                  radius="md"
                  withBorder
                  style={styles.card}
                >
                  <Title order={4} mb="md">
                    Admin Actions
                  </Title>

                  {isNewBridgeVersion === null ? (
                    <Text>Checking bridge version...</Text>
                  ) : isNewBridgeVersion ? (
                    <>
                      <Text size="sm" color="dimmed" mb="md">
                        Secure upgrade mode active. Standard upgrades are
                        disabled.
                      </Text>
                      <Button
                        color="orange"
                        onClick={handleSecureUpgrade}
                        loading={isSecureUpgradeFlow}
                        disabled={isScannerOpen}
                      >
                        {secureUpgradeScans.length > 0
                          ? `Continue Secure Upgrade (${secureUpgradeScans.length}/2 keys scanned)`
                          : "Upgrade Contracts (Secure Key Rotation)"}
                      </Button>
                      {secureUpgradeScans.length > 0 && (
                        <Button
                          variant="outline"
                          color="red"
                          ml="sm"
                          onClick={() => {
                            setSecureUpgradeScans([]);
                            setIsSecureUpgradeFlow(false);
                            setIsScannerOpen(false);
                          }}
                        >
                          Cancel Upgrade
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Text size="sm" color="dimmed" mb="md">
                        Legacy upgrade available (one-time use before secure
                        mode).
                      </Text>
                      <Button
                        color={blockchainColor}
                        onClick={handleLegacyUpgrade}
                      >
                        Upgrade Contracts (Legacy)
                      </Button>
                    </>
                  )}

                  <Button
                    mt="md"
                    color={blockchainColor}
                    onClick={() => walletManager.emergencyRecover(appContext)}
                  >
                    Recover tBNB from contract
                  </Button>
                </Card>
              )}

              {combinedHistory.length > 0 && (
                <TransactionHistory
                  combinedHistory={paginatedHistory}
                  allHistory={combinedHistory}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  styles={styles}
                  selectedBlockchain={selectedBlockchain}
                />
              )}
              <Group mt="xl">
                <Button
                  onClick={resetWalletState}
                  color="red"
                  variant="outline"
                >
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
                isDeployed={isDeployed}
                currentScanIndex={currentScanIndex}
              />
              <QRDisplayModal
                isOpen={isQRModalOpen}
                onClose={() => setIsQRModalOpen(false)}
                parsedData={parsedData}
                log={log}
                styles={styles}
              />
            </>
          )}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
};

export default Wallet2;
