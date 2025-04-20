/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

// src/context/AppContext.jsx
import axios from "axios";
import React, { createContext, useState, useContext } from "react";
import { getP2PKH } from "../utils/hdWallet";
import { ethers } from "ethers";
import BridgeArtifact from "../utils/abis/Bridge.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import {
  BRIDGE_ADDRESS,
  MOCK2_ERC20_ADDRESS,
  MOCK_ERC20_ADDRESS,
} from "../shared/constants";

const localProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/");

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  // Global state you want to share across your app:
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [wif, setWif] = useState();
  const [wifWallet, setWifWallet] = useState();
  const [wifBalance, setWifBalance] = useState();
  const [log, setLog] = useState();
  const [hasKel, setHasKel] = useState(null);
  const [mfa, setMfa] = useState();
  const [loading, setLoading] = useState();
  const [signer, setSigner] = useState(null); // Current wallet signer
  const [account, setAccount] = useState(""); // Current wallet address
  const [isOperator, setIsOperator] = useState(false); // Flag for bridge operator
  const [userKeyState, setUserKeyState] = useState({}); // { address: { log, keyState } }
  const [selectedTestAccount, setSelectedTestAccount] = useState("");
  const [tokenPairs, setTokenPairs] = useState([]);
  const [error, setError] = useState("");

  const getBalance = async () => {
    const res = await axios.get(
      `${import.meta.env.VITE_API_URL}/get-graph-wallet?address=${getP2PKH(
        wallet.publicKey
      )}&amount_needed=1`
    );
    setBalance(() => res.data.balance);
  };
  const getWifBalance = async () => {
    const res = await axios.get(
      `${import.meta.env.VITE_API_URL}/get-graph-wallet?address=${getP2PKH(
        wifWallet.publicKey
      )}`
    );
    setWifBalance(() => res.data);
  };
  const getKeyEventLog = async () => {
    const res = await axios.get(
      `${import.meta.env.VITE_API_URL}/key-event-log?public_key=${Buffer.from(
        wallet.publicKey
      ).toString("hex")}`
    );
    setLog(() => res.data.key_event_log);
  };
  const hasKEL = async () => {
    const res = await axios.get(
      `${
        import.meta.env.VITE_API_URL
      }/has-key-event-log?public_key=${Buffer.from(wallet.publicKey).toString(
        "hex"
      )}`
    );
    setHasKel(() => res.data.status);
  };

  const fetchTokenPairs = async () => {
    try {
      setLoading(true);
      setError("");

      const bridge = new ethers.Contract(
        BRIDGE_ADDRESS,
        BridgeArtifact.abi,
        localProvider
      );

      // Known original tokens from your setup
      const knownOriginalTokens = [
        MOCK_ERC20_ADDRESS, // $MOCK
        MOCK2_ERC20_ADDRESS, // $MOCK2
      ];

      const pairs = await Promise.all(
        knownOriginalTokens.map(async (original) => {
          const wrapped = await bridge.originalToWrapped(original);
          if (wrapped !== ethers.ZeroAddress) {
            const wrappedContract = new ethers.Contract(
              wrapped,
              WrappedTokenArtifact.abi,
              localProvider
            );
            const name = await wrappedContract.name();
            const symbol = await wrappedContract.symbol();
            const isCrossChain = await bridge.isCrossChain(wrapped);
            return { original, wrapped, name, symbol, isCrossChain };
          }
          return null;
        })
      );

      const filteredPairs = pairs.filter((pair) => pair !== null);
      setTokenPairs(filteredPairs);
      setLoading(false);
    } catch (err) {
      setError(`Error fetching token pairs: ${err.message}`);
      setLoading(false);
    }
  };

  return (
    <AppContext.Provider
      value={{
        wallet,
        setWallet,
        balance,
        setBalance,
        transactions,
        setTransactions,
        getBalance,
        getKeyEventLog,
        log,
        setLog,
        hasKel,
        setHasKel,
        hasKEL,
        wif,
        setWif,
        wifWallet,
        setWifWallet,
        getWifBalance,
        wifBalance,
        setWifBalance,
        mfa,
        setMfa,
        loading,
        setLoading,
        signer,
        setSigner,
        account,
        setAccount,
        isOperator,
        setIsOperator,
        userKeyState,
        setUserKeyState,
        selectedTestAccount,
        setSelectedTestAccount,
        tokenPairs,
        setTokenPairs,
        fetchTokenPairs,
        error,
        setError,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

// A custom hook to use the AppContext in other components
export const useAppContext = () => {
  return useContext(AppContext);
};
