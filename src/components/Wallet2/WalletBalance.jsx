import { ActionIcon, Card, Flex, Group, Text } from "@mantine/core";
import { IconCopy, IconQrcode, IconRefresh } from "@tabler/icons-react";
import { useAppContext } from "../../context/AppContext";

const WalletBalance = ({
  balance,
  parsedData,
  log,
  onRefresh,
  onCopyAddress,
  onShowQR,
  styles,
}) => {
  const { selectedToken, supportedTokens } = useAppContext();
  const token = supportedTokens.find((item) => {
    return item.address === selectedToken;
  });
  return (
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
            <Text>
              {balance} {token.symbol}
            </Text>
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
            <Text>
              {parsedData.rotation != log.length
                ? parsedData.prerotatedKeyHash
                : parsedData.publicKeyHash}
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
};
export default WalletBalance;
