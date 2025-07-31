// components/WalletConnector.js
import React, { useState } from "react";
import { ethers } from "ethers";
import { Button, Select, Group, TextInput } from "@mantine/core";
import { useAppContext } from "../context/AppContext";
import { HARDHAT_MNEMONIC, localProvider } from "../shared/constants";
import { createHDWallet, deriveSecurePath } from "../utils/hdWallet";
import { getKeyState } from "../shared/keystate";
import KeyLogRegistryArtifact from "../utils/abis/KeyLogRegistry.json";

const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;

const WalletConnector = () => {
  const {
    setSigner,
    setAccount,
    setIsOperator,
    setUserKeyState,
    selectedTestAccount,
    setSelectedTestAccount,
  } = useAppContext();
  const [connectionStatus, setConnectionStatus] = useState("");
  const [userPassword, setUserPassword] = useState("defaultPassword"); // Per-user password

  // Initialize user key state
  const initializeUserKeyState = async (signer, address) => {
    try {
      const keyLogRegistry = new ethers.Contract(
        contractAddresses.keyLogRegistryAddress,
        KEYLOG_REGISTRY_ABI,
        signer
      );
      // For MetaMask, use a temporary mnemonic or derive from address (simplified for testing)
      const mnemonic = HARDHAT_MNEMONIC; // In production, prompt user for mnemonic or use secure derivation
      const hdWallet = createHDWallet(mnemonic);
      const initialKey = await deriveSecurePath(
        hdWallet,
        userPassword + selectedTestAccount
      );
      let log;
      try {
        log = await keyLogRegistry.buildFromPublicKey(
          initialKey.uncompressedPublicKey.slice(1)
        );
      } catch (err) {}
      if (!log) {
        const keyState = await getKeyState(
          hdWallet,
          [],
          userPassword + selectedTestAccount
        );
        let nonce = await localProvider.getTransactionCount(
          keyState.currentDerivedKey.signer.address,
          "latest"
        );
        await (
          await keyLogRegistry.registerKeyLog(
            keyState.currentDerivedKey.key.uncompressedPublicKey.slice(1),
            keyState.currentDerivedKey.signer.address,
            keyState.nextDerivedKey.signer.address,
            keyState.nextNextDerivedKey.signer.address,
            ethers.ZeroAddress,
            keyState.nextDerivedKey.signer.address,
            false,
            { nonce: nonce++ }
          )
        ).wait();
        log = await keyLogRegistry.buildFromPublicKey(
          initialKey.uncompressedPublicKey.slice(1)
        );
      }
      const keyState = await getKeyState(
        hdWallet,
        log,
        userPassword + selectedTestAccount
      );

      setUserKeyState((prev) => ({
        ...prev,
        [keyState.currentDerivedKey.signer.address]: { log, keyState },
      }));
      return { log, keyState };
    } catch (error) {
      console.error("Key state init error:", error);
      setConnectionStatus("Failed to initialize key state");
      return null;
    }
  };

  // Connect to MetaMask
  const connectMetaMask = async () => {
    try {
      if (!window.ethereum) {
        setConnectionStatus("MetaMask not detected");
        return;
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setSigner(signer);
      setAccount(address);
      setIsOperator(false);
      await initializeUserKeyState(signer, address);
      setConnectionStatus(`Connected as ${address}`);
    } catch (error) {
      setConnectionStatus(`Connection failed: ${error.message}`);
    }
  };

  // Connect as a test account
  const connectTestAccount = async () => {
    try {
      const hdWallet = ethers.Wallet.fromPhrase(
        HARDHAT_MNEMONIC,
        localProvider
      );
      setIsOperator(selectedTestAccount === "0");
      const { log, keyState } = await initializeUserKeyState(
        hdWallet,
        hdWallet.address
      );
      setAccount(keyState.currentDerivedKey.signer.address);
      setConnectionStatus(
        `Connected test account ${keyState.currentDerivedKey.signer.address}`
      );
    } catch (error) {
      setConnectionStatus(`Test account connection failed: ${error.message}`);
    }
  };

  const testAccountOptions = Array.from({ length: 5 }, (_, i) => ({
    value: i.toString(),
    label: `Test Account ${i}`,
  }));

  return (
    <Group direction="column" spacing="md">
      <h3>Connect Wallet</h3>
      <Button onClick={connectMetaMask}>Connect MetaMask</Button>
      <Select
        label="Select Test Account"
        placeholder="Choose an account"
        data={testAccountOptions}
        value={selectedTestAccount}
        onChange={setSelectedTestAccount}
      />
      <TextInput
        label="Key Derivation Password"
        value={userPassword}
        onChange={(e) => setUserPassword(e.target.value)}
        placeholder="Enter password"
      />
      <Button onClick={connectTestAccount} disabled={!selectedTestAccount}>
        Connect Test Account
      </Button>
      <p>{connectionStatus}</p>
    </Group>
  );
};

export default WalletConnector;
