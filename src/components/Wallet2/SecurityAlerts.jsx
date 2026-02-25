import {
  Card,
  Text,
  Button,
  Group,
  Stack,
  Badge,
  Collapse,
} from "@mantine/core";
import { IconAlertCircle, IconChevronDown } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { ethers } from "ethers";

const SecurityAlerts = ({ parsedData, selectedBlockchain, onRotateKey }) => {
  const [failedTransactions, setFailedTransactions] = useState([]);
  const [isPolling, setIsPolling] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState(null);

  // Function to get revert reason for a failed transaction
  const getRevertReason = async (txHash) => {
    try {
      // Create RPC provider based on network
      const rpcUrl = selectedBlockchain.testnet
        ? "https://data-seed-prebsc-1-s1.binance.org:8545"
        : "https://bsc-dataseed.binance.org/";

      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Get transaction receipt to check if it failed
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return null;

      // If status is 1, transaction succeeded
      if (receipt.status === 1) return null;

      // Get the transaction
      const tx = await provider.getTransaction(txHash);
      if (!tx) return null;

      try {
        // Re-execute the transaction to get the revert reason
        await provider.call(
          {
            to: tx.to,
            from: tx.from,
            data: tx.data,
            value: tx.value,
          },
          receipt.blockNumber
        );
      } catch (error) {
        // Extract revert reason from error
        const errorMessage = error.message || error.toString();

        console.log("Raw error for", txHash, ":", errorMessage);

        // Try multiple extraction methods
        if (errorMessage.includes("revert ")) {
          const reason = errorMessage.split("revert ")[1]?.split("\n")[0];
          if (reason) return reason;
        }

        if (errorMessage.includes("execution reverted: ")) {
          return (
            errorMessage.split("execution reverted: ")[1]?.split("\n")[0] ||
            "Execution reverted"
          );
        }

        if (errorMessage.includes("execution reverted")) {
          return "Execution reverted";
        }

        return errorMessage;
      }

      return null;
    } catch (error) {
      console.error("Error getting revert reason for", txHash, ":", error);
      return null;
    }
  };

  // Function to fetch failed transactions from BSCScan
  const fetchFailedTransactions = async (address) => {
    if (!address || selectedBlockchain.id !== "bsc") return;

    try {
      setIsPolling(true);

      // Determine API URL and chain ID for V2 API (uses etherscan.io even for BSC)
      const apiUrl = "https://api.etherscan.io/v2/api";
      const chainId = selectedBlockchain.testnet ? "97" : "56";

      const apiKey = import.meta.env.VITE_BSCSCAN_API_KEY || "YourApiKeyToken";

      const response = await fetch(
        `${apiUrl}?chainid=${chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`
      );

      const data = await response.json();
      console.log("BSCScan API Response:", data);

      if (!data.result) {
        console.log("No transactions found or error in response");
        return;
      }

      // Filter for failed transactions
      const failed = data.result
        .filter((tx) => {
          // txreceipt_status: "0" = failed, "1" = success
          // isError: "1" = error, "0" = no error
          return tx.txreceipt_status === "0" || tx.isError === "1";
        })
        .slice(0, 5);

      console.log("Failed transactions:", failed);

      if (failed.length === 0) {
        setFailedTransactions([]);
        return;
      }

      // Enrich failed transactions with revert reasons
      const enrichedFailed = await Promise.all(
        failed.map(async (tx) => {
          console.log("Getting revert reason for tx:", tx.hash);
          const revertReason = await getRevertReason(tx.hash);
          return {
            ...tx,
            revertReason: revertReason || "Unknown error",
          };
        })
      );

      console.log("Enriched failed transactions:", enrichedFailed);
      setFailedTransactions(enrichedFailed);
      setLastCheckTime(new Date());
      setDetailsExpanded(false); // Reset expanded state when new data arrives
    } catch (error) {
      console.error("Error fetching failed transactions from BSCScan:", error);
    } finally {
      setIsPolling(false);
    }
  };

  // Poll for failed transactions every 30 seconds
  useEffect(() => {
    if (!parsedData?.publicKeyHash || selectedBlockchain.id !== "bsc") {
      setFailedTransactions([]);
      return;
    }

    // Initial fetch
    fetchFailedTransactions(parsedData.publicKeyHash);

    // Set up interval for polling (every 30 seconds)
    const interval = setInterval(() => {
      fetchFailedTransactions(parsedData.publicKeyHash);
    }, 30000);

    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, [parsedData?.publicKeyHash, selectedBlockchain.id]);

  // Don't render anything if no failed transactions
  if (failedTransactions.length === 0) {
    return null;
  }

  return (
    <>
      <Card
        withBorder
        radius="md"
        p="md"
        mt="md"
        mb="sm"
        style={{
          borderColor: "#e03131",
          backgroundColor: "rgba(224, 49, 49, 0.05)",
          borderLeftWidth: 4,
          borderLeftColor: "#e03131",
        }}
      >
        {/* Summary Section */}
        <Group
          mb="md"
          position="apart"
          style={{ cursor: "pointer" }}
          onClick={() => setDetailsExpanded(!detailsExpanded)}
        >
          <Group spacing="sm" style={{ flex: 1 }}>
            <IconAlertCircle
              size={24}
              style={{ color: "#e03131", flexShrink: 0 }}
            />
            <div style={{ flex: 1 }}>
              <Text size="md" weight={600} style={{ color: "#e03131" }}>
                🛡️ Attacks Prevented
              </Text>
              <Text size="xs" color="dimmed">
                {failedTransactions.length} attack
                {failedTransactions.length > 1 ? "s" : ""} detected and
                prevented •{" "}
                {lastCheckTime
                  ? lastCheckTime.toLocaleTimeString()
                  : "Checking..."}
              </Text>
            </div>
          </Group>
          <Button
            variant="subtle"
            color="red"
            size="xs"
            rightIcon={
              <IconChevronDown
                size={16}
                style={{
                  transform: detailsExpanded
                    ? "rotate(180deg)"
                    : "rotate(0deg)",
                  transition: "transform 200ms ease",
                }}
              />
            }
          >
            {detailsExpanded ? "Hide" : "See"} Details
          </Button>
        </Group>

        {/* Expandable Details Section */}
        <Collapse in={detailsExpanded}>
          <Stack
            spacing="sm"
            style={{
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid rgba(224, 49, 49, 0.2)",
            }}
          >
            {failedTransactions.map((tx, idx) => (
              <div
                key={idx}
                style={{
                  padding: "10px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(224, 49, 49, 0.1)",
                  borderLeft: "2px solid #e03131",
                }}
              >
                <Group spacing="sm" mb="xs">
                  <div style={{ flex: 1 }}>
                    <Text size="sm" weight={500}>
                      {tx.functionName || "Unknown Transaction"}
                    </Text>
                    <Text
                      size="xs"
                      component="a"
                      href={`https://${
                        selectedBlockchain.testnet ? "testnet." : ""
                      }bscscan.com/tx/${tx.hash}`}
                      target="_blank"
                      style={{
                        cursor: "pointer",
                        textDecoration: "underline",
                        color: "#e03131",
                      }}
                    >
                      {tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}
                    </Text>
                  </div>
                  <Badge variant="filled" color="red" size="sm">
                    Blocked
                  </Badge>
                </Group>
                {tx.revertReason && (
                  <div
                    style={{
                      padding: "6px",
                      backgroundColor: "rgba(224, 49, 49, 0.05)",
                      borderRadius: "3px",
                      borderLeft: "2px solid #e03131",
                    }}
                  >
                    <Text
                      size="xs"
                      style={{
                        fontFamily: "monospace",
                        wordBreak: "break-word",
                        color: "#e03131",
                      }}
                    >
                      <strong>Attack Type:</strong> {tx.revertReason}
                    </Text>
                  </div>
                )}
              </div>
            ))}

            <Text size="xs" color="dimmed" style={{ marginTop: "8px" }}>
              View details on{" "}
              <Text
                component="a"
                href={`https://${
                  selectedBlockchain.testnet ? "testnet." : ""
                }bscscan.com/address/${parsedData?.publicKeyHash}`}
                target="_blank"
                style={{ cursor: "pointer", textDecoration: "underline" }}
              >
                BSCScan
              </Text>
            </Text>
          </Stack>
        </Collapse>
      </Card>

      {/* Key Rotation Recommendation - Outside Details */}
      <Card
        withBorder
        radius="md"
        p="md"
        mb="sm"
        style={{
          borderColor: "#e03131",
          backgroundColor: "rgba(224, 49, 49, 0.1)",
          borderLeftWidth: 4,
          borderLeftColor: "#e03131",
        }}
      >
        <Text
          size="sm"
          weight={500}
          style={{ color: "#e03131", marginBottom: "8px" }}
        >
          ⚠️ Recommended Action
        </Text>
        <Text size="xs" style={{ color: "#e03131", marginBottom: "12px" }}>
          Your private key may have been compromised. We strongly recommend
          rotating your key immediately.
        </Text>
        <Button color="red" size="sm" variant="filled" onClick={onRotateKey}>
          Rotate Key
        </Button>
      </Card>
    </>
  );
};

export default SecurityAlerts;
