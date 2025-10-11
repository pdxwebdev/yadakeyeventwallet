import { Button, Text, Title } from "@mantine/core";

const WalletHeader = ({ styles, text, selectedBlockchain }) => {
  return (
    <>
      <Title c={selectedBlockchain.color} order={2} style={styles.title}>
        {selectedBlockchain?.name} Wallet
      </Title>
      <Text mb="md">{selectedBlockchain?.hardwareInstruction}</Text>
    </>
  );
};

export default WalletHeader;
