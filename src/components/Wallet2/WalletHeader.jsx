import { Button, Title } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

const WalletHeader = ({ styles }) => (
  <>
    <Title order={2} mb="md" style={styles.title}>
      Wallet
    </Title>
  </>
);

export default WalletHeader;
