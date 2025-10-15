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
  selectedBlockchain,
  sendWrapped,
}) => {
  return (
    <Card mt="md" withBorder radius="md" p="md" style={styles.card}>
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
          {selectedBlockchain.isBridge && (
            <Text size={25} lh={2} c="grey" id="unprotected">
              Unprotected Balance: {balance.original} {tokenSymbol || "Token"}{" "}
              <Tooltip label="The is the unwrapped/unprotected asset. This asset can be transferred with your private key without additional security checks.">
                <IconInfoCircle size={18} style={{ verticalAlign: "middle" }} />
              </Tooltip>
            </Text>
          )}
          {!selectedBlockchain.isBridge && (
            <Text size={25} lh={1} c="grey" id="unprotected">
              Balance: {balance} YDA
            </Text>
          )}
          {selectedBlockchain.isBridge && wrappedTokenSymbol && (
            <Text size={25} lh={1} c={selectedBlockchain.color} fw="bolder">
              Secured Balance: {balance.wrapped} Y{wrappedTokenSymbol}{" "}
              <Tooltip label="The is the wrapped/secured asset. This asset can NOT be transferred with your private key without additional security checks.">
                <IconInfoCircle size={18} style={{ verticalAlign: "middle" }} />
              </Tooltip>
            </Text>
          )}
        </>
      ) : (
        <Text size={25} lh={2} fw="bolder">
          Balance: 0
          {sendWrapped
            ? "Y"
            : "" + selectedBlockchain.isBridge
            ? tokenSymbol
            : "YDA"}
        </Text>
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
