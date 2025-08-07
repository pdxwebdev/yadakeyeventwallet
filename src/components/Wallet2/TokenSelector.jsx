// src/components/TokenSelector.js
import { useEffect } from "react";
import { useAppContext } from "../../context/AppContext";
import { walletManagerFactory } from "../../blockchains/WalletManagerFactory";
import { Button, Group, Text, Select } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import { localProvider } from "../../shared/constants";
import BridgeArtifact from "../../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../../utils/abis/KeyLogRegistry.json";
import MockERC20Artifact from "../../utils/abis/MockERC20.json";
import WrappedTokenArtifact from "../../utils/abis/WrappedToken.json";
import axios from "axios";

const BRIDGE_ABI = BridgeArtifact.abi;
const KEYLOG_REGISTRY_ABI = KeyLogRegistryArtifact.abi;
const ERC20_ABI = MockERC20Artifact.abi;
const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;

const TokenSelector = () => {
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
  } = appContext;

  const walletManager = walletManagerFactory(selectedBlockchain);

  // Fetch supported tokens and add native coin
  useEffect(() => {
    const fetchTokens = async () => {
      try {
        const bridge = new ethers.Contract(
          contractAddresses.bridgeAddress,
          BRIDGE_ABI,
          localProvider
        );
        const tokens = await bridge.getSupportedTokens();
        const tokenData = await Promise.all(
          tokens.map(async (tokenAddress) => {
            let name, symbol;
            if (tokenAddress === "0x0000000000000000000000000000000000000000") {
              name = "Binance Coin"; // Or 'Wrapped ETH' depending on the chain
              symbol = "BNB"; // Or 'WETH'
            } else {
              const tokenContract = new ethers.Contract(
                tokenAddress,
                ERC20_ABI,
                localProvider
              );
              name = await tokenContract.name();
              symbol = await tokenContract.symbol();
            }
            return { address: tokenAddress, name, symbol, value: tokenAddress };
          })
        );
        setSupportedTokens(tokenData || []);
        if (tokenData.length > 0 && !selectedToken) {
          setSelectedToken(tokenData[0].address); // Default to first token (BNB)
        }
      } catch (error) {
        console.error("Error fetching supported tokens:", error);
        setSupportedTokens([
          {
            address: ethers.ZeroAddress,
            name: "Binance Coin",
            symbol: "BNB",
            value: ethers.ZeroAddress,
          },
        ]); // Fallback to only native coin on error
        notifications.show({
          title: "Error",
          message: "Failed to load supported tokens, showing native coin only",
          color: "red",
        });
      }
    };

    if (contractAddresses.bridgeAddress) fetchTokens();
  }, [
    selectedBlockchain,
    setSupportedTokens,
    setSelectedToken,
    contractAddresses,
  ]);

  // Fetch balance when token or private key changes
  useEffect(() => {
    if (selectedToken && privateKey) {
      walletManager.fetchBalance(appContext);
    }
  }, [selectedToken, privateKey]);

  // Guard against undefined supportedTokens
  const tokenOptions = (supportedTokens || []).map((token) => ({
    value: token.address,
    label: `${token.name} (${token.symbol})`,
  }));

  return (
    <Group>
      <Text>Select Token:</Text>
      <Select
        data={tokenOptions}
        value={selectedToken}
        onChange={(value) => {
          setSelectedToken(value);
          setBalance(null); // Reset balance to trigger refresh
        }}
        placeholder={
          supportedTokens?.length > 0 ? "Select a token" : "No tokens available"
        }
        disabled={!supportedTokens || supportedTokens.length === 0}
        style={{ width: 200 }}
      />
    </Group>
  );
};

export default TokenSelector;
