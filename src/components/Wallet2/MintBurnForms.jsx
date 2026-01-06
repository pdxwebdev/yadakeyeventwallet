import {
  Button,
  Group,
  TextInput,
  ActionIcon,
  Stack,
  FileButton,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import React from "react";
import { IconTrash, IconUpload } from "@tabler/icons-react";
import AmountInput from "./AmountInput";

const MintForm = ({
  walletManager,
  appContext,
  webcamRef,
  tokenSymbol,
  wrappedTokenSymbol,
  styles,
}) => {
  const { selectedToken } = appContext;

  const [entries, setEntries] = React.useState([
    { id: "1", address: "", amount: "" },
  ]);

  const addEntry = () => {
    setEntries([
      ...entries,
      { id: Date.now().toString(), address: "", amount: "" },
    ]);
  };

  const removeEntry = (id) => {
    if (entries.length > 1) {
      setEntries(entries.filter((e) => e.id !== id));
    }
  };

  const updateEntry = (id, field, value) => {
    setEntries(
      entries.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const handleCsvImport = (file) => {
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

      setEntries(newEntries);
      notifications.show({
        title: "Success",
        message: `Imported ${newEntries.length} recipients from CSV`,
        color: "green",
      });
    };

    reader.readAsText(file);
  };

  const handleMint = async () => {
    const validEntries = entries.filter(
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
      // Single bulk call with array of recipients
      await walletManager.mintTokens(
        appContext,
        webcamRef,
        selectedToken, // kept for compatibility, but not used directly anymore
        validEntries
      );

      notifications.show({
        title: "Success",
        message: `Successfully minted to ${validEntries.length} recipient(s) in one transaction!`,
        color: "green",
      });

      // Reset form
      setEntries([{ id: "1", address: "", amount: "" }]);
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

  const isSubmitDisabled =
    !selectedToken ||
    entries.every(
      (e) => !e.address || !e.amount || parseFloat(e.amount || "0") <= 0
    );

  return (
    <Stack mt="md">
      {entries.map((entry, index) => (
        <Group key={entry.id} align="flex-end">
          <TextInput
            label={index === 0 ? "Recipient Address" : ""}
            placeholder="Enter recipient address"
            value={entry.address}
            onChange={(e) =>
              updateEntry(entry.id, "address", e.currentTarget.value)
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
              updateEntry(
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
          {entries.length > 1 && (
            <ActionIcon
              color="red"
              variant="subtle"
              onClick={() => removeEntry(entry.id)}
              mb="sm"
            >
              <IconTrash size={20} />
            </ActionIcon>
          )}
        </Group>
      ))}

      <Group justify="space-between">
        <Group>
          <Button variant="outline" onClick={addEntry}>
            Add Recipient
          </Button>
          <FileButton onChange={handleCsvImport} accept=".csv,text/csv">
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
        <Button onClick={handleMint} disabled={isSubmitDisabled}>
          Mint Tokens
        </Button>
      </Group>

      <Text size="sm" color="dimmed">
        CSV format: address,amount (one per line). Header row optional.
      </Text>
    </Stack>
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
  const { selectedToken } = appContext;

  const [entries, setEntries] = React.useState([
    { id: "1", address: "", amount: "" },
  ]);

  const addEntry = () => {
    setEntries([
      ...entries,
      { id: Date.now().toString(), address: "", amount: "" },
    ]);
  };

  const removeEntry = (id) => {
    if (entries.length > 1) {
      setEntries(entries.filter((e) => e.id !== id));
    }
  };

  const updateEntry = (id, field, value) => {
    setEntries(
      entries.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const handleCsvImport = (file) => {
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

      setEntries(newEntries);
      notifications.show({
        title: "Success",
        message: `Imported ${newEntries.length} accounts from CSV`,
        color: "green",
      });
    };

    reader.readAsText(file);
  };

  const handleBurn = async () => {
    const validEntries = entries.filter(
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
      // Single bulk call with array of accounts to burn from
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

      // Reset form
      setEntries([{ id: "1", address: "", amount: "" }]);
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

  const isSubmitDisabled =
    !selectedToken ||
    entries.every(
      (e) => !e.address || !e.amount || parseFloat(e.amount || "0") <= 0
    );

  return (
    <Stack mt="md">
      {entries.map((entry, index) => (
        <Group key={entry.id} align="flex-end">
          <TextInput
            label={index === 0 ? "Account Address" : ""}
            placeholder="Enter account address"
            value={entry.address}
            onChange={(e) =>
              updateEntry(entry.id, "address", e.currentTarget.value)
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
              updateEntry(
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
          {entries.length > 1 && (
            <ActionIcon
              color="red"
              variant="subtle"
              onClick={() => removeEntry(entry.id)}
              mb="sm"
            >
              <IconTrash size={20} />
            </ActionIcon>
          )}
        </Group>
      ))}

      <Group justify="space-between">
        <Group>
          <Button variant="outline" onClick={addEntry}>
            Add Account
          </Button>
          <FileButton onChange={handleCsvImport} accept=".csv,text/csv">
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
        <Button onClick={handleBurn} disabled={isSubmitDisabled}>
          Burn Tokens
        </Button>
      </Group>

      <Text size="sm" color="dimmed">
        CSV format: address,amount (one per line). Header row optional.
      </Text>
    </Stack>
  );
};

export { MintForm, BurnForm };
