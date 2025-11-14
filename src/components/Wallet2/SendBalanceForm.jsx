import { useState, useRef } from "react";
import {
  Button,
  TextInput,
  Group,
  Text,
  Card,
  Select,
  Title,
  Switch,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAppContext } from "../../context/AppContext";
import { decompressPublicKey, fromWIF } from "../../utils/hdWallet";
import { ethers, keccak256 } from "ethers";
import QRScannerModal from "./QRScannerModal";
import { capture } from "../../shared/capture";
import { styles } from "../../shared/styles";
import {
  localProvider,
  ERC20_ABI,
  WRAPPED_TOKEN_ABI,
  LP_ADDRESS,
  addresses,
  USDT_ADDRESS,
  PANCAKESWAP_V2_FACTORY,
  INIT_CODE_HASH,
} from "../../shared/constants";
import { walletManagerFactory } from "../../blockchains/WalletManagerFactory";

const factory = new ethers.Contract(
  "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
  [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  ],
  localProvider
);

const getLpTokenAddress = async (tokenA, tokenB) => {
  const pair = await factory.getPair(tokenA, tokenB);
  console.log("LP Address:", pair);
  return pair;
};

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
    selectedToken,
    sendWrapped,
    useLpToken,
    setUseLpToken,
  } = appContext; // Call useAppContext at the top level
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const [scannedWallet, setScannedWallet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [wif, setWif] = useState("");

  const walletManager = walletManagerFactory(selectedBlockchain.id);
  // Get token symbol for display
  const getTokenSymbol = (tokenAddress) => {
    if (tokenAddress === LP_ADDRESS) return "WYDA-USDT LP Token";
    if (tokenAddress === ethers.ZeroAddress) return "BNB";
    const token = supportedTokens.find(
      (t) => t.address.toLowerCase() === tokenAddress.toLowerCase()
    );
    return sendWrapped ? "Y" : "" + token ? token.symbol : "Unknown";
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

      const lpTokenAddress = await getLpTokenAddress(
        addresses.yadaERC20Address,
        USDT_ADDRESS
      );
      let finalTokenAddress = selectedToken;
      if (useLpToken) {
        finalTokenAddress = lpTokenAddress;
      } else {
        const pair = tokenPairs.find((t) => t.original === selectedToken);
        if (tokenPairs.length > 0 && sendWrapped && pair) {
          finalTokenAddress = pair.wrapped;
        }
      }

      setWif(wifString);
      setScannedWallet(signer);
      await fetchBalance(signer, finalTokenAddress);

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
    if (!scannedWallet || !balance || parseFloat(balance.value) <= 0) {
      notifications.show({
        title: "Error",
        message:
          "Please scan a valid QR code, select a token, and provide a valid recipient address with sufficient balance",
        color: "red",
      });
      return;
    }

    const lpTokenAddress = await getLpTokenAddress(
      addresses.yadaERC20Address,
      USDT_ADDRESS
    );
    let finalTokenAddress = selectedToken;
    if (useLpToken) {
      finalTokenAddress = lpTokenAddress;
    } else {
      const pair = tokenPairs.find((t) => t.original === selectedToken);
      if (tokenPairs.length > 0 && sendWrapped && pair) {
        finalTokenAddress = pair.wrapped;
      }
    }
    try {
      setIsLoading(true);

      // Execute the transaction using the bridge contract
      const result = await walletManager.transferBalanceToLatestKey(
        appContext,
        scannedWallet
      );

      if (result.status) {
        notifications.show({
          title: "Success",
          message: `Successfully sent ${balance.symbol}`,
          color: "green",
        });
      } else {
        throw new Error(result.message || "Failed to send token balance");
      }

      const signer = new ethers.Wallet(
        ethers.hexlify(privateKey.privateKey),
        localProvider
      );
      // Refresh balance after transaction
      await fetchBalance(signer, finalTokenAddress);
    } catch (error) {
      console.error(
        `Error sending ${getTokenSymbol(finalTokenAddress)} balance:`,
        error
      );
      notifications.show({
        title: "Error",
        message:
          error.message ||
          `Failed to send ${getTokenSymbol(finalTokenAddress)} balance`,
        color: "red",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card
      mt="md"
      shadow="sm"
      padding="lg"
      radius="md"
      withBorder
      styles={styles.card}
    >
      <Title order={4} mb="md">
        Send Balance from QR Code
      </Title>
      <Group direction="column" spacing="md">
        <Button
          onClick={handleScanQR}
          disabled={isLoading}
          styles={styles.button}
        >
          Scan QR Code
        </Button>

        {selectedBlockchain.isBridge && (
          <Switch
            label="Send WYDA-USDT LP Token"
            checked={useLpToken}
            onChange={(e) => setUseLpToken(e.currentTarget.checked)}
            mt="md"
            styles={styles.switch}
          />
        )}
        {scannedWallet && balance && (
          <Text>
            Wallet Address: {scannedWallet.address} <br />
            Balance: {balance.value} {balance.symbol}
          </Text>
        )}
        <Button
          onClick={handleSendBalance}
          disabled={
            isLoading ||
            !scannedWallet ||
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
