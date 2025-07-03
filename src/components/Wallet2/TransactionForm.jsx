import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  TextInput,
  Title,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";

const TransactionForm = ({
  recipients,
  onAddRecipient,
  onRemoveRecipient,
  onUpdateRecipient,
  onSendTransaction,
  setFocusedRotation,
  styles,
}) => (
  <>
    <Title order={3} mt="lg" mb="md">
      Send Transaction
    </Title>
    {recipients.map((recipient, index) => (
      <Group key={index} mb="sm" align="flex-end">
        <TextInput
          label="Recipient Address"
          placeholder="Enter address"
          value={recipient.address}
          onChange={(e) => onUpdateRecipient(index, "address", e.target.value)}
          styles={{ input: styles.input, label: styles.inputLabel }}
          style={{ flex: 2 }}
        />
        <NumberInput
          label="Amount (YDA)"
          placeholder="Enter amount"
          value={recipient.amount}
          onChange={(value) => onUpdateRecipient(index, "amount", value)}
          onFocus={() => setFocusedRotation(index)}
          decimalScale={8}
          styles={{ input: styles.input, label: styles.inputLabel }}
          style={{ flex: 1 }}
          min={0}
          step={0.00000001}
        />
        {recipients.length > 1 && (
          <ActionIcon
            color="red"
            onClick={() => onRemoveRecipient(index)}
            variant="outline"
          >
            <IconTrash size={16} />
          </ActionIcon>
        )}
      </Group>
    ))}
    <Group mt="md">
      <Button
        onClick={onAddRecipient}
        color="teal"
        variant="outline"
        styles={styles.button}
      >
        Add Recipient
      </Button>
      <Button onClick={onSendTransaction} color="teal" styles={styles.button}>
        Send Transaction
      </Button>
    </Group>
  </>
);

export default TransactionForm;
