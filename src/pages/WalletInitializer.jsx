/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

// src/pages/WalletInitializer.jsx
import React, { useEffect, useState } from "react";
import {
  Container,
  Title,
  Paper,
  Text,
  Radio,
  TextInput,
  Button,
  Group,
  PasswordInput,
} from "@mantine/core";
import {
  createHDWallet,
  deriveSecurePath,
  generateMnemonic,
  initWalletFromMnemonic,
} from "../utils/hdWallet";
import { useAppContext } from "../context/AppContext";
import axios from "axios";
import * as bitcoin from "bitcoinjs-lib";
import { useNavigate } from "react-router-dom";
import ECPairFactory from "ecpair";
import * as tinySecp256k1 from "tiny-secp256k1";

const WalletInitializer = () => {
  // Access global wallet state and updater function from our AppContext.
  const {
    wallet,
    setWallet,
    balance,
    setBalance,
    wifWallet,
    setWifWallet,
    wif,
    setWif,
    getWifBalance,
    mfa,
    setMfa,
    setLog,
  } = useAppContext();
  const navigate = useNavigate();

  // Local state for managing the chosen initialization method and input values.
  const [method, setMethod] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");

  // In a real app you’d also validate the WIF and mnemonic phrase input.
  // For demonstration purposes, these examples assume valid input.

  // Function to simulate generating secret location hints based on the generated mnemonic.
  const generateSecretLocationHints = (mnemonic) => {
    // In your production implementation, you might derive location hints using
    // your center identity algorithm and secret locations. Here, we simply return dummy hints.
    return [
      "Hint 1: Under the old oak tree",
      "Hint 2: In your secure safe deposit box",
      "Hint 3: Behind the family portrait",
    ];
  };
  const fromWIF = (wif, hdWallet) => {
    const ECPair = ECPairFactory(tinySecp256k1);
    return ECPair.fromWIF(wif);
  };

  // Called when the user clicks “Initialize Wallet”
  const handleInitialize = async () => {
    if (method === "wif") {
      if (!wif) return alert("Please enter your mnemonic phrase.");
      try {
        setWifWallet(fromWIF(wif));
        return navigate("/wif-to-hd");
      } catch (error) {
        alert("Invalid WIF provided.");
      }
    } else if (method === "mnemonic") {
      if (!mnemonic) return alert("Please enter your mnemonic phrase.");
      try {
        console.log(mnemonic);
        const { wallet, mfa, log } = await initWalletFromMnemonic(mnemonic);
        localStorage.setItem("mnemonic", mnemonic);
        setLog(log);
        return setWallet(wallet);
      } catch (error) {
        alert("Invalid mnemonic phrase provided.");
      }
    } else if (method === "auto") {
      // Generate a new wallet automatically.
      const newMnemonic = generateMnemonic();
      const { wallet, mfa, log } = await initWalletFromMnemonic(newMnemonic);
      setWallet(newWallet);
    } else {
      alert("Please select an initialization method.");
    }
  };

  // Only show the initializer if the wallet is not yet set.
  if (wallet) {
    return (
      <Container size="sm" style={{ marginTop: "2rem" }}>
        <Title order={2} align="center">
          Wallet Already Initialized
        </Title>
        <Text align="center">Your wallet is ready to use.</Text>
      </Container>
    );
  }

  return (
    <Container size="sm" style={{ marginTop: "2rem" }}>
      <Title order={2} align="center">
        Initialize Your Wallet
      </Title>
      <Paper shadow="xs" padding="md" mb="md">
        <Text>
          Choose one of the following options to initialize your wallet:
        </Text>
        <ul>
          <li>
            <strong>Transfer from WIF:</strong> If you already have a Wallet
            Import Format key.
          </li>
          <li>
            <strong>Import via mnemonic Phrase:</strong> If you have an existing
            mnemonic phrase.
          </li>
          <li>
            <strong>Generate Automatically:</strong> Let us generate a new
            wallet for you.
          </li>
          <li>
            <strong>Center Identity (Secret Locations):</strong> Generate a new
            wallet along with secret location hints.
          </li>
        </ul>
        <Text color="red" weight={500} mt="sm">
          Important: If you do not use secret locations, your wallet will be
          unrecoverable if you lose your mnemonic phrase. Secret locations
          provide additional location hints that can help you recover your
          wallet.
        </Text>
      </Paper>

      <Paper shadow="xs" padding="md" mb="md">
        <Text>Select Initialization Method:</Text>
        <Radio.Group value={method} onChange={setMethod} mt="sm">
          <Radio value="wif" label="Transfer from WIF" />
          <Radio value="mnemonic" label="Import using Mnemonic Phrase" />
          <Radio value="auto" label="Generate New Wallet Automatically" />
          <Radio
            value="secretLocations"
            label="Center Identity (Secret Locations)"
          />
        </Radio.Group>

        {method === "wif" && (
          <TextInput
            label="Enter WIF"
            placeholder="Your WIF"
            value={wif}
            onChange={(e) => setWif(e.currentTarget.value)}
            mt="sm"
          />
        )}
        {method === "mnemonic" && (
          <>
            <TextInput
              label="Enter Seed Phrase"
              placeholder="Your mnemonic phrase"
              value={mnemonic}
              onChange={(e) => setMnemonic(e.currentTarget.value)}
              mt="sm"
            />
            <PasswordInput
              label="Enter your password"
              placeholder="Password"
              value={mfa}
              onChange={(e) => setMfa(e.currentTarget.value)}
              mt="sm"
            />
          </>
        )}
      </Paper>

      <Group position="right">
        <Button onClick={handleInitialize}>Initialize Wallet</Button>
      </Group>

      {generatedMnemonic && (
        <Paper shadow="xs" padding="md" mt="md">
          <Text weight={500}>Your Generated Seed Phrase:</Text>
          <Text>{generatedMnemonic}</Text>
          {method === "secretLocations" && (
            <Text size="sm" mt="xs" color="dimmed">
              The secret location hints have been provided. Keep your mnemonic
              phrase and these hints safe to ensure wallet recovery.
            </Text>
          )}
        </Paper>
      )}
    </Container>
  );
};

export default WalletInitializer;
