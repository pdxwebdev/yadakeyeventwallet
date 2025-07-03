import { ActionIcon, Card, Flex, Group, Text } from "@mantine/core";
import { IconCopy, IconQrcode, IconRefresh } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

const WalletBalance = ({
  balance,
  parsedData,
  log,
  onRefresh,
  onCopyAddress,
  onShowQR,
  styles,
}) => (
  <Card shadow="xs" padding="md" mb="md" styles={styles.nestedCard}>
    <Flex direction="row" justify="space-between">
      <Group justify="space-between" align="center">
        <div
          onClick={() => balance !== null && balance > 0 && onRefresh()}
          style={{ cursor: "pointer" }}
        >
          <Text fw={500} styles={styles.title}>
            Wallet Balance
          </Text>
          <Text>{balance} YDA</Text>
        </div>
        <ActionIcon
          onClick={onRefresh}
          color="teal"
          variant="outline"
          title="Refresh Balance"
        >
          <IconRefresh size={16} />
        </ActionIcon>
      </Group>
      <Flex direction="column">
        <Text fw={500}>
          Address (Rotation:{" "}
          {parsedData.rotation !== log.length
            ? parsedData.rotation + 1
            : parsedData.rotation}
          )
        </Text>
        <Group spacing="xs" align="center">
          <Text>
            {parsedData.rotation !== log.length
              ? parsedData.address2
              : parsedData.address1}
          </Text>
          <ActionIcon
            onClick={onCopyAddress}
            color="teal"
            variant="outline"
            title="Copy Address"
          >
            <IconCopy size={16} />
          </ActionIcon>
          <ActionIcon
            onClick={onShowQR}
            color="teal"
            variant="outline"
            title="Show QR Code"
          >
            <IconQrcode size={16} />
          </ActionIcon>
        </Group>
      </Flex>
    </Flex>
  </Card>
);

export default WalletBalance;
