// src/components/Wallet2/TransactionForm.js
import { Button, TextInput, Group, Text, Slider, Switch } from "@mantine/core";
import { useAppContext } from "../../context/AppContext";
import { BLOCKCHAINS } from "../../shared/constants";

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
}) => {
  const { selectedToken, supportedTokens, setSendWrapped, sendWrapped } =
    useAppContext();

  const selectedBlockchainObj = BLOCKCHAINS.find(
    (i) => i.id === selectedBlockchain
  );
  let token;
  if (selectedBlockchainObj?.isBridge) {
    const { selectedToken, supportedTokens } = useAppContext();
    token = supportedTokens.find((entry) => {
      return entry.address === selectedToken;
    });
    if (!token) return <></>;
  } else {
    token = {
      symbol: "YDA",
    };
  }
  return (
    <div style={styles.form}>
      <Group mb="sm">
        <Text size="lg" weight={500} mb="md">
          Send Transaction
        </Text>
        {selectedBlockchain.isBridge && (
          <Switch
            label="Send secure"
            checked={sendWrapped}
            onChange={(event) => setSendWrapped(event.currentTarget.checked)}
          />
        )}
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
          {token?.symbol}
        </Text>
      )}
    </div>
  );
};

export default TransactionForm;
