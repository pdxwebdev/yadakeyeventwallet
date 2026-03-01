import {
  Button,
  Group,
  TextInput,
  ActionIcon,
  Stack,
  FileButton,
  Text,
  Divider,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import React from "react";
import { IconTrash, IconUpload } from "@tabler/icons-react";
import AmountInput from "./AmountInput";

const TokenManagementForm = ({
  walletManager,
  appContext,
  webcamRef,
  tokenSymbol,
  wrappedTokenSymbol,
  styles,
}) => {
  const { selectedToken } = appContext;

  const [mintEntries, setMintEntries] = React.useState([
    { id: "1", address: "", amount: "" },
  ]);

  const [burnEntries, setBurnEntries] = React.useState([
    { id: "1", address: "", amount: "" },
  ]);

  // Mint operations
  const addMintEntry = () => {
    setMintEntries([
      ...mintEntries,
      { id: Date.now().toString(), address: "", amount: "" },
    ]);
  };

  const removeMintEntry = (id) => {
    if (mintEntries.length > 1) {
      setMintEntries(mintEntries.filter((e) => e.id !== id));
    }
  };

  const updateMintEntry = (id, field, value) => {
    setMintEntries(
      mintEntries.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const handleMintCsvImport = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);
      const newEntries = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(",");
        if (parts.length < 2) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid line ${i + 1}: expected "address,amount"`,
            color: "red",
          });
          return;
        }

        let address = parts[0].trim().replace(/^["']|["']$/g, "");
        let amount = parts[1].trim().replace(/^["']|["']$/g, "");

        if (!ethers.isAddress(address)) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid address on line ${i + 1}: ${address}`,
            color: "red",
          });
          return;
        }

        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid amount on line ${i + 1}: ${amount}`,
            color: "red",
          });
          return;
        }

        newEntries.push({
          id: Date.now().toString() + i,
          address,
          amount,
        });
      }

      if (newEntries.length === 0) {
        notifications.show({
          title: "CSV Error",
          message: "No valid entries found in CSV",
          color: "red",
        });
        return;
      }

      setMintEntries(newEntries);
      notifications.show({
        title: "Success",
        message: `Imported ${newEntries.length} recipients from CSV`,
        color: "green",
      });
    };

    reader.readAsText(file);
  };

  const handleMint = async () => {
    const validEntries = mintEntries.filter(
      (e) =>
        ethers.isAddress(e.address) &&
        e.amount &&
        !isNaN(parseFloat(e.amount)) &&
        parseFloat(e.amount) > 0
    );

    if (validEntries.length === 0) {
      notifications.show({
        title: "Error",
        message: "At least one valid recipient and amount is required",
        color: "red",
      });
      return;
    }

    try {
      await walletManager.mintTokens(
        appContext,
        webcamRef,
        selectedToken,
        validEntries
      );

      notifications.show({
        title: "Success",
        message: `Successfully minted to ${validEntries.length} recipient(s) in one transaction!`,
        color: "green",
      });

      setMintEntries([{ id: "1", address: "", amount: "" }]);
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

  // Burn operations
  const addBurnEntry = () => {
    setBurnEntries([
      ...burnEntries,
      { id: Date.now().toString(), address: "", amount: "" },
    ]);
  };

  const removeBurnEntry = (id) => {
    if (burnEntries.length > 1) {
      setBurnEntries(burnEntries.filter((e) => e.id !== id));
    }
  };

  const updateBurnEntry = (id, field, value) => {
    setBurnEntries(
      burnEntries.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const handleBurnCsvImport = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);
      const newEntries = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(",");
        if (parts.length < 2) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid line ${i + 1}: expected "address,amount"`,
            color: "red",
          });
          return;
        }

        let address = parts[0].trim().replace(/^["']|["']$/g, "");
        let amount = parts[1].trim().replace(/^["']|["']$/g, "");

        if (!ethers.isAddress(address)) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid address on line ${i + 1}: ${address}`,
            color: "red",
          });
          return;
        }

        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid amount on line ${i + 1}: ${amount}`,
            color: "red",
          });
          return;
        }

        newEntries.push({
          id: Date.now().toString() + i,
          address,
          amount,
        });
      }

      if (newEntries.length === 0) {
        notifications.show({
          title: "CSV Error",
          message: "No valid entries found in CSV",
          color: "red",
        });
        return;
      }

      setBurnEntries(newEntries);
      notifications.show({
        title: "Success",
        message: `Imported ${newEntries.length} accounts from CSV`,
        color: "green",
      });
    };

    reader.readAsText(file);
  };

  const handleBurn = async () => {
    const validEntries = burnEntries.filter(
      (e) =>
        ethers.isAddress(e.address) &&
        e.amount &&
        !isNaN(parseFloat(e.amount)) &&
        parseFloat(e.amount) > 0
    );

    if (validEntries.length === 0) {
      notifications.show({
        title: "Error",
        message: "At least one valid account and amount is required",
        color: "red",
      });
      return;
    }

    try {
      await walletManager.burnTokens(
        appContext,
        webcamRef,
        selectedToken,
        validEntries
      );

      notifications.show({
        title: "Success",
        message: `Successfully burned from ${validEntries.length} account(s) in one transaction!`,
        color: "green",
      });

      setBurnEntries([{ id: "1", address: "", amount: "" }]);
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

  const isMintDisabled =
    !selectedToken ||
    mintEntries.every(
      (e) => !e.address || !e.amount || parseFloat(e.amount || "0") <= 0
    );

  const isBurnDisabled =
    !selectedToken ||
    burnEntries.every(
      (e) => !e.address || !e.amount || parseFloat(e.amount || "0") <= 0
    );

  return (
    <Stack gap="lg">
      {/* Mint Section */}
      <div>
        <Text size="sm" fw={500} mb="md">
          Mint Tokens
        </Text>
        <Stack gap="sm">
          {mintEntries.map((entry, index) => (
            <Group key={entry.id} align="flex-end">
              <TextInput
                label={index === 0 ? "Recipient Address" : ""}
                placeholder="Enter recipient address"
                value={entry.address}
                onChange={(e) =>
                  updateMintEntry(entry.id, "address", e.currentTarget.value)
                }
                error={entry.address !== "" && !ethers.isAddress(entry.address)}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              <AmountInput
                label={index === 0 ? `Amount (${wrappedTokenSymbol})` : ""}
                placeholder="Amount to mint"
                value={entry.amount}
                onChange={(value) =>
                  updateMintEntry(
                    entry.id,
                    "amount",
                    value === undefined ? "" : value.toString()
                  )
                }
                decimalScale={18}
                disabled={!selectedToken}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              {mintEntries.length > 1 && (
                <ActionIcon
                  color="red"
                  variant="subtle"
                  onClick={() => removeMintEntry(entry.id)}
                  mb="sm"
                >
                  <IconTrash size={20} />
                </ActionIcon>
              )}
            </Group>
          ))}

          <Group justify="space-between">
            <Group>
              <Button variant="outline" onClick={addMintEntry}>
                Add Recipient
              </Button>
              <FileButton onChange={handleMintCsvImport} accept=".csv,text/csv">
                {(props) => (
                  <Button
                    {...props}
                    leftSection={<IconUpload size={16} />}
                    variant="outline"
                  >
                    Import CSV
                  </Button>
                )}
              </FileButton>
            </Group>
            <Button onClick={handleMint} disabled={isMintDisabled}>
              Mint Tokens
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            CSV format: address,amount (one per line). Header row optional.
          </Text>
        </Stack>
      </div>

      <Divider />

      {/* Burn Section */}
      <div>
        <Text size="sm" fw={500} mb="md">
          Burn Tokens
        </Text>
        <Stack gap="sm">
          {burnEntries.map((entry, index) => (
            <Group key={entry.id} align="flex-end">
              <TextInput
                label={index === 0 ? "Account Address" : ""}
                placeholder="Enter account address"
                value={entry.address}
                onChange={(e) =>
                  updateBurnEntry(entry.id, "address", e.currentTarget.value)
                }
                error={entry.address !== "" && !ethers.isAddress(entry.address)}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              <AmountInput
                label={index === 0 ? `Amount (${wrappedTokenSymbol})` : ""}
                placeholder="Amount to burn"
                value={entry.amount}
                onChange={(value) =>
                  updateBurnEntry(
                    entry.id,
                    "amount",
                    value === undefined ? "" : value.toString()
                  )
                }
                decimalScale={18}
                disabled={!selectedToken}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              {burnEntries.length > 1 && (
                <ActionIcon
                  color="red"
                  variant="subtle"
                  onClick={() => removeBurnEntry(entry.id)}
                  mb="sm"
                >
                  <IconTrash size={20} />
                </ActionIcon>
              )}
            </Group>
          ))}

          <Group justify="space-between">
            <Group>
              <Button variant="outline" onClick={addBurnEntry}>
                Add Account
              </Button>
              <FileButton onChange={handleBurnCsvImport} accept=".csv,text/csv">
                {(props) => (
                  <Button
                    {...props}
                    leftSection={<IconUpload size={16} />}
                    variant="outline"
                  >
                    Import CSV
                  </Button>
                )}
              </FileButton>
            </Group>
            <Button onClick={handleBurn} disabled={isBurnDisabled} color="red">
              Burn Tokens
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            CSV format: address,amount (one per line). Header row optional.
          </Text>
        </Stack>
      </div>
    </Stack>
  );
};

// Export legacy names for backward compatibility
const MintForm = TokenManagementForm;
const BurnForm = TokenManagementForm;

export { TokenManagementForm, MintForm, BurnForm };
