import { useState, useRef } from "react";
import { Button, TextInput, Group, Text, Card } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAppContext } from "../../context/AppContext";
import { fromWIF } from "../../utils/hdWallet";
import { ethers } from "ethers";
import QRScannerModal from "./QRScannerModal";
import { capture } from "../../shared/capture";
import { styles } from "../../shared/styles";
import { localProvider } from "../../shared/constants";

const SendBalanceForm = () => {
  const { selectedBlockchain, contractAddresses } = useAppContext();
  const webcamRef = useRef(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [scannedWallet, setScannedWallet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [wif, setWif] = useState("");

  // Function to fetch the BNB balance for the scanned wallet
  const fetchBalance = async (signer) => {
    try {
      setIsLoading(true);
      const address = await signer.getAddress();
      const balance = await localProvider.getBalance(address);
      setBalance(ethers.formatEther(balance));
      notifications.show({
        title: "Success",
        message: `BNB balance fetched: ${ethers.formatEther(balance)} BNB`,
        color: "green",
      });
    } catch (error) {
      console.error("Error fetching BNB balance:", error);
      notifications.show({
        title: "Error",
        message: "Failed to fetch BNB balance",
        color: "red",
      });
      setBalance(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Function to handle QR code scanning
  const handleScanQR = async () => {
    try {
      setIsScannerOpen(true);
      let qrData;
      let attempts = 0;
      const maxAttempts = 100;

      while (attempts < maxAttempts) {
        try {
          qrData = await capture(webcamRef);
          break;
        } catch (error) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      if (!qrData) {
        throw new Error("No QR code scanned within time limit");
      }

      const [wifString] = qrData.split("|");
      if (!wifString) {
        throw new Error("Invalid QR code: WIF not found");
      }

      // Convert WIF to wallet
      const wallet = fromWIF(wifString);
      const signer = new ethers.Wallet(
        ethers.hexlify(wallet.privateKey),
        localProvider
      );

      setWif(wifString);
      setScannedWallet(signer);
      await fetchBalance(signer);

      notifications.show({
        title: "Success",
        message: "QR code scanned and wallet loaded successfully",
        color: "green",
      });
    } catch (error) {
      console.error("QR scanning error:", error);
      notifications.show({
        title: "Error",
        message: error.message || "Failed to scan QR code",
        color: "red",
      });
    } finally {
      setIsScannerOpen(false);
    }
  };

  // Function to send the BNB balance to the recipient address
  const handleSendBalance = async () => {
    if (
      !scannedWallet ||
      !recipientAddress ||
      !ethers.isAddress(recipientAddress)
    ) {
      notifications.show({
        title: "Error",
        message:
          "Please scan a valid QR code and provide a valid recipient address",
        color: "red",
      });
      return;
    }

    if (!balance || parseFloat(balance) <= 0) {
      notifications.show({
        title: "Error",
        message: "No BNB balance available to send",
        color: "red",
      });
      return;
    }

    try {
      setIsLoading(true);

      const signer = scannedWallet;
      const balanceWei = await localProvider.getBalance(signer.address);
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasLimit = BigInt(21000); // Standard gas limit for a simple transfer
      const gasCost = gasPrice * gasLimit;
      const amountToSend = balanceWei - gasCost;

      if (amountToSend <= 0) {
        throw new Error(
          `Insufficient BNB balance for gas: ${ethers.formatEther(
            balanceWei
          )} BNB available`
        );
      }

      const nonce = await localProvider.getTransactionCount(
        signer.address,
        "pending"
      );
      const tx = await signer.sendTransaction({
        to: recipientAddress,
        value: amountToSend,
        gasLimit,
        gasPrice,
        nonce,
      });

      const receipt = await tx.wait();

      // Log transaction receipt
      console.log({
        transactionHash: receipt.transactionHash,
        status: receipt.status,
        to: receipt.to,
        from: receipt.from,
        gasUsed: receipt.gasUsed.toString(),
      });

      // Refresh balance after transaction
      await fetchBalance(signer);

      notifications.show({
        title: "Success",
        message: `Successfully sent ${ethers.formatEther(
          amountToSend
        )} BNB to ${recipientAddress}`,
        color: "green",
      });
    } catch (error) {
      console.error("Error sending BNB balance:", error);
      notifications.show({
        title: "Error",
        message: error.message || "Failed to send BNB balance",
        color: "red",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder styles={styles.card}>
      <Text size="lg" weight={500} mb="md">
        Send BNB Balance from QR Code
      </Text>
      <Group direction="column" spacing="md">
        <Button
          onClick={handleScanQR}
          disabled={isLoading}
          styles={styles.button}
        >
          Scan QR Code
        </Button>
        {scannedWallet && balance && (
          <Text>
            Wallet Address: {scannedWallet.address} <br />
            BNB Balance: {balance} BNB
          </Text>
        )}
        <TextInput
          label="Recipient Address"
          placeholder="Enter recipient address"
          value={recipientAddress}
          onChange={(event) =>
            setRecipientAddress(event.currentTarget.value.trim())
          }
          disabled={isLoading}
          styles={styles.input}
        />
        <Button
          onClick={handleSendBalance}
          disabled={
            isLoading ||
            !scannedWallet ||
            !recipientAddress ||
            !ethers.isAddress(recipientAddress) ||
            !balance ||
            parseFloat(balance) <= 0
          }
          styles={styles.button}
        >
          Send BNB Balance
        </Button>
      </Group>
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        webcamRef={webcamRef}
        parsedData={null} // Not used in this context
        log={[]} // Not used in this context
        styles={styles}
        isTransactionFlow={false}
        isDeployed={true} // Assuming contracts are deployed
        currentScanIndex={0}
      />
    </Card>
  );
};

export default SendBalanceForm;
