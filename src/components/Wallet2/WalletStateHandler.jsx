// src/components/Wallet2/WalletStateHandler.js
import {
  Button,
  Collapse,
  Flex,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import Flasher from "./Flasher";

const WalletStateHandler = ({
  privateKey,
  isSubmitting,
  isInitialized,
  parsedData,
  log,
  onDeployContracts,
  onRotateKey,
  onReset,
  isDeployed,
  styles,
}) => {
  const [opened, { toggle }] = useDisclosure(false);

  if (!privateKey) {
    return (
      <>
        <Title order={3} mb="md" fw="bold">
          {isDeployed
            ? "Please scan a QR code for the active key."
            : "Please deploy contracts to initialize the wallet."}
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
              rel="noopener noreferrer"
            >
              Follow this link for documentation
            </a>
            .
          </Text>
        </Collapse>
        {isDeployed ? (
          <Button onClick={onRotateKey} color="teal" variant="outline" mt="md">
            Scan Key (Rotation: 0)
          </Button>
        ) : (
          <Button
            onClick={onDeployContracts}
            color="blue"
            variant="filled"
            mt="md"
          >
            Deploy Contracts
          </Button>
        )}
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

  if (!isDeployed) {
    return (
      <Stack align="center" spacing="md">
        <Text>
          Contracts are not deployed. Please deploy contracts to proceed.
        </Text>
        <Button onClick={onDeployContracts} color="blue" variant="filled">
          Deploy Contracts
        </Button>
      </Stack>
    );
  }

  if (isInitialized) {
    return (
      log.length !== parsedData.rotation && (
        <Stack align="center" spacing="md">
          {
            <Text>
              Please scan key rotation <strong>{log.length}</strong> to proceed.
            </Text>
          }
          <Button
            onClick={onRotateKey}
            color="teal"
            variant="outline"
            disabled={log.length === parsedData.rotation}
          >
            Scan Key (Rotation: {log.length})
          </Button>
        </Stack>
      )
    );
  }

  return null;
};

export default WalletStateHandler;
