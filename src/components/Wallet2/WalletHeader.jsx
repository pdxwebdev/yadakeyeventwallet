import { Button, Text, Title } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { BLOCKCHAINS } from "../../shared/constants";

const WalletHeader = ({ styles, text, selectedBlockchain }) => {
  const blockchain = BLOCKCHAINS.find((i) => i.id === selectedBlockchain);
  return (
    <>
      <Title order={2} style={styles.title}>
        {blockchain?.name} Wallet
      </Title>
      <Text mb="md">{blockchain?.hardwareInstruction}</Text>
    </>
  );
};

export default WalletHeader;
