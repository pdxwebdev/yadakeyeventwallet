// src/context/AppContext.js
import { createContext, useContext, useMemo, useState } from "react";

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [selectedBlockchain, setSelectedBlockchain] = useState("bsc"); // Default to BSC
  const [transactions, setTransactions] = useState([]);
  const [log, setLog] = useState([]);
  const [wif, setWif] = useState("");
  const [combinedHistory, setCombinedHistory] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [recipients, setRecipients] = useState([
    { address: "0x742d35cc6634c0532925a3b844bc454e4438f44e", amount: "100" },
  ]);
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
  const [selectedToken, setSelectedToken] = useState(null); // New: Selected token
  const [symbol, setSymbol] = useState(""); // New: Selected token
  const [contractAddresses, setContractAddresses] = useState({});
  const [isDeployed, setIsDeployed] = useState(false); // New state for deployment status
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
    ]
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => useContext(AppContext);
