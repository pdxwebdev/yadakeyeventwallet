import { Button, Title } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

const WalletHeader = ({ styles, text }) => (
  <>
    <Title order={2} mb="md" style={styles.title}>
      {text || ""} Wallet
    </Title>
  </>
);

export default WalletHeader;
