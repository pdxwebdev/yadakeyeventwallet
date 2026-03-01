import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  AppShell,
  Container,
  Card,
  Button,
  Text,
  Group,
  Grid,
  Title,
  TextInput,
  Burger,
  Image,
  Textarea,
  Modal,
  ScrollArea,
  Accordion,
  ActionIcon,
  NavLink,
} from "@mantine/core";
import { notifications, Notifications } from "@mantine/notifications";
import { useAppContext } from "../context/AppContext";
import { walletManagerFactory } from "../blockchains/WalletManagerFactory";
import WalletHeader from "../components/Wallet2/WalletHeader";
import WalletBalance from "../components/Wallet2/WalletBalance";
import SecurityAlerts from "../components/Wallet2/SecurityAlerts";
import TransactionForm from "../components/Wallet2/TransactionForm";
import TransactionHistory from "../components/Wallet2/TransactionHistory";
import QRScannerModal from "../components/Wallet2/QRScannerModal";
import QRDisplayModal from "../components/Wallet2/QRDisplayModal";
import WalletStateHandler from "../components/Wallet2/WalletStateHandler";
import BlockchainNav from "../components/Wallet2/BlockchainNav";
import TokenPairsForm from "../components/Wallet2/TokenPairsForm";
import { TokenManagementForm } from "../components/Wallet2/MintBurnForms";
import { styles } from "../shared/styles";
import { fromWIF } from "../utils/hdWallet";
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
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import AmountInput from "../components/Wallet2/AmountInput";
import {
  IconBook,
  IconMaximize,
  IconSearch,
  IconX,
  IconWallet,
  IconSend,
  IconArrowsExchange,
  IconHistory,
  IconShieldLock,
  IconTransfer,
  IconKey,
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconUpload,
  IconTrash,
  IconCheck,
  IconSignature,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { glossaryTerms } from "../shared/glossary";

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
    isOwner,
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

  const [opened, { toggle }] = useDisclosure(false);
  const isSmOrLarger = useMediaQuery("(min-width: 576px)");
  const [currentScanIndex, setCurrentScanIndex] = useState(0);
  const [wrapAmount, setWrapAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const [wrapAddress, setWrapAddress] = useState("");
  const [isSecureUpgradeFlow, setIsSecureUpgradeFlow] = useState(false);
  const [secureUpgradeScans, setSecureUpgradeScans] = useState([]);
  const [isNewBridgeVersion, setIsNewBridgeVersion] = useState(null);
  const [messageToSign, setMessageToSign] = useState("");
  const [signResult, setSignResult] = useState(null);
  const [isSigning, setIsSigning] = useState(false);

  const [glossaryOpen, { open: openGlossary, close: closeGlossary }] =
    useDisclosure(false);
  const [demoModalOpen, { open: openDemo, close: closeDemo }] =
    useDisclosure(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Navigation state
  const [activeSection, setActiveSection] = useState("overview");

  // Auto-open demo video on first visit
  useEffect(() => {
    const demoPresentationShown = localStorage.getItem("demoPresentationShown");
    if (!demoPresentationShown) {
      openDemo();
    }
  }, [openDemo]);

  // Handle demo modal close with localStorage tracking
  const handleDemoClose = () => {
    localStorage.setItem("demoPresentationShown", "true");
    closeDemo();
  };

  useEffect(() => {
    const saved = localStorage.getItem(`lastSection_${selectedBlockchain.id}`);
    if (
      saved &&
      [
        "overview",
        "send",
        "swap",
        "wrap",
        "bridge",
        "history",
        "sign",
        "admin",
      ].includes(saved)
    ) {
      setActiveSection(saved);
    }
  }, [selectedBlockchain.id]);

  useEffect(() => {
    localStorage.setItem(`lastSection_${selectedBlockchain.id}`, activeSection);
  }, [activeSection, selectedBlockchain.id]);

  const walletManager = useMemo(
    () => walletManagerFactory(selectedBlockchain.id),
    [selectedBlockchain]
  );

  const { tokenSymbol, wrappedTokenSymbol } = useMemo(() => {
    if (!selectedBlockchain.isBridge) {
      return {
        tokenSymbol: selectedBlockchain.id.toUpperCase(),
        wrappedTokenSymbol: "",
      };
    }
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
            console.log("Setting isOwner to true");
            return true;
          }
          return prev;
        });
      } else {
        setIsOwner((prev) => {
          if (prev !== false) {
            console.log("Setting isOwner to false");
            return false;
          }
          return prev;
        });
      }
    } catch (error) {
      console.error("Error checking owner status:", error);
      setIsOwner((prev) => {
        if (prev !== false) {
          console.log("Setting isOwner to false due to error");
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
        await bridge.getTestString();
        setIsNewBridgeVersion(true);
      } catch (error) {
        setIsNewBridgeVersion(false);
      }
    };

    checkBridgeVersion();
  }, [contractAddresses.bridgeAddress, isDeployed]);

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
    await walletManager.upgrade(appContext);
    setIsNewBridgeVersion(true);
  };

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
    [walletManager]
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

  const handleSignMessage = async () => {
    if (!messageToSign.trim()) {
      notifications.show({
        title: "Missing message",
        message: "Please paste the message you want to sign",
        color: "yellow",
      });
      return;
    }

    setIsSigning(true);
    setSignResult(null);

    try {
      const result = await walletManager.signMessage(
        appContext,
        webcamRef,
        messageToSign.trim()
      );

      setSignResult(result);

      notifications.show({
        title: "Signature Created",
        message: "Message signed successfully",
        color: "green",
      });
    } catch (error) {
      notifications.show({
        title: "Signing Failed",
        message: error.message || "Could not sign message",
        color: "red",
      });
    } finally {
      setIsSigning(false);
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
      footer={{ height: 70 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" align="center" justify="space-between">
          <Burger
            opened={opened}
            onClick={toggle}
            hiddenFrom="sm"
            size="sm"
            color="white"
            mr="xl"
          />
          <Group>
            <Image height="45" src="/wallet/whale-wallet-logo.png" />
            <Text size="lg" fw={500} c="white">
              Whale Wallet
            </Text>
          </Group>
          <ActionIcon
            variant="light"
            size="lg"
            onClick={openGlossary}
            title="Open Glossary"
            ml="auto"
          >
            <IconBook size={20} />
          </ActionIcon>
          <ActionIcon
            variant="light"
            size="lg"
            onClick={openDemo}
            title="Watch Demonstration"
          >
            <IconPlayerPlay size={20} />
          </ActionIcon>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <BlockchainNav />
        <Text>Request new blockchain/token listings or get support:</Text>
        <Text>info@yadacoin.io</Text>
        <Text>
          <a href="https://linktr.ee/yadacoin" target="_blank" rel="noreferrer">
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
              {activeSection === "overview" && (
                <>
                  <SecurityAlerts
                    parsedData={parsedData}
                    selectedBlockchain={selectedBlockchain}
                    onRotateKey={() => {
                      walletManager.fetchBalance(appContext);
                      walletManager.buildTransactionHistory(appContext);
                    }}
                  />

                  <WalletStateHandler
                    privateKey={privateKey}
                    isSubmitting={isSubmitting}
                    isInitialized={isInitialized}
                    parsedData={parsedData}
                    log={log}
                    onDeployContracts={handleDeployContracts}
                    onRotateKey={() => handleRotateKey(appContext)}
                    isDeployed={isDeployed}
                    styles={styles}
                  />

                  {privateKey &&
                    isDeployed &&
                    log.length === (parsedData?.rotation ?? 0) && (
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
                              leftSection={<IconKey size={16} />}
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

                        {isInitialized && <></>}
                      </>
                    )}
                </>
              )}

              {activeSection === "send" && isInitialized && (
                <>
                  {(parsedData?.rotation ?? 0) === log.length && (
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
                      balance={balance}
                    />
                  )}
                  <SendBalanceForm
                    appContext={appContext}
                    webcamRef={webcamRef}
                  />
                </>
              )}

              {activeSection === "swap" &&
                selectedBlockchain.id === "bsc" &&
                isInitialized && (
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

              {activeSection === "wrap" && isInitialized && (
                <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
                  <Title order={4}>Wrap / Unwrap tokens</Title>

                  <Grid mt="md" gutter="md">
                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Title order={6} mb="xs">
                        Wrap → {tokenSymbol}
                      </Title>

                      {!selectedBlockchain.isBridge && (
                        <TextInput
                          label="Wrap to address"
                          value={wrapAddress}
                          onChange={(e) =>
                            setWrapAddress(e.currentTarget.value)
                          }
                          placeholder="0x..."
                          disabled={
                            !isDeployed ||
                            !isInitialized ||
                            (selectedBlockchain.isBridge &&
                              !tokenPairs.some(
                                (p) =>
                                  p.original.toLowerCase() ===
                                  (selectedToken?.toLowerCase() ?? "")
                              ))
                          }
                          styles={styles.input}
                          mb="xs"
                        />
                      )}

                      <Group align="flex-end" wrap="nowrap">
                        <div style={{ flex: 1 }}>
                          <AmountInput
                            label={`Amount to wrap (${tokenSymbol})`}
                            value={wrapAmount}
                            onChange={(value) =>
                              setWrapAmount(
                                value === undefined ? "" : String(value)
                              )
                            }
                            placeholder="0.0"
                            decimalScale={18}
                            disabled={
                              !isDeployed ||
                              !isInitialized ||
                              (selectedBlockchain.isBridge &&
                                !tokenPairs.some(
                                  (p) =>
                                    p.original.toLowerCase() ===
                                    (selectedToken?.toLowerCase() ?? "")
                                )) ||
                              !balance?.original
                            }
                            styles={styles.input}
                          />
                        </div>

                        <ActionIcon
                          size="lg"
                          variant="light"
                          color="blue"
                          onClick={() => {
                            if (balance?.original) {
                              setWrapAmount(balance.original);
                            }
                          }}
                          disabled={
                            !balance?.original || Number(balance.original) <= 0
                          }
                          title="Use maximum available balance"
                        >
                          <IconMaximize size={18} />
                        </ActionIcon>
                      </Group>

                      {balance?.original && (
                        <Text size="xs" c="dimmed" mt={4}>
                          Available:{" "}
                          {Number(balance.original).toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}{" "}
                          {tokenSymbol}
                        </Text>
                      )}

                      <Button
                        onClick={handleWrap}
                        color="blue"
                        disabled={
                          !isDeployed ||
                          !isInitialized ||
                          !tokenPairs.some(
                            (p) =>
                              p.original.toLowerCase() ===
                              (selectedToken?.toLowerCase() ?? "")
                          ) ||
                          !wrapAmount ||
                          Number(wrapAmount) <= 0 ||
                          (balance?.original &&
                            Number(wrapAmount) > Number(balance.original))
                        }
                        mt="sm"
                        fullWidth
                        leftSection={<IconArrowDown size={16} />}
                      >
                        Wrap {tokenSymbol}
                      </Button>
                    </Grid.Col>

                    <Grid.Col span={{ base: 12, md: 6 }}>
                      <Title order={6} mb="xs">
                        Unwrap ← {wrappedTokenSymbol}
                      </Title>

                      <Group align="flex-end">
                        <div style={{ flex: 1 }}>
                          <AmountInput
                            label={`Amount to unwrap (${wrappedTokenSymbol})`}
                            value={unwrapAmount}
                            onChange={(value) =>
                              setUnwrapAmount(
                                value === undefined ? "" : String(value)
                              )
                            }
                            placeholder="0.0"
                            decimalScale={18}
                            disabled={
                              !isDeployed ||
                              !isInitialized ||
                              !tokenPairs.some(
                                (p) =>
                                  p.original.toLowerCase() ===
                                  (selectedToken?.toLowerCase() ?? "")
                              ) ||
                              !balance?.wrapped
                            }
                            styles={styles.input}
                          />
                        </div>

                        <ActionIcon
                          size="lg"
                          variant="light"
                          color="blue"
                          onClick={() => {
                            if (balance?.wrapped) {
                              setUnwrapAmount(balance.wrapped);
                            }
                          }}
                          disabled={
                            !balance?.wrapped || Number(balance.wrapped) <= 0
                          }
                          title="Use maximum wrapped balance"
                        >
                          <IconMaximize size={18} />
                        </ActionIcon>
                      </Group>

                      {balance?.wrapped && (
                        <Text size="xs" c="dimmed" mt={4}>
                          Available:{" "}
                          {Number(balance.wrapped).toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}{" "}
                          {wrappedTokenSymbol}
                        </Text>
                      )}

                      <Button
                        onClick={handleUnwrap}
                        color="violet"
                        disabled={
                          !isDeployed ||
                          !isInitialized ||
                          !tokenPairs.some(
                            (p) =>
                              p.original.toLowerCase() ===
                              (selectedToken?.toLowerCase() ?? "")
                          ) ||
                          !unwrapAmount ||
                          Number(unwrapAmount) <= 0 ||
                          (balance?.wrapped &&
                            Number(unwrapAmount) > Number(balance.wrapped))
                        }
                        mt="sm"
                        fullWidth
                        leftSection={<IconArrowUp size={16} />}
                      >
                        Unwrap {wrappedTokenSymbol}
                      </Button>
                    </Grid.Col>
                  </Grid>
                </Card>
              )}

              {activeSection === "history" && (
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

              {activeSection === "sign" && privateKey && isInitialized && (
                <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
                  <Title order={4} mb="md">
                    Sign Arbitrary Message
                  </Title>
                  <Text size="sm" c="dimmed" mb="md">
                    Useful for contract verification (BscScan, etc.). Paste the
                    exact message from BscScan below (including newlines) and
                    click Sign.
                  </Text>

                  <Textarea
                    label="Message to sign"
                    placeholder="Paste the full message from BscScan here...\n(It usually has multiple lines)"
                    value={messageToSign}
                    onChange={(e) => setMessageToSign(e.currentTarget.value)}
                    minRows={5}
                    autosize
                    maxRows={12}
                    styles={styles.input}
                    disabled={isSigning}
                  />

                  <Group mt="md" justify="flex-end">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setMessageToSign("");
                        setSignResult(null);
                      }}
                      disabled={isSigning}
                      leftSection={<IconX size={16} />}
                    >
                      Clear
                    </Button>

                    <Button
                      onClick={handleSignMessage}
                      loading={isSigning}
                      disabled={isSigning || !messageToSign.trim()}
                      color="violet"
                      leftSection={<IconCheck size={16} />}
                    >
                      Sign Message
                    </Button>
                  </Group>

                  {signResult && (
                    <Card withBorder mt="xl" p="md" bg="dark" radius="md">
                      <Text fw={500} mb="xs">
                        Signed by: {signResult.address}
                      </Text>

                      <Text size="sm" fw={500} mt="md">
                        Original message:
                      </Text>
                      <Text
                        component="pre"
                        p="xs"
                        bg="dark.8"
                        style={{
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontFamily: "monospace",
                        }}
                      >
                        {signResult.message}
                      </Text>

                      <Text size="sm" fw={500} mt="md">
                        Signature:
                      </Text>
                      <Group gap="xs" align="center">
                        <Text
                          component="pre"
                          p="xs"
                          bg="dark.8"
                          style={{
                            flex: 1,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                            fontFamily: "monospace",
                          }}
                        >
                          {signResult.signature}
                        </Text>

                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => {
                            navigator.clipboard.writeText(signResult.signature);
                            notifications.show({
                              title: "Copied",
                              message: "Signature copied to clipboard",
                              color: "green",
                            });
                          }}
                          leftSection={<IconCopy size={14} />}
                        >
                          Copy signature
                        </Button>
                      </Group>

                      <Button
                        fullWidth
                        mt="md"
                        variant="light"
                        color="gray"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `Message:\n${signResult.message}\n\nSignature:\n${signResult.signature}`
                          );
                          notifications.show({
                            title: "Copied",
                            message: "Full result (message + signature) copied",
                            color: "green",
                          });
                        }}
                        leftSection={<IconCopy size={16} />}
                      >
                        Copy both
                      </Button>
                    </Card>
                  )}
                </Card>
              )}

              {activeSection === "admin" && isOwner && (
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
                      <Text size="sm" c="dimmed" mb="md">
                        Secure upgrade mode active. Standard upgrades are
                        disabled.
                      </Text>
                      <Button
                        color="orange"
                        onClick={handleSecureUpgrade}
                        loading={isSecureUpgradeFlow}
                        disabled={isScannerOpen}
                        leftSection={<IconUpload size={16} />}
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
                          leftSection={<IconX size={16} />}
                        >
                          Cancel Upgrade
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Text size="sm" c="dimmed" mb="md">
                        Legacy upgrade available (one-time use before secure
                        mode).
                      </Text>
                      <Button
                        color={blockchainColor}
                        onClick={handleLegacyUpgrade}
                        leftSection={<IconUpload size={16} />}
                      >
                        Upgrade Contracts (Legacy)
                      </Button>
                    </>
                  )}

                  <Button
                    mt="md"
                    color={blockchainColor}
                    onClick={() => walletManager.emergencyRecover(appContext)}
                    leftSection={<IconArrowDown size={16} />}
                  >
                    Recover tBNB from contract
                  </Button>
                </Card>
              )}

              {activeSection === "admin" && (
                <Card
                  mt="md"
                  shadow="sm"
                  padding="lg"
                  radius="md"
                  withBorder
                  style={styles.card}
                >
                  <Title order={4} mb="md">
                    Wallet Management
                  </Title>
                  <Button
                    onClick={resetWalletState}
                    color="red"
                    variant="outline"
                    fullWidth
                    leftSection={<IconTrash size={16} />}
                  >
                    Erase Wallet Cache
                  </Button>
                </Card>
              )}

              {activeSection === "admin" &&
                isOwner &&
                selectedBlockchain.isBridge &&
                selectedToken === contractAddresses.yadaERC20Address && (
                  <Card
                    withBorder
                    mt="md"
                    radius="md"
                    p="md"
                    style={styles.card}
                  >
                    <Title order={4} mb="md">
                      Token Management
                    </Title>
                    <TokenManagementForm
                      walletManager={walletManager}
                      appContext={appContext}
                      webcamRef={webcamRef}
                      tokenSymbol={tokenSymbol}
                      wrappedTokenSymbol={wrappedTokenSymbol}
                      styles={styles}
                    />
                  </Card>
                )}

              {activeSection === "admin" &&
                isOwner &&
                selectedBlockchain.isBridge && (
                  <TokenPairsForm
                    appContext={appContext}
                    webcamRef={webcamRef}
                    styles={styles}
                  />
                )}

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
              <Modal
                opened={glossaryOpen}
                onClose={closeGlossary}
                title={
                  <Group justify="space-between" style={{ width: "100%" }}>
                    <Text fw={600}>Web3 / DeFi / Wallet Glossary</Text>
                    <ActionIcon onClick={closeGlossary}>
                      <IconX size={18} />
                    </ActionIcon>
                  </Group>
                }
                withCloseButton={false}
                size="xl"
                padding="md"
                scrollAreaComponent={ScrollArea.Autosize}
              >
                <TextInput
                  placeholder="Search terms..."
                  value={searchTerm}
                  onChange={(e) =>
                    setSearchTerm(e.currentTarget.value.toLowerCase())
                  }
                  icon={<IconSearch size={16} />}
                  mb="md"
                  styles={(theme) => ({
                    input: { backgroundColor: theme.colors.dark[7] },
                  })}
                />

                <Accordion
                  variant="separated"
                  multiple
                  styles={{
                    item: { backgroundColor: "transparent", border: "none" },
                    content: { paddingTop: 0 },
                  }}
                >
                  {glossaryTerms
                    .filter(
                      (item) =>
                        !searchTerm ||
                        item.term.toLowerCase().includes(searchTerm) ||
                        item.definition.toLowerCase().includes(searchTerm)
                    )
                    .map((item, index) => (
                      <Accordion.Item key={index} value={item.term}>
                        <Accordion.Control>
                          <Text weight={500}>{item.term}</Text>
                        </Accordion.Control>
                        <Accordion.Panel>
                          <Text size="sm" c="dimmed">
                            {item.definition}
                          </Text>
                        </Accordion.Panel>
                      </Accordion.Item>
                    ))}

                  {glossaryTerms.filter(
                    (item) =>
                      !searchTerm ||
                      item.term.toLowerCase().includes(searchTerm) ||
                      item.definition.toLowerCase().includes(searchTerm)
                  ).length === 0 && (
                    <Text color="dimmed" align="center" mt="xl">
                      No terms found matching "{searchTerm}"
                    </Text>
                  )}
                </Accordion>
              </Modal>

              <Modal
                opened={demoModalOpen}
                onClose={handleDemoClose}
                title="Wallet Demonstration"
                size="lg"
                centered
              >
                <div
                  style={{
                    position: "relative",
                    paddingBottom: "56.25%",
                    height: 0,
                    overflow: "hidden",
                  }}
                >
                  <iframe
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      border: "none",
                    }}
                    src="https://www.youtube.com/embed/Cii3UYF4FqY"
                    title="Wallet Demonstration"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  ></iframe>
                </div>
              </Modal>
            </>
          )}
        </Container>
      </AppShell.Main>

      <AppShell.Footer p="xs" withBorder>
        <Group grow justify="center" align="center" style={{ width: "100%" }}>
          <NavLink
            label={isSmOrLarger ? "Overview" : undefined}
            leftSection={<IconWallet size={22} />}
            active={activeSection === "overview"}
            onClick={() => setActiveSection("overview")}
            title="Overview"
          />
          <NavLink
            label={isSmOrLarger ? "Send" : undefined}
            leftSection={<IconSend size={22} />}
            active={activeSection === "send"}
            onClick={() => setActiveSection("send")}
            disabled={!isInitialized}
            title="Send"
          />
          <NavLink
            label={isSmOrLarger ? "Swap" : undefined}
            leftSection={<IconArrowsExchange size={22} />}
            active={activeSection === "swap"}
            onClick={() => setActiveSection("swap")}
            disabled={selectedBlockchain.id !== "bsc" || !isInitialized}
            title="Swap"
          />
          <NavLink
            label={isSmOrLarger ? "Wrap" : undefined}
            leftSection={<IconTransfer size={22} />}
            active={activeSection === "wrap"}
            onClick={() => setActiveSection("wrap")}
            disabled={!isInitialized}
            title="Wrap"
          />
          <NavLink
            label={isSmOrLarger ? "History" : undefined}
            leftSection={<IconHistory size={22} />}
            active={activeSection === "history"}
            onClick={() => setActiveSection("history")}
            title="History"
          />
          <NavLink
            label={isSmOrLarger ? "Sign" : undefined}
            leftSection={<IconSignature size={22} />}
            active={activeSection === "sign"}
            onClick={() => setActiveSection("sign")}
            disabled={!privateKey || !isInitialized}
            title="Sign"
          />
          {isOwner && (
            <NavLink
              label={isSmOrLarger ? "Admin" : undefined}
              leftSection={<IconShieldLock size={22} />}
              active={activeSection === "admin"}
              onClick={() => setActiveSection("admin")}
              color="orange"
              title="Admin"
            />
          )}
        </Group>
      </AppShell.Footer>
    </AppShell>
  );
};

export default Wallet2;
