// src/components/Wallet2/TransactionForm.js
import {
  Button,
  TextInput,
  Group,
  Text,
  Slider,
  Switch,
  NumberInput,
  Card,
  Title,
  ActionIcon,
} from "@mantine/core";
import { IconMaximize } from "@tabler/icons-react"; // or any max icon you like
import { useAppContext } from "../../context/AppContext";
import { BLOCKCHAINS } from "../../shared/constants";
import { useState } from "react";
import AmountInput from "./AmountInput";

const TransactionForm = ({
  recipients,
  onAddRecipient,
  onRemoveRecipient,
  onUpdateRecipient,
  onSendTransaction,
  setFocusedRotation,
  styles,
  feeEstimate,
  selectedBlockchain,
  // ── NEW props you'll need to pass from parent
  balance, // string | number  ← user's balance of selected token
  // balanceLoading,      // optional: boolean
}) => {
  const { selectedToken, supportedTokens, setSendWrapped, sendWrapped } =
    useAppContext();

  let token;
  if (selectedBlockchain?.isBridge) {
    token = supportedTokens.find((entry) => entry.address === selectedToken);
    if (!token) return <></>;
  } else {
    token = { symbol: "YDA" };
  }

  // Optional: subtract fee from max amount (recommended for most chains)
  const estimatedFee = feeEstimate?.recommended_fee || 0;
  const maxSpendable =
    sendWrapped && token?.symbol?.startsWith("W")
      ? Number(balance || 0) // adjust logic if wrapped has different fee token
      : Number(balance || 0) - Number(estimatedFee);

  const handleSetMax = (index) => {
    // We usually leave a tiny buffer or use exact spendable amount
    onUpdateRecipient(index, "amount", balance.original);
  };

  return (
    <Card withBorder mt="md" radius="md" p="md" style={styles.form}>
      <Title order={5}>Send Transaction</Title>

      {recipients.map((recipient, index) => {
        const isLast = index === recipients.length - 1;

        return (
          <Group key={index} mb="sm" mt="xs" align="flex-start">
            <TextInput
              placeholder="Recipient Address"
              value={recipient.address}
              onChange={(e) =>
                onUpdateRecipient(index, "address", e.target.value)
              }
              style={{ flex: 1 }}
            />

            <Group spacing={6} align="center" noWrap>
              <AmountInput
                value={recipient.amount}
                onChange={(value) => onUpdateRecipient(index, "amount", value)}
                placeholder="Amount"
                decimalScale={18}
                style={{ width: 180 }}
              />

              {/* ── Max button ── */}
              <ActionIcon
                size="lg"
                variant="light"
                color="blue"
                onClick={() => handleSetMax(index)}
                title="Use maximum available amount"
                // disabled={balanceLoading || !balance || maxSpendable <= 0}
              >
                <IconMaximize size={18} />
              </ActionIcon>
            </Group>

            {recipients.length > 1 && (
              <Button
                color="red"
                variant="outline"
                onClick={() => onRemoveRecipient(index)}
              >
                Remove
              </Button>
            )}
          </Group>
        );
      })}

      <Group mt="md">
        <Button onClick={onAddRecipient} variant="outline">
          Add Recipient
        </Button>
        <Button onClick={onSendTransaction} color="teal">
          {sendWrapped ? "Send Y" + token?.symbol : "Send " + token?.symbol}
        </Button>
      </Group>

      {/* Optional: show available balance for clarity */}
      {balance !== undefined && (
        <Text mt={6} size="xs" color="dimmed">
          Available: {balance.original} {token?.symbol}
        </Text>
      )}
    </Card>
  );
};

export default TransactionForm;
