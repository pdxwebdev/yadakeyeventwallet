// src/pages/AdminPanel.jsx
import { useState } from "react";
import { Button, TextInput, Checkbox, Group, Select } from "@mantine/core";
import { ethers } from "ethers";
import BridgeArtifact from "../utils/abis/Bridge.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";

const BRIDGE_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const localProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/");

function AdminPanel() {
  const [originalToken, setOriginalToken] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [isCrossChain, setIsCrossChain] = useState(false);
  const [mintBurnAddress, setMintBurnAddress] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [burnAmount, setBurnAmount] = useState("");
  const [status, setStatus] = useState("");

  // Assuming WYDA is a known wrapped token
  const WYDA_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"; // Replace with actual WYDA address if different

  const wallet = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // Hardhat default account 0 private key
    localProvider
  );

  const deployWrappedToken = async () => {
    try {
      const factory = new ethers.ContractFactory(
        WrappedTokenArtifact.abi,
        WrappedTokenArtifact.bytecode,
        wallet
      );

      const wrappedTokenContract = await factory.deploy(
        tokenName || `${tokenSymbol} Wrapped Token`,
        tokenSymbol,
        BRIDGE_ADDRESS
      );

      await wrappedTokenContract.waitForDeployment();
      return wrappedTokenContract.target;
    } catch (error) {
      throw new Error(`Failed to deploy wrapped token: ${error.message}`);
    }
  };

  const addTokenPair = async () => {
    try {
      if (!tokenSymbol) {
        setStatus("Please enter a token symbol");
        return;
      }

      setStatus("Deploying wrapped token contract...");
      const wrappedTokenAddress = await deployWrappedToken();

      setStatus("Adding token pair to bridge...");
      const bridge = new ethers.Contract(
        BRIDGE_ADDRESS,
        BridgeArtifact.abi,
        wallet
      );

      const tx = await bridge.addTokenPair(
        originalToken,
        wrappedTokenAddress,
        isCrossChain
      );
      await tx.wait();

      setStatus(
        `Token pair added successfully! Wrapped Token Address: ${wrappedTokenAddress}`
      );
      setOriginalToken("");
      setTokenSymbol("");
      setTokenName("");
      setIsCrossChain(false);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const mintWYDA = async () => {
    try {
      if (!mintBurnAddress || !mintAmount) {
        setStatus("Please enter both address and amount for minting");
        return;
      }

      const bridge = new ethers.Contract(
        BRIDGE_ADDRESS,
        BridgeArtifact.abi,
        wallet
      );

      const amount = ethers.parseEther(mintAmount);
      const tx = await bridge.mintWrappedToken(
        WYDA_ADDRESS,
        mintBurnAddress,
        amount
      );
      await tx.wait();

      setStatus(`Successfully minted ${mintAmount} WYDA to ${mintBurnAddress}`);
      setMintAmount("");
      setMintBurnAddress("");
    } catch (error) {
      setStatus(`Mint error: ${error.message}`);
    }
  };

  const burnWYDA = async () => {
    try {
      if (!mintBurnAddress || !burnAmount) {
        setStatus("Please enter both address and amount for burning");
        return;
      }

      const wrappedToken = new ethers.Contract(
        WYDA_ADDRESS,
        WrappedTokenArtifact.abi,
        wallet
      );

      const amount = ethers.parseEther(burnAmount);
      const tx = await wrappedToken.burn(mintBurnAddress, amount);
      await tx.wait();

      setStatus(
        `Successfully burned ${burnAmount} WYDA from ${mintBurnAddress}`
      );
      setBurnAmount("");
      setMintBurnAddress("");
    } catch (error) {
      setStatus(`Burn error: ${error.message}`);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Admin Panel</h1>

      <h2>Create Token Pair</h2>
      <Group direction="column" spacing="md">
        <TextInput
          label="Original Token Address"
          value={originalToken}
          onChange={(e) => setOriginalToken(e.target.value)}
          placeholder="0x..."
          required
        />
        <TextInput
          label="Wrapped Token Symbol"
          value={tokenSymbol}
          onChange={(e) => setTokenSymbol(e.target.value)}
          placeholder="e.g., WMOCK"
          required
        />
        <TextInput
          label="Wrapped Token Name (optional)"
          value={tokenName}
          onChange={(e) => setTokenName(e.target.value)}
          placeholder="e.g., Wrapped Mock Token"
        />
        <Checkbox
          label="Is Cross-Chain"
          checked={isCrossChain}
          onChange={(e) => setIsCrossChain(e.target.checked)}
        />
        <Button onClick={addTokenPair}>Create and Add Token Pair</Button>
      </Group>

      <h2>Mint/Burn WYDA</h2>
      <Group direction="column" spacing="md">
        <TextInput
          label="User Address"
          value={mintBurnAddress}
          onChange={(e) => setMintBurnAddress(e.target.value)}
          placeholder="0x..."
          required
        />
        <TextInput
          label="Mint Amount (in WYDA)"
          value={mintAmount}
          onChange={(e) => setMintAmount(e.target.value)}
          placeholder="e.g., 100"
          type="number"
        />
        <Button onClick={mintWYDA}>Mint WYDA</Button>
        <TextInput
          label="Burn Amount (in WYDA)"
          value={burnAmount}
          onChange={(e) => setBurnAmount(e.target.value)}
          placeholder="e.g., 100"
          type="number"
        />
        <Button onClick={burnWYDA}>Burn WYDA</Button>
      </Group>

      {status && <p>{status}</p>}
    </div>
  );
}

export default AdminPanel;
