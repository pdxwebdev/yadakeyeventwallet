import { Card, Text, Button, Group } from "@mantine/core";

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
          <Text>
            Original Balance: {balance.original} {tokenSymbol || "Token"}
          </Text>
          <Text>
            Wrapped Balance: {balance.wrapped} Y{wrappedTokenSymbol || "WToken"}
          </Text>
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
