import { Card, Text, Button, Group, Tooltip, ActionIcon } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

const WalletBalance = ({
  balance,
  parsedData,
  log,
  onRefresh,
  onCopyAddress,
  onShowQR,
  styles,
  tokenSymbol,
  wrappedTokenSymbol,
}) => {
  return (
    <Card withBorder radius="md" p="md" style={styles.card}>
      <Text size="lg" weight={500}>
        Wallet Balance
      </Text>
      {parsedData && (
        <Text size="sm" color="dimmed">
          Address: {parsedData.publicKeyHash}
        </Text>
      )}
      {balance ? (
        <>
          <Text c="grey" id="unprotected">
            Unprotected Balance:
            {balance.original} {tokenSymbol || "Token"}{" "}
            <Tooltip label="The is the unwrapped/unprotected asset. This asset can be transferred with your private key without additional security checks.">
              <IconInfoCircle size={18} style={{ verticalAlign: "middle" }} />
            </Tooltip>
          </Text>
          {wrappedTokenSymbol && (
            <Text c="green">
              Secured Balance: {balance.wrapped} Y{wrappedTokenSymbol}{" "}
              <Tooltip label="The is the wrapped/secured asset. This asset can NOT be transferred with your private key without additional security checks.">
                <IconInfoCircle size={18} style={{ verticalAlign: "middle" }} />
              </Tooltip>
            </Text>
          )}
        </>
      ) : (
        <Text>No balance available</Text>
      )}
      <Group mt="md">
        <Button onClick={onRefresh}>Refresh Balance</Button>
        <Button onClick={onCopyAddress}>Copy Address</Button>
        <Button onClick={onShowQR}>Show QR</Button>
      </Group>
    </Card>
  );
};

export default WalletBalance;
