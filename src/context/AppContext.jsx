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
