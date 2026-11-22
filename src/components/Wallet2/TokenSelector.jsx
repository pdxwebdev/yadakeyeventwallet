// src/components/TokenSelector.js
import { useAppContext } from "../../context/AppContext";
import { Group, Select, Card, Title, Switch } from "@mantine/core";
import { tokensForChain } from "../../shared/constants";

const TokenSelector = ({ styles }) => {
  const appContext = useAppContext();
  const {
    selectedBlockchain,
    supportedTokens,
    selectedToken,
    setSelectedToken,
    blockchainColor,
    setSendWrapped,
    sendWrapped,
  } = appContext;

  const tokensByAddress = new Map();
  const addToken = (token) => {
    if (!token?.address) return;
    const key = token.address.toLowerCase();
    if (!tokensByAddress.has(key)) tokensByAddress.set(key, token);
  };
  (supportedTokens || []).forEach(addToken);
  tokensForChain(selectedBlockchain?.id).forEach(addToken);

  const tokenOptions = [...tokensByAddress.values()]
    .filter((token) => token.symbol !== "WBTC")
    .map((token) => ({
      value: token.address,
      label: `${token.name} (${token.symbol})`,
    }));

  return (
    <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
      <Title order={4}>Select Token</Title>
      <Group>
        <Select
          mt="md"
          color={blockchainColor}
          data={tokenOptions}
          value={selectedToken}
          onChange={(newValue) => {
            if (newValue !== null) {
              setSelectedToken(newValue);
            }
          }}
          placeholder={
            tokenOptions.length > 0 ? "Select a token" : "No tokens available"
          }
          disabled={tokenOptions.length === 0}
          style={{ width: 400 }}
        />

        {selectedBlockchain.isBridge && (
          <Switch
            mt="md"
            label="Use Secure Token"
            checked={sendWrapped}
            onChange={(event) => setSendWrapped(event.currentTarget.checked)}
          />
        )}
      </Group>
    </Card>
  );
};

export default TokenSelector;
