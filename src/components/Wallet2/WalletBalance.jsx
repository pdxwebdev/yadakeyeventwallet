import { ActionIcon, Card, Flex, Group, Text } from "@mantine/core";
import { IconCopy, IconQrcode, IconRefresh } from "@tabler/icons-react";

const WalletBalance = ({
  balance,
  parsedData,
  log,
  onRefresh,
  onCopyAddress,
  onShowQR,
  styles,
}) => (
  <Card shadow="xs" padding="md" mb="md" styles={styles?.nestedCard}>
    <Flex
      direction={{ base: "column", sm: "row" }}
      justify="space-between"
      gap="md"
    >
      <Group align="center">
        <div
          onClick={() => balance !== null && balance > 0 && onRefresh()}
          style={{ cursor: "pointer" }}
        >
          <Text fw={500} styles={styles?.title}>
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
          <IconRefresh />
        </ActionIcon>
      </Group>

      <Flex direction="column" mt={{ base: "md", sm: 0 }}>
        <Text fw={500}>
          Address (Rotation: {log.length > 0 ? log.length : 0})
        </Text>
        <Group spacing="xs" align="center" wrap="wrap">
          <Text style={{ wordBreak: "break-all" }}>
            {log.length > 0 ? log[log.length - 1].prerotated_key_hash : ""}
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
