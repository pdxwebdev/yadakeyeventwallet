/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

import React, { useEffect, useState } from "react";
import {
  Table,
  ScrollArea,
  Card,
  Title,
  Button,
  TextInput,
  Group,
  ActionIcon,
  Flex,
  Text,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { Transaction } from "../utils/transaction";
import {
  deriveSecurePath,
  getP2PKH,
  generateSHA256,
  generateSignatureWithPrivateKey,
  createHDWallet,
  initWalletFromMnemonic,
} from "../utils/hdWallet";
import { useAppContext } from "../context/AppContext";
import WalletInitializer from "./WalletInitializer";
import KeyEventLogTable from "../components/keyeventlogtable";
import axios from "axios";
import KELInitializer from "./KELInitializer";

const Wallet = () => {
  const {
    wallet,
    balance,
    setBalance,
    transactions,
    setTransactions,
    recipient,
    setRecipient,
    amount,
    setAmount,
    getBalance,
    getKeyEventLog,
    log,
    setLog,
    setWallet,
    hasKel,
    hasKEL,
  } = useAppContext();
  const [recipients, setRecipients] = useState([{ to: "", value: "" }]);
  useEffect(() => {
    const getWallet = async () => {
      const mnemonic = localStorage.getItem("mnemonic");

      const { wallet, mfa, log } = await initWalletFromMnemonic(mnemonic);
      setLog(log);
      setWallet(wallet);
    };
    if (!wallet) getWallet();
  }, [wallet]);
  useEffect(() => {
    const getLog = async () => {
      await getKeyEventLog();
    };
    if (wallet && !log) getLog();
  }, [wallet, log]);
  useEffect(() => {
    const getHasKel = async () => {
      await hasKEL();
    };
    if (wallet && !hasKel) getHasKel();
  }, [wallet, hasKel]);
  useEffect(() => {
    const getBalanceInfo = async () => {
      await getBalance();
    };
    if (wallet && log && !balance) getBalanceInfo();
  }, [wallet, log]);

  const handleAddRecipient = () => {
    setRecipients([...recipients, { to: "", value: "" }]);
  };

  const handleRemoveRecipient = (index) => {
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const handleRecipientChange = (index, field, value) => {
    const updatedRecipients = recipients.map((recipient, i) =>
      i === index ? { ...recipient, [field]: value } : recipient
    );
    setRecipients(updatedRecipients);
  };

  const sendTransactions = async (items) => {
    const res = await axios.post(
      `${import.meta.env.VITE_API_URL}/transaction?username_signature=asdf`,
      JSON.stringify(items.map((item) => item.toJson())),
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
            setWallet((prevHdWallet) => txn.key);
          }
        } else if (res2.data.status === false) {
          setError(res2.data.message);
        }
      }, 10000);
    }
  };

  const handleSend = async () => {
    let total = 0;
    const filteredRecipients = recipients
      .filter((r) => r.to.trim() !== "" && r.value.trim() !== "")
      .map((item) => {
        total += parseFloat(item.value);
        return { to: item.to, value: parseFloat(item.value) };
      });
    if (filteredRecipients.length === 0) {
      alert("Please enter valid recipient addresses and amounts.");
      return;
    }

    const res = await axios.get(
      `${import.meta.env.VITE_API_URL}/get-graph-wallet?address=${getP2PKH(
        wallet.publicKey
      )}`
    );
    const inputs = res.data.unspent_transactions.reduce(
      (accumulator, utxo) => {
        if (accumulator.total >= amount) return accumulator;
        const utxoValue = utxo.outputs.reduce(
          (sum, output) => sum + output.value,
          0
        );
        accumulator.selected.push({ id: utxo.id });
        accumulator.total += utxoValue;
        return accumulator;
      },
      { selected: [], total: 0 }
    );
    const mfa = prompt("Enter your wallet password.");
    if (!mfa) return;
    const b = await deriveSecurePath(wallet, mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, mfa); //0/0/0 --> //0/0/0/0
    const d = await deriveSecurePath(c, mfa); //0/0/0 --> //0/0/0/0
    let meoutput = null;
    if (inputs.total - total > 0) {
      meoutput = {
        value: inputs.total - total,
        to: getP2PKH(c.publicKey),
      };
      filteredRecipients.push(meoutput);
    }
    const txn = new Transaction({
      key: wallet,
      public_key: Buffer.from(wallet.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      inputs: inputs.selected,
      outputs: filteredRecipients,
      relationship: "",
      relationship_hash: await generateSHA256(""),
      public_key_hash: getP2PKH(wallet.publicKey),
      prev_public_key_hash:
        log.length > 0
          ? log.filter(
              (item) => item.prerotated_key_hash === getP2PKH(wallet.publicKey)
            )[0].public_key_hash
          : "",
    });
    await txn.hashAndSign();
    if (
      txn.outputs.length > 1 ||
      txn.outputs[0].to !== txn.prerotated_key_hash ||
      txn.relationship
    ) {
      const confirming_txn = new Transaction({
        key: b,
        public_key: Buffer.from(b.publicKey).toString("hex"), //0/0
        twice_prerotated_key_hash: getP2PKH(
          d.publicKey //0/0/0
        ),
        prerotated_key_hash: getP2PKH(
          c.publicKey //0/0/0
        ),
        inputs: [],
        outputs: [
          {
            to: getP2PKH(
              c.publicKey //0/0/0
            ),
            value: 0,
          },
        ],
        relationship: "",
        relationship_hash: await generateSHA256(""),
        public_key_hash: getP2PKH(b.publicKey),
        prev_public_key_hash: txn.public_key_hash,
      });
      await confirming_txn.hashAndSign();
      await sendTransactions([txn, confirming_txn]);
    }
  };

  if (!wallet) {
    return <WalletInitializer />;
  }
  if (!hasKel) {
    return <KELInitializer />;
  }

  return (
    <Card shadow="sm" p="lg" radius="md" withBorder>
      <Flex direction="row" align="center">
        <Title>Balance: {balance}</Title>
      </Flex>
      <Title order={4} mt="md">
        Recipient(s)
      </Title>
      {recipients.map((recipient, index) => (
        <Group key={index} grow mt="xs">
          <TextInput
            placeholder="Recipient Address"
            value={recipient.to}
            onChange={(e) =>
              handleRecipientChange(index, "to", e.currentTarget.value)
            }
          />
          <TextInput
            placeholder="Amount"
            value={recipient.amount}
            onChange={(e) =>
              handleRecipientChange(index, "value", e.currentTarget.value)
            }
          />
          <ActionIcon
            color="red"
            onClick={() => handleRemoveRecipient(index)}
            disabled={recipients.length === 1} // Prevent removing the last recipient
          >
            <IconTrash size={18} />
          </ActionIcon>
        </Group>
      ))}
      <Group position="apart" mt="md">
        <Button onClick={handleAddRecipient} variant="outline">
          Add Another Recipient
        </Button>
        <Button onClick={handleSend}>Send</Button>
      </Group>
      {log && log.length > 0 && <KeyEventLogTable keyEventLogs={log} />}
    </Card>
  );
};

export default Wallet;
