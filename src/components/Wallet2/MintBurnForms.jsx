import { NumberInput, Button, Group, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import React from "react";

const MintForm = ({
  walletManager,
  appContext,
  webcamRef,
  tokenSymbol,
  wrappedTokenSymbol,
  styles,
}) => {
  const { selectedToken, balance, contractAddresses } = appContext;
  const [mintAmount, setMintAmount] = React.useState("");
  const [recipientAddress, setRecipientAddress] = React.useState("");

  const handleMint = async () => {
    if (!ethers.isAddress(recipientAddress)) {
      notifications.show({
        title: "Error",
        message: "Invalid recipient address",
        color: "red",
      });
      return;
    }
    if (
      !mintAmount ||
      isNaN(parseFloat(mintAmount)) ||
      parseFloat(mintAmount) <= 0
    ) {
      notifications.show({
        title: "Error",
        message: "Invalid mint amount",
        color: "red",
      });
      return;
    }
    try {
      await walletManager.mintTokens(
        appContext,
        webcamRef,
        selectedToken,
        recipientAddress,
        mintAmount
      );
      notifications.show({
        title: "Success",
        message: `Successfully minted ${mintAmount} ${wrappedTokenSymbol} to ${recipientAddress}`,
        color: "green",
      });
      setMintAmount("");
      setRecipientAddress("");
      await walletManager.fetchBalance(appContext);
      await walletManager.buildTransactionHistory(appContext);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to mint tokens",
        color: "red",
      });
    }
  };

  return (
    <Group mt="md" align="flex-end">
      <div style={{ flex: 1 }}>
        <TextInput
          label="Recipient Address"
          value={recipientAddress}
          onChange={(event) => setRecipientAddress(event.currentTarget.value)}
          placeholder="Enter recipient address"
          styles={styles.input}
        />
        <NumberInput
          label={`Mint Amount (${wrappedTokenSymbol})`}
          value={mintAmount}
          onChange={(value) =>
            setMintAmount(value === undefined ? "" : value.toString())
          }
          placeholder="Enter amount to mint"
          min={0}
          step={0.01}
          decimalScale={6}
          allowNegative={false}
          disabled={!selectedToken}
          styles={styles.input}
        />
        <Button
          onClick={handleMint}
          disabled={
            !selectedToken ||
            !recipientAddress ||
            !ethers.isAddress(recipientAddress) ||
            !mintAmount ||
            parseFloat(mintAmount) <= 0
          }
          mt="sm"
        >
          Mint Tokens
        </Button>
      </div>
    </Group>
  );
};

const BurnForm = ({
  walletManager,
  appContext,
  webcamRef,
  tokenSymbol,
  wrappedTokenSymbol,
  styles,
}) => {
  const { selectedToken, balance } = appContext;
  const [burnAmount, setBurnAmount] = React.useState("");
  const [accountAddress, setAccountAddress] = React.useState("");

  const handleBurn = async () => {
    if (!ethers.isAddress(accountAddress)) {
      notifications.show({
        title: "Error",
        message: "Invalid account address",
        color: "red",
      });
      return;
    }
    if (
      !burnAmount ||
      isNaN(parseFloat(burnAmount)) ||
      parseFloat(burnAmount) <= 0
    ) {
      notifications.show({
        title: "Error",
        message: "Invalid burn amount",
        color: "red",
      });
      return;
    }
    try {
      await walletManager.burnTokens(
        appContext,
        webcamRef,
        selectedToken,
        accountAddress,
        burnAmount
      );
      notifications.show({
        title: "Success",
        message: `Successfully burned ${burnAmount} ${wrappedTokenSymbol} from ${accountAddress}`,
        color: "green",
      });
      setBurnAmount("");
      setAccountAddress("");
      await walletManager.fetchBalance(appContext);
      await walletManager.buildTransactionHistory(appContext);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to burn tokens",
        color: "red",
      });
    }
  };

  return (
    <Group mt="md" align="flex-end">
      <div style={{ flex: 1 }}>
        <TextInput
          label="Account Address"
          value={accountAddress}
          onChange={(event) => setAccountAddress(event.currentTarget.value)}
          placeholder="Enter account address to burn from"
          styles={styles.input}
        />
        <NumberInput
          label={`Burn Amount (${wrappedTokenSymbol})`}
          value={burnAmount}
          onChange={(value) =>
            setBurnAmount(value === undefined ? "" : value.toString())
          }
          placeholder="Enter amount to burn"
          min={0}
          step={0.01}
          decimalScale={6}
          allowNegative={false}
          disabled={!selectedToken}
          styles={styles.input}
        />
        <Button
          onClick={handleBurn}
          disabled={
            !selectedToken ||
            !accountAddress ||
            !ethers.isAddress(accountAddress) ||
            !burnAmount ||
            parseFloat(burnAmount) <= 0
          }
          mt="sm"
        >
          Burn Tokens
        </Button>
      </div>
    </Group>
  );
};

export { MintForm, BurnForm };
