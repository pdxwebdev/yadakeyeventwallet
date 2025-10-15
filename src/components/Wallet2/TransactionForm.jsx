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
} from "@mantine/core";
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

  let token;
  if (selectedBlockchain?.isBridge) {
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
    <Card withBorder mt="md" radius="md" p="md" style={styles.form}>
      <Title order={5}>Send Transaction</Title>
      {recipients.map((recipient, index) => (
        <Group key={index} mb="sm" mt="xs">
          <TextInput
            placeholder="Recipient Address"
            value={recipient.address}
            onChange={(e) =>
              onUpdateRecipient(index, "address", e.target.value)
            }
            style={{ flex: 1 }}
          />
          <NumberInput
            placeholder="Amount"
            value={recipient.amount}
            onChange={(value) => onUpdateRecipient(index, "amount", value)}
            style={{ width: 150 }}
            min={0}
            defaultValue={0}
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
    </Card>
  );
};

export default TransactionForm;
