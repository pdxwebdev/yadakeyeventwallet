import { Button, Loader, Stack, Text } from "@mantine/core";

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
  if (!privateKey) {
    return (
      <>
        <Text mb="md">Please scan a QR code from your hard wallet.</Text>
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
