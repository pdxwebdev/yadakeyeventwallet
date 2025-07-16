import {
  Button,
  Collapse,
  Flex,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import Flasher from "./Flasher";
import { useDisclosure } from "@mantine/hooks";

const WalletStateHandler = ({
  privateKey,
  isSubmitting,
  isInitialized,
  parsedData,
  log,
  onScanKey,
  onReset,
  styles,
}) => {
  const [opened, { toggle }] = useDisclosure(false);
  if (!privateKey) {
    return (
      <>
        <Title order={3} mb="md" fw="bold">
          Please scan a QR code from your hardware wallet.
        </Title>
        <Flex direction="row">
          <Button mb="md" onClick={toggle} variant="subtle" color="blue">
            Need to setup your wallet?
          </Button>
        </Flex>
        <Collapse
          in={opened}
          transitionDuration={100}
          transitionTimingFunction="linear"
        >
          <Text mb="xs" fw="bold">
            Option 1: Use Web Flasher
          </Text>
          <Flasher />
          <Text mt="md" fw="bold">
            Option 2: Build from source
          </Text>
          <Text mb="md">
            <a
              href="https://github.com/pdxwebdev/yada-wallet/blob/master/README.md"
              target="_blank"
            >
              Follow this link for documentation
            </a>
            .
          </Text>
        </Collapse>
        <Button onClick={onScanKey} color="teal" variant="outline" mt="md">
          Scan Key (Rotation: {log.length})
        </Button>
      </>
    );
  }

  if (isSubmitting) {
    return (
      <Stack align="center" spacing="md">
        <Loader color="teal" />
        <Text>Submitting wallet initialization...</Text>
      </Stack>
    );
  }

  if (!isInitialized) {
    return (
      <Stack align="center" spacing="md">
        <Text>
          Current key (rotation {parsedData.rotation}) is not initialized.
          Please scan the correct key (rotation {log.length}) to proceed.
        </Text>
        <Button onClick={onScanKey} color="teal" variant="outline">
          Scan Key (Rotation: {log.length})
        </Button>
      </Stack>
    );
  }

  return null;
};

export default WalletStateHandler;
