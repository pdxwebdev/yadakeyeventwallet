// src/components/Wallet2/TransactionForm.js
import { Button, TextInput, Group, Text } from "@mantine/core";
import { useAppContext } from "../../context/AppContext";

const TransactionForm = ({
  recipients,
  onAddRecipient,
  onRemoveRecipient,
  onUpdateRecipient,
  onSendTransaction,
  setFocusedRotation,
  styles,
  feeEstimate,
}) => {
  const { selectedToken, supportedTokens } = useAppContext();

  return (
    <div style={styles.form}>
      <Text size="lg" weight={500} mb="md">
        Send Transaction
      </Text>
      {recipients.map((recipient, index) => (
        <Group key={index} mb="sm">
          <TextInput
            placeholder="Recipient Address"
            value={recipient.address}
            onChange={(e) =>
              onUpdateRecipient(index, "address", e.target.value)
            }
            style={{ flex: 1 }}
          />
          <TextInput
            placeholder="Amount"
            value={recipient.amount}
            onChange={(e) => onUpdateRecipient(index, "amount", e.target.value)}
            style={{ width: 150 }}
          />
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
      ))}
      <Group>
        <Button onClick={onAddRecipient} variant="outline">
          Add Recipient
        </Button>
        <Button onClick={onSendTransaction} color="teal">
          Send{" "}
          {selectedToken
            ? supportedTokens.find((t) => t.address === selectedToken)?.symbol
            : "Token"}
        </Button>
      </Group>
      {feeEstimate && (
        <Text mt="sm" size="sm">
          Estimated Fee: {feeEstimate.recommended_fee} BNB
        </Text>
      )}
    </div>
  );
};

export default TransactionForm;
