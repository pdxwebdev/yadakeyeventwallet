// src/context/AppContext.js
import { ethers } from "ethers";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  BLOCKCHAINS,
  localProvider,
  addressesForChain,
  setLocalProviderForChain,
  PANCAKE_ROUTER_ADDRESS,
  PANCAKE_ROUTER_ABI,
} from "../shared/constants";

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const initialChain =
    BLOCKCHAINS.find((chain) => chain.id === "base") || BLOCKCHAINS[0];
  setLocalProviderForChain(initialChain);
  const [selectedBlockchain, setSelectedBlockchainState] = useState(initialChain);
  const setSelectedBlockchain = (chain) => {
    setLocalProviderForChain(chain);
    setSelectedBlockchainState(chain);
    setContractAddresses(addressesForChain(chain.id));
    setIsDeployed(chain.id === "base" || chain.id === "bsc");
    setTokenPairs([]);
    setTokenPairsFetched(false);
  };
  const [transactions, setTransactions] = useState([]);
  const [log, setLog] = useState([]);
  const [wif, setWif] = useState("");
  const [combinedHistory, setCombinedHistory] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [recipients, setRecipients] = useState([{ address: "", amount: "" }]);
  const [privateKey, setPrivateKey] = useState(null);
  const [focusedRotation, setFocusedRotation] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isTransactionFlow, setIsTransactionFlow] = useState(false);
  const [feeEstimate, setFeeEstimate] = useState(null);
  const [balance, setBalance] = useState(null);
  const [isOwner, setIsOwner] = useState(false); // Add isOwner state
  const [loading, setLoading] = useState(false);
  const [signer, setSigner] = useState(null);
  const [tokenPairs, setTokenPairs] = useState([]);
  const [selectedOriginal, setSelectedOriginal] = useState("");
  const [supportedTokens, setSupportedTokens] = useState([]); // New: List of supported tokens
  const [selectedToken, setSelectedToken] = useState(ethers.ZeroAddress); // New: Selected token
  const [symbol, setSymbol] = useState(""); // New: Selected token
  const [contractAddresses, setContractAddresses] = useState(
    addressesForChain(initialChain.id)
  );
  const [isDeployed, setIsDeployed] = useState(
    initialChain.id === "base" || initialChain.id === "bsc"
  );
  const [sendWrapped, setSendWrapped] = useState(false);
  const [tokenPairsFetched, setTokenPairsFetched] = useState(false);
  const [pancakeRouter, setPancakeRouter] = useState(null);
  const [useLpToken, setUseLpToken] = useState(false);

  // ── Agent state ───────────────────────────────────────────────────────────
  const [agents, setAgents] = useState([]);
  const [agentPlans, setAgentPlans] = useState([]);
  const [pendingAgentPlan, setPendingAgentPlan] = useState(null);
  const [guardianVerdict, setGuardianVerdict] = useState(null);
  const [isAgentKeyScanning, setIsAgentKeyScanning] = useState(false);
  const [executionResults, setExecutionResults] = useState(null);

  useEffect(() => {
    if (
      !privateKey ||
      selectedBlockchain.id !== "bsc" ||
      !privateKey.privateKey
    ) {
      setPancakeRouter(null);
      return;
    }

    const wallet = new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
    const router = new ethers.Contract(
      PANCAKE_ROUTER_ADDRESS,
      PANCAKE_ROUTER_ABI,
      wallet
    );

    setPancakeRouter(router);
  }, [privateKey, selectedBlockchain.id]);

  const value = useMemo(
    () => ({
      selectedBlockchain,
      setSelectedBlockchain,
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
      supportedTokens,
      setSupportedTokens,
      selectedToken,
      setSelectedToken,
      loading,
      setLoading,
      isOwner,
      setIsOwner,
      signer,
      setSigner,
      tokenPairs,
      setTokenPairs,
      selectedOriginal,
      setSelectedOriginal,
      symbol,
      setSymbol,
      contractAddresses,
      setContractAddresses,
      isDeployed,
      setIsDeployed,
      sendWrapped,
      setSendWrapped,
      tokenPairsFetched,
      setTokenPairsFetched,
      pancakeRouter,
      setPancakeRouter,
      useLpToken,
      setUseLpToken,
      agents,
      setAgents,
      agentPlans,
      setAgentPlans,
      pendingAgentPlan,
      setPendingAgentPlan,
      guardianVerdict,
      setGuardianVerdict,
      isAgentKeyScanning,
      setIsAgentKeyScanning,
      executionResults,
      setExecutionResults,
    }),
    [
      selectedBlockchain,
      transactions,
      log,
      wif,
      combinedHistory,
      currentPage,
      isScannerOpen,
      isQRModalOpen,
      parsedData,
      recipients,
      privateKey,
      focusedRotation,
      isSubmitting,
      isInitialized,
      isTransactionFlow,
      feeEstimate,
      balance,
      supportedTokens,
      selectedToken,
      loading,
      signer,
      tokenPairs,
      selectedOriginal,
      symbol,
      contractAddresses,
      isDeployed,
      isOwner,
      sendWrapped,
      tokenPairsFetched,
      pancakeRouter,
      useLpToken,
      agents,
      agentPlans,
      pendingAgentPlan,
      guardianVerdict,
      isAgentKeyScanning,
      executionResults,
    ]
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => useContext(AppContext);
