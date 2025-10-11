// src/components/TokenSelector.js
import { useEffect } from "react";
import { useAppContext } from "../../context/AppContext";
import { Button, Group, Text, Select, Card, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import { localProvider } from "../../shared/constants";
import BridgeArtifact from "../../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../../utils/abis/KeyLogRegistry.json";
import MockERC20Artifact from "../../utils/abis/MockERC20.json";
import WrappedTokenArtifact from "../../utils/abis/WrappedToken.json";
import axios from "axios";

const TokenSelector = ({ styles }) => {
  const appContext = useAppContext();
  const {
    selectedBlockchain,
    supportedTokens,
    setSupportedTokens,
    selectedToken,
    setSelectedToken,
    setBalance,
    privateKey,
    contractAddresses,
    setContractAddresses,
    blockchainColor,
  } = appContext;

  // Guard against undefined supportedTokens
  const tokenOptions = (supportedTokens || []).map((token) => ({
    value: token.address,
    label: `${token.name} (${token.symbol})`,
  }));

  return (
    <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
      <Title order={4}>Select Token</Title>
      <Select
        mt="md"
        color={blockchainColor}
        data={tokenOptions}
        value={selectedToken}
        onChange={(newValue) => {
          if (newValue !== null) {
            appContext.setSelectedToken(newValue);
          }
        }}
        placeholder={
          supportedTokens?.length > 0 ? "Select a token" : "No tokens available"
        }
        defaultValue={ethers.ZeroAddress}
        disabled={!supportedTokens || supportedTokens.length === 0}
        style={{ width: 400 }}
      />
    </Card>
  );
};

export default TokenSelector;
