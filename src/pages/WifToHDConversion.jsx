/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

// src/pages/WifToHdConversion.jsx
import React, { useEffect, useState } from "react";
import {
  Container,
  Title,
  Paper,
  Text,
  TextInput,
  Button,
  Group,
  Alert,
  Progress,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useAppContext } from "../context/AppContext";
import {
  createHDWallet,
  deriveSecurePath,
  generateMnemonic,
  generateSHA256,
  getP2PKH,
  generateSignatureWithPrivateKey,
} from "../utils/hdWallet";
import { useNavigate } from "react-router-dom";
import { Transaction } from "../utils/transaction";
import axios from "axios";

const WifToHdConversion = () => {
  // State for the WIF wallet inputs and display values.
  const {
    wif,
    setWif,
    wallet,
    setWallet,
    wifBalance,
    wifWallet,
    getWifBalance,
    getBalance,
    balance,
  } = useAppContext();
  const navigate = useNavigate();

  // State for the new HD wallet details.
  const [hdAddress, setHdAddress] = useState("HD_ADDRESS_PLACEHOLDER");
  const [generatedMnemonic, setGeneratedMnemonic] = useState();
  const [seedPhraseDownloaded, setSeedPhraseDownloaded] = useState();
  const [address, setAddress] = useState();
  const [wifAddress, setWifAddress] = useState();
  const [kelInitialized, setKelInitialized] = useState(false);
  const [sent, setSent] = useState();
  const [status, setStatus] = useState();
  const [inceptionTxn, setInceptionTxn] = useState();
  const [error, setError] = useState();
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(600);
  const [hasKel, setHasKel] = useState();
  const [mnemonic, setMnemonic] = useState("");
  const [pendingTxn, setPendingTxn] = useState("");

  useEffect(() => {
    const getWallet = async () => {
      await getWifBalance();
      const wa = getP2PKH(
        wifWallet.publicKey //0/0/0
      );
      setWifAddress(wa);
    };
    if (wifWallet) getWallet();
  }, [wifWallet]);

  useEffect(() => {
    const getWallet = async () => {
      await getBalance();
      const hexPubkey = Buffer.from(wallet.publicKey).toString("hex");
      const res = await axios.get(
        `${
          import.meta.env.VITE_API_URL
        }/has-key-event-log?public_key=${hexPubkey}`
      );
      setHasKel(res.data.status);
    };
    if (wallet) {
      getWallet();
    }
  }, [wallet]);

  useEffect(() => {
    if (!wif) {
      return navigate("/wallet");
    }
  }, [wif]);

  useEffect(() => {
    let interval;
    if (inceptionTxn && inceptionTxn.status === "pending") {
      interval = setInterval(() => {
        const currentTime = Math.floor(Date.now() / 1000); // current time in seconds
        const secondsPassed = currentTime - inceptionTxn.time;
        let percent = (secondsPassed / 1200) * 100;
        if (percent > 100) percent = 100;
        setProgress(percent);
        const remaining = 1200 - secondsPassed;
        setTimeLeft(remaining > 0 ? remaining : 0);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [inceptionTxn]);

  useEffect(() => {
    let interval;
    if (pendingTxn && pendingTxn.status === "pending") {
      interval = setInterval(() => {
        const currentTime = Math.floor(Date.now() / 1000); // current time in seconds
        const secondsPassed = currentTime - pendingTxn.time;
        let percent = (secondsPassed / 1200) * 100;
        if (percent > 100) percent = 100;
        setProgress(percent);
        const remaining = 1200 - secondsPassed;
        setTimeLeft(remaining > 0 ? remaining : 0);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [pendingTxn]);

  const downloadSeed = () => {
    const blob = new Blob([generatedMnemonic], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "seed-phrase.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSeedPhraseDownloaded(true);
  };

  const createTxn = async (amount) => {
    const inputs = wifBalance.unspent_transactions.reduce(
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
    const txn = new Transaction({
      public_key: Buffer.from(wifWallet.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: "",
      prerotated_key_hash: "",
      inputs: inputs.selected,
      outputs: [
        {
          to: getP2PKH(
            wallet.publicKey //0/0/0
          ),
          value: amount,
        },
      ],
      relationship: "",
      relationship_hash: await generateSHA256(""),
      public_key_hash: "",
      prev_public_key_hash: "",
    });
    if (inputs.total < parseFloat(wifBalance.balance)) {
      txn.outputs.push({
        to: getP2PKH(
          wifWallet.publicKey //0/0/0
        ),
        value: inputs.total - amount,
      });
    }
    await sendTransaction(wifWallet, txn);
    setPendingTxn(txn);
  };

  // Dummy conversion handler.
  const handleSendEntireBalance = () => {
    createTxn(parseFloat(wifBalance.balance));
  };

  // Dummy conversion handler.
  const handleSendOneYda = () => {
    createTxn(1);
  };

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
            setWallet((prevHdWallet) => txn.key);
            setKelInitialized(true);

            await getWifBalance();
            await getBalance();
          }
        } else if (res2.data.status === false) {
          setError(res2.data.message);
        }
      }, 60000);
    }
  };

  const initializeKEL = async (newWallet) => {
    const mfa = prompt("Enter your wallet password.");
    const mfa_confirm = prompt("Confirm your wallet password.");
    if (mfa !== mfa_confirm) return alert("Password do not match. Try again.");
    const a = await deriveSecurePath(newWallet, mfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, mfa); //0/0/0 --> //0/0/0/0
    setAddress(
      getP2PKH(
        b.publicKey //0/0/0
      )
    );
    const inceptionTxn = new Transaction({
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
    inceptionTxn.key = a;
    await sendTransaction(a, inceptionTxn);
    setSent(true);
    setInceptionTxn(inceptionTxn);
  };

  // Dummy handler to generate new HD wallet details.
  const handleGenerateHDWallet = async () => {
    // In a real implementation, you'd generate a new mnemonic and create the HD wallet.
    // For demonstration, we simply set dummy values.
    const newMnemonic = generateMnemonic();
    setGeneratedMnemonic(newMnemonic);
    const { wallet, mfa, log } = await initWalletFromMnemonic(newMnemonic);
    setLog(log);
    setWallet(wallet);
  };

  const handleSeedImport = async () => {
    setGeneratedMnemonic(mnemonic);
    const { wallet, mfa, log } = await initWalletFromMnemonic(mnemonic);
    setSeedPhraseDownloaded(true);
    setHasKel(res.data.status);
    if (res.data.status === true) {
      const mfa = prompt("Enter your wallet password.");

      let a = await deriveSecurePath(newWallet, mfa); //0/0 --> //0/0/0
      const pk = Buffer.from(a.publicKey).toString("hex");
      const res = await axios.get(
        `${
          import.meta.env.VITE_API_URL
        }/key-event-log?username_signature=asdf&public_key=${pk}`
      );
      console.log(res.data);
      for (let i = 1; i < res.data.key_event_log.length; i++) {
        a = await deriveSecurePath(a, mfa); //0/0 --> //0/0/0
        res.data.key_event_log[i].key = a;
      }
      res.data.key_event_log[0].status = "onchain";
      setInceptionTxn(res.data.key_event_log[0]);

      setWallet(a);
      const b = await deriveSecurePath(a, mfa); //0/0/0 --> //0/0/0/0
      setAddress(
        getP2PKH(
          b.publicKey //0/0/0
        )
      );
      setWallet(b);
      setKelInitialized(true);
    }
  };

  return (
    <Container size="sm" style={{ marginTop: "2rem" }}>
      <Title order={2} align="center" mb="md">
        Convert WIF Wallet to HD Wallet
      </Title>

      {/* Current WIF Wallet Details */}
      <Paper shadow="xs" padding="md" mb="md">
        <Title order={4} mb="xs">
          Current WIF Wallet
        </Title>
        <TextInput
          label="WIF Key"
          placeholder="Enter your WIF key"
          value={wif}
          onChange={(e) => setWif(e.currentTarget.value)}
          mb="sm"
        />
        <Text>
          <strong>Address:</strong>{" "}
          <a
            href={`${import.meta.env.VITE_API_URL}/explorer?term=${wifAddress}`}
            target="_blank"
          >
            {wifAddress}
          </a>
        </Text>
        {wifBalance && (
          <>
            <Text mt="sm">
              <strong>Balance:</strong> {wifBalance.balance} YDA
            </Text>
            {wifBalance.unspent_transactions.length > 100 && (
              <Alert>
                Too many inputs. Wallet needs to be consolidated. Please do this
                in the old wallet.
              </Alert>
            )}
          </>
        )}
      </Paper>

      {/* New HD Wallet Generation */}
      <Paper shadow="xs" padding="md" mb="md">
        <Title order={4} mb="xs">
          New HD Wallet
        </Title>
        {!wallet && (
          <Group position="apart" mb="sm">
            <Button onClick={handleGenerateHDWallet}>
              Generate New HD Wallet
            </Button>
          </Group>
        )}
        <Title order={4} mb="xs">
          Existing HD Wallet
        </Title>
        {!wallet && (
          <Group position="apart" mb="sm">
            <input
              type="text"
              value={mnemonic}
              onChange={(e) => {
                setMnemonic(e.currentTarget.value);
              }}
            />
            <Button onClick={handleSeedImport}>Import HD Wallet Seed</Button>
          </Group>
        )}
        {wallet && (
          <>
            <Text mt="sm">
              <strong>Seed Phrase:</strong> {generatedMnemonic}
            </Text>
            {!seedPhraseDownloaded && (
              <>
                <Button color="blue" onClick={downloadSeed}>
                  Download Seed Phrase
                </Button>
                <Text>(You must download the seed to continue)</Text>
              </>
            )}
            <Text mt="sm">
              <strong>Address: </strong>
              <a
                href={`${
                  import.meta.env.VITE_API_URL
                }/explorer?term=${address}`}
                target="_blank"
              >
                {address}
              </a>
            </Text>
            <Text mt="sm">
              <strong>Balance:</strong> {balance} YDA
            </Text>
            {sent && (
              <>
                <Text fw="bold" mt="xl">
                  YEL status:{" "}
                  {inceptionTxn.status !== "onchain"
                    ? "Yada Event Log initialization is pending."
                    : "Yada Event Log initialization is complete."}
                </Text>{" "}
                {inceptionTxn.status !== "onchain" && (
                  <>
                    <Progress value={progress} size="xl" />
                    <Text mt="xs" align="center">
                      {(timeLeft / 60).toFixed(0)} minutes left (20 minute avg.
                      processing time)
                    </Text>
                  </>
                )}
              </>
            )}
          </>
        )}
      </Paper>

      {/* Warning Alert */}

      {/* Conversion Action */}
      {kelInitialized && (
        <Group
          position="center"
          style={{ deplay: "flex", flexDirection: "column" }}
        >
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Important"
            color="red"
            mb="md"
          >
            Converting your wallet will send your entire WIF wallet balance to
            your new HD wallet.
            <br />
            <br />
            Make sure to securely store your new seed phrase. If you lose your
            seed phrase, your new HD wallet will not be recoverable.
          </Alert>
          {!pendingTxn && parseFloat(balance.balance) === 0 && (
            <Button
              disabled={
                !wallet ||
                !wifWallet ||
                !inceptionTxn ||
                inceptionTxn.status !== "onchain" ||
                !seedPhraseDownloaded
              }
              onClick={handleSendOneYda}
              color="blue"
            >
              Test: Send 1 YDA from WIF wallet to HD wallet
            </Button>
          )}
          {pendingTxn.status === "onchain" ||
            (parseFloat(balance) > 0 && (
              <Button
                disabled={
                  !wallet ||
                  !wifWallet ||
                  parseFloat(balance) === 0 ||
                  !seedPhraseDownloaded
                }
                onClick={handleSendEntireBalance}
                color="red"
              >
                Send entire WIF wallet balance to HD wallet
              </Button>
            ))}
          {pendingTxn && (
            <>
              <Text fw="bold" mt="xl">
                {wifBalance.balance > 0
                  ? "Test deposit status: "
                  : "Balance transfer status: "}
                {pendingTxn.status !== "onchain" ? "Pending." : "Complete."}
              </Text>{" "}
              {pendingTxn.status !== "onchain" && (
                <>
                  <Progress value={progress} size="xl" />
                  <Text mt="xs" align="center">
                    {(timeLeft / 60).toFixed(0)} minutes left (20 minute avg.
                    processing time)
                  </Text>
                </>
              )}
            </>
          )}
        </Group>
      )}
    </Container>
  );
};

export default WifToHdConversion;
