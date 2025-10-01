// src/components/Wallet2/TransactionForm.js
import { Button, TextInput, Group, Text, Slider, Switch } from "@mantine/core";
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
  const {
    selectedToken,
    supportedTokens,
    tokenPairs,
    setSendWrapped,
    sendWrapped,
  } = useAppContext();
  const pair = tokenPairs.find(
    (p) => p.original.toLowerCase() === selectedToken.toLowerCase()
  );
  const token = supportedTokens.find((t) => t.address === selectedToken);
  return (
    <div style={styles.form}>
      <Group mb="sm">
        <Text size="lg" weight={500} mb="md">
          Send Transaction
        </Text>
        <Switch
          label="Send secure"
          checked={sendWrapped}
          onChange={(event) => setSendWrapped(event.currentTarget.checked)}
        />
      </Group>
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
          {sendWrapped ? "Send Y" + token?.symbol : "Send " + token?.symbol}
        </Button>
      </Group>
      {feeEstimate && (
        <Text mt="sm" size="sm">
          Estimated Fee: {feeEstimate.recommended_fee} {sendWrapped ? "Y" : ""}
          BNB
        </Text>
      )}
    </div>
  );
};

export default TransactionForm;
