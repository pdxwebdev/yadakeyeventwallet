import { useState, useRef } from "react";
import { Button, TextInput, Group, Text, Card, Select } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAppContext } from "../../context/AppContext";
import { fromWIF } from "../../utils/hdWallet";
import { ethers } from "ethers";
import QRScannerModal from "./QRScannerModal";
import { capture } from "../../shared/capture";
import { styles } from "../../shared/styles";
import {
  localProvider,
  ERC20_ABI,
  WRAPPED_TOKEN_ABI,
} from "../../shared/constants";
import { walletManagerFactory } from "../../blockchains/WalletManagerFactory";

const SendBalanceForm = ({ appContext, webcamRef }) => {
  const {
    selectedBlockchain,
    contractAddresses,
    supportedTokens,
    tokenPairs,
    setIsTransactionFlow,
    log,
    privateKey,
    parsedData,
    setLog,
    setLoading,
  } = appContext; // Call useAppContext at the top level
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [scannedWallet, setScannedWallet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [wif, setWif] = useState("");
  const [selectedTokenAddress, setSelectedTokenAddress] = useState(
    ethers.ZeroAddress
  ); // Default to BNB

  const walletManager = walletManagerFactory(selectedBlockchain);

  // Get token symbol for display
  const getTokenSymbol = (tokenAddress) => {
    if (tokenAddress === ethers.ZeroAddress) return "BNB";
    const token = supportedTokens.find(
      (t) => t.address.toLowerCase() === tokenAddress.toLowerCase()
    );
    return token ? token.symbol : "Unknown";
  };

  // Create unique options for the Select component
  const tokenOptions = (() => {
    // Create a Set to track unique addresses
    const seenAddresses = new Set();
    const options = [];

    // Add BNB option
    if (!seenAddresses.has(ethers.ZeroAddress)) {
      options.push({ value: ethers.ZeroAddress, label: "BNB" });
      seenAddresses.add(ethers.ZeroAddress);
    }

    // Add supported tokens, skipping duplicates
    supportedTokens.forEach((token) => {
      if (!seenAddresses.has(token.address.toLowerCase())) {
        options.push({
          value: token.address,
          label: token.symbol || "Unknown",
        });
        seenAddresses.add(token.address.toLowerCase());
      }
    });

    return options;
  })();

  // Function to fetch the balance for the selected token
  const fetchBalance = async (signer, tokenAddress) => {
    try {
      setIsLoading(true);
      const address = await signer.getAddress();

      let balance;
      let decimals = 18; // Default for BNB and most tokens
      let symbol = "BNB";

      if (tokenAddress === ethers.ZeroAddress) {
        // Fetch BNB balance
        balance = await localProvider.getBalance(address);
      } else {
        // Fetch ERC20 or Wrapped token balance
        const isWrapped = tokenPairs.some(
          (pair) => pair.wrapped.toLowerCase() === tokenAddress.toLowerCase()
        );
        const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
        const tokenContract = new ethers.Contract(
          tokenAddress,
          abi,
          localProvider
        );
        balance = await tokenContract.balanceOf(address);
        decimals = await tokenContract.decimals();
        symbol = await tokenContract.symbol();
      }

      setBalance({
        value: ethers.formatUnits(balance, decimals),
        decimals,
        symbol,
      });

      notifications.show({
        title: "Success",
        message: `Balance fetched: ${ethers.formatUnits(
          balance,
          decimals
        )} ${symbol}`,
        color: "green",
      });
    } catch (error) {
      console.error(`Error fetching balance for token ${tokenAddress}:`, error);
      notifications.show({
        title: "Error",
        message: `Failed to fetch balance for ${getTokenSymbol(tokenAddress)}`,
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
      await fetchBalance(signer, selectedTokenAddress);

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

  // Function to send the balance of the selected token to the recipient address
  const handleSendBalance = async () => {
    if (
      !scannedWallet ||
      !recipientAddress ||
      !ethers.isAddress(recipientAddress) ||
      !balance ||
      parseFloat(balance.value) <= 0
    ) {
      notifications.show({
        title: "Error",
        message:
          "Please scan a valid QR code, select a token, and provide a valid recipient address with sufficient balance",
        color: "red",
      });
      return;
    }

    try {
      setIsLoading(true);
      const signer = scannedWallet;

      if (selectedTokenAddress === ethers.ZeroAddress) {
        // Send BNB
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

        console.log({
          transactionHash: receipt.transactionHash,
          status: receipt.status,
          to: receipt.to,
          from: receipt.from,
          gasUsed: receipt.gasUsed.toString(),
        });

        notifications.show({
          title: "Success",
          message: `Successfully sent ${ethers.formatEther(
            amountToSend
          )} BNB to ${recipientAddress}`,
          color: "green",
        });
      } else {
        // Send ERC20 or Wrapped token
        const isWrapped = tokenPairs.some(
          (pair) =>
            pair.wrapped.toLowerCase() === selectedTokenAddress.toLowerCase()
        );
        const abi = isWrapped ? WRAPPED_TOKEN_ABI : ERC20_ABI;
        const tokenContract = new ethers.Contract(
          selectedTokenAddress,
          abi,
          signer
        );

        const balanceWei = await tokenContract.balanceOf(signer.address);
        const decimals = await tokenContract.decimals();
        const amountToSend = balanceWei;

        if (amountToSend <= 0) {
          throw new Error(
            `Insufficient balance: ${ethers.formatUnits(
              balanceWei,
              decimals
            )} ${balance.symbol} available`
          );
        }

        // Generate permit for the token transfer
        const permit = await walletManager.generatePermit(
          {
            selectedBlockchain,
            contractAddresses,
            supportedTokens,
            tokenPairs,
          }, // Pass context explicitly
          selectedTokenAddress,
          signer,
          amountToSend,
          [
            {
              recipientAddress: recipientAddress,
              amount: amountToSend,
              wrap: false,
              unwrap: false,
              mint: false,
              burn: false,
            },
          ]
        );

        if (!permit) {
          throw new Error(
            `Permit generation failed for token ${selectedTokenAddress}`
          );
        }

        // Execute the transaction using the bridge contract
        const result = await walletManager.buildAndExecuteTransaction(
          appContext, // Pass context explicitly
          webcamRef,
          selectedTokenAddress,
          [], // No new token pairs
          [selectedTokenAddress.toLowerCase()], // Exclude the selected token from additional permits
          {
            token: ethers.ZeroAddress,
            fee: 0,
            expires: 0,
            signature: "0x",
          }, // Default fee info
          supportedTokens.map((token) => ({ address: token.address })), // Supported tokens
          permit
        );

        if (result.status) {
          notifications.show({
            title: "Success",
            message: `Successfully sent ${ethers.formatUnits(
              amountToSend,
              decimals
            )} ${balance.symbol} to ${recipientAddress}`,
            color: "green",
          });
        } else {
          throw new Error(result.message || "Failed to send token balance");
        }
      }

      // Refresh balance after transaction
      await fetchBalance(signer, selectedTokenAddress);
    } catch (error) {
      console.error(
        `Error sending ${getTokenSymbol(selectedTokenAddress)} balance:`,
        error
      );
      notifications.show({
        title: "Error",
        message:
          error.message ||
          `Failed to send ${getTokenSymbol(selectedTokenAddress)} balance`,
        color: "red",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder styles={styles.card}>
      <Text size="lg" weight={500} mb="md">
        Send Balance from QR Code
      </Text>
      <Group direction="column" spacing="md">
        <Select
          label="Select Token"
          placeholder="Select a token"
          value={selectedTokenAddress}
          onChange={(value) => {
            setSelectedTokenAddress(value);
            if (scannedWallet) {
              fetchBalance(scannedWallet, value); // Refresh balance when token changes
            }
          }}
          data={tokenOptions} // Use deduplicated options
          styles={styles.select}
        />
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
            Balance: {balance.value} {balance.symbol}
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
            parseFloat(balance.value) <= 0
          }
          styles={styles.button}
        >
          Send {balance ? balance.symbol : "Balance"}
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
