/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

// src/pages/WalletInitializer.jsx
import { Button, Container, Text, Title } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";
import axios from "axios";
import {
  deriveSecurePath,
  generateSHA256,
  generateSignatureWithPrivateKey,
  getP2PKH,
} from "../utils/hdWallet";
import { Transaction } from "../utils/transaction";
import { Wallet } from "ethers";

export default function KELInitializer() {
  const { balance, wallet, hasKEL, hasKel } = useAppContext();
  const [sent, setSent] = useState();
  const [status, setStatus] = useState();
  const [txn, setTxn] = useState();
  const [error, setError] = useState();

  useEffect(() => {
    const checkHasKel = async () => {
      await hasKEL();
    };
    if (hasKel === null) checkHasKel();
  }, [hasKel]);

  const sendTransaction = async (wallet, txn) => {
    await txn.generateHash();
    txn.id = await generateSignatureWithPrivateKey(wallet.privateKey, txn.hash);
    const res = await axios.post(
      `${import.meta.env.VITE_API_URL}/transaction?username_signature=asdf`,
      txn.toJson(),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    if (res.data && res.data[0] && res.data[0].id) {
      const id = setInterval(async () => {
        const res2 = await axios.get(
          `${import.meta.env.VITE_API_URL}/get-transaction-by-id?id=${txn.id}`
        );
        if (res2.data.id) {
          if (res2.data.mempool === true) {
            txn.status = "pending";
          } else {
            clearInterval(id);
            txn.status = "onchain";
            setHdWallet((prevHdWallet) => txn.key);
          }
        } else if (res2.data.status === false) {
          setError(res2.data.message);
        }
      }, 10000);
    }
  };

  const initializaKEL = async () => {
    const mfa = prompt("Enter your wallet password.");
    const a = await deriveSecurePath(wallet, mfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, mfa); //0/0/0 --> //0/0/0/0
    const txn = new Transaction({
      public_key: Buffer.from(a.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            b.publicKey //0/0/0
          ),
          value: 0,
        },
      ],
      relationship: "",
      relationship_hash: await generateSHA256(""),
      public_key_hash: getP2PKH(a.publicKey),
      prev_public_key_hash: "",
    });
    await sendTransaction(a, txn);
    setSent(true);
    setTxn(txn);
  };
  if (hasKel) {
    return <Wallet />;
  }
  return (
    <>
      <Container size="sm" style={{ marginTop: "2rem" }}>
        <Title order={2} align="center">
          Initialize Your Key Event Log
        </Title>
        <Text>Balance: {balance} YDA</Text>
        <Button onClick={initializaKEL}>Intialize Key Event Log</Button>
        {sent && <Text>Status: {txn.status}</Text>}
      </Container>
    </>
  );
}
