import {
  Card,
  Pagination,
  Table,
  Text,
  Title,
  Button,
  Group,
  Select,
  Flex,
  Loader,
} from "@mantine/core";
import { useState, useEffect, useMemo } from "react";
import { ethers } from "ethers";
import { useAppContext } from "../../context/AppContext";
import { BLOCKCHAINS } from "../../shared/constants";
import { IconDownload } from "@tabler/icons-react";

const TransactionHistory = ({
  combinedHistory,
  currentPage,
  totalPages,
  onPageChange,
  styles,
  selectedBlockchain,
  // Add this prop to get ALL history (not just paginated)
  allHistory = combinedHistory, // fallback to current if not provided
}) => {
  const { selectedToken, supportedTokens } = useAppContext();
  const [rowsPerPage, setRowsPerPage] = useState("3");
  const [tokenTransfers, setTokenTransfers] = useState({});
  const [transfersLoading, setTransfersLoading] = useState(false);
  const rowsPerPageNum = parseInt(rowsPerPage, 10);
  const calculatedTotalPages = Math.ceil(allHistory.length / rowsPerPageNum);
  const startIdx = (currentPage - 1) * rowsPerPageNum;
  const endIdx = startIdx + rowsPerPageNum;
  const paginatedHistory = useMemo(
    () => allHistory.slice(startIdx, endIdx),
    [allHistory, startIdx, endIdx]
  );
  const pageKey = useMemo(
    () => paginatedHistory.map((item) => item.id).join(","),
    [paginatedHistory]
  );

  let tokenSymbol;
  if (selectedBlockchain.isBridge) {
    const found = supportedTokens.find(
      (t) => t.address?.toLowerCase() === selectedToken?.toLowerCase()
    );
    tokenSymbol = found?.symbol ?? selectedToken?.slice(0, 6) ?? "Token";
  } else {
    tokenSymbol = selectedBlockchain.id.toUpperCase();
  }

  useEffect(() => {
    if (!selectedBlockchain?.chainId) return;
    const apiKey = import.meta.env.VITE_BSCSCAN_API_KEY;
    if (!apiKey) return;

    const isNative =
      !selectedToken ||
      selectedToken === ethers.ZeroAddress ||
      selectedToken === "0x0000000000000000000000000000000000000000";

    const chainId = selectedBlockchain.chainId;
    const action = isNative ? "txlist" : "tokentx";

    // Dedupe by address — fetch once per unique address visible on this page
    const addressSet = new Set(
      paginatedHistory
        .map((item) => item.address || item.public_key_hash)
        .filter(Boolean)
    );

    if (addressSet.size === 0) return;

    setTransfersLoading(true);

    const fetchAll = async () => {
      const updates = {};

      await Promise.all(
        [...addressSet].map(async (address) => {
          try {
            let url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=${action}&address=${address}&sort=asc&apikey=${apiKey}`;
            if (!isNative) {
              url += `&contractaddress=${selectedToken}`;
            }
            const res = await fetch(url);
            const data = await res.json();
            const txList = Array.isArray(data?.result) ? data.result : [];

            for (const tx of txList) {
              const hash = tx.hash?.toLowerCase();
              if (!hash) continue;
              const isReceived = tx.to?.toLowerCase() === address.toLowerCase();
              const rawValue = tx.value ?? "0";
              let formatted;
              try {
                formatted = isNative
                  ? ethers.formatEther(BigInt(rawValue))
                  : ethers.formatUnits(
                      BigInt(rawValue),
                      parseInt(tx.tokenDecimal ?? "18", 10)
                    );
              } catch {
                formatted = "0";
              }
              // Key by address so all rows for that address share the same lookup
              updates[address.toLowerCase()] = {
                value: formatted,
                isReceived,
                symbol: isNative ? tokenSymbol : tx.tokenSymbol || tokenSymbol,
              };
            }
          } catch (e) {
            console.warn(`Error fetching transfers for ${address}:`, e);
          }
        })
      );

      setTokenTransfers((prev) => ({ ...prev, ...updates }));
      setTransfersLoading(false);
    };

    fetchAll();
  }, [pageKey, selectedToken, selectedBlockchain?.chainId]);

  // Function to convert data to CSV and trigger download
  const downloadCSV = () => {
    if (allHistory.length === 0) return;

    const headers = [
      "Type",
      "Rotation",
      "Public Key Hash",
      "TxID",
      "Date",
      "To Address",
      "Amount",
      "Token",
      "Status",
      "Total Received",
      "Total Sent",
    ];

    const rows = allHistory
      .map((item) => {
        const base = [
          item.type || "",
          item.rotation ?? "",
          item.public_key_hash || "N/A",
          item.id || "",
          item.date || "",
        ];

        // Handle multiple outputs
        if (item.outputs && item.outputs.length > 0) {
          return item.outputs.map((output) => [
            ...base,
            output.to || "",
            output.value || "",
            tokenSymbol,
            item.status || (item.mempool ? "Pending" : "Confirmed"),
            item.totalReceived || "",
            item.totalSent || "",
          ]);
        } else {
          return [
            ...base,
            "", // To
            "", // Amount
            tokenSymbol,
            item.status || (item.mempool ? "Pending" : "Confirmed"),
            item.totalReceived || "",
            item.totalSent || "",
          ];
        }
      })
      .flat();

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map((cell) => `"${(cell || "").toString().replace(/"/g, '""')}"`)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `wallet-history-${new Date().toISOString().slice(0, 10)}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Card shadow="xs" padding="md" mt="lg" styles={styles.nestedCard}>
      <Title order={3} mb="md">
        Wallet History
      </Title>

      <div style={{ overflowX: "auto" }}>
        <Table striped highlightOnHover styles={styles.table}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={styles.tableHeader}>Type</Table.Th>
              <Table.Th style={styles.tableHeader}>Rotation</Table.Th>
              <Table.Th style={styles.tableHeader}>Public Key Hash</Table.Th>
              <Table.Th style={styles.tableHeader}>
                To / Amount / Details
              </Table.Th>
              <Table.Th style={styles.tableHeader}>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {paginatedHistory.map((item, index) => (
              <Table.Tr
                key={`${item.type}-${item.public_key_hash || index}-${
                  item.id || index
                }`}
              >
                <Table.Td>{item.type}</Table.Td>
                <Table.Td>{item.rotation}</Table.Td>
                <Table.Td>{item.public_key_hash || "N/A"}</Table.Td>
                <Table.Td>
                  <>
                    <Text>
                      <a
                        href={`${import.meta.env.VITE_API_URL}/explorer?term=${
                          item.id
                        }`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        TxID: {item.id?.slice(0, 8)}...
                      </a>
                    </Text>
                    {(() => {
                      const addrKey = (
                        item.address || item.public_key_hash
                      )?.toLowerCase();
                      const live = addrKey ? tokenTransfers[addrKey] : null;
                      if (live) {
                        return (
                          <Text c={live.isReceived ? "green" : "red"} fw={500}>
                            {live.isReceived ? "+" : "-"}
                            {live.value} {live.symbol}
                          </Text>
                        );
                      }
                      if (!live && transfersLoading) {
                        return <Loader size="xs" />;
                      }
                      // Fallback: key events or no live data yet
                      if (item.outputs?.length > 0) {
                        return item.outputs.map((output, idx) => {
                          const isSent = item.type?.includes("Sent");
                          const isReceived = item.type?.includes("Received");
                          return (
                            <Text
                              key={idx}
                              c={
                                isSent ? "red" : isReceived ? "green" : "dimmed"
                              }
                              fw={500}
                            >
                              {isSent ? "-" : isReceived ? "+" : ""}
                              {output.value} {tokenSymbol}
                            </Text>
                          );
                        });
                      }
                      return <Text c="dimmed">N/A</Text>;
                    })()}
                    <Text size="sm" c="dimmed">
                      Date: {item.date}
                    </Text>
                    {item.type === "Sent Key Event" && (
                      <>
                        <Text size="sm">
                          Total Received: {item.totalReceived} {tokenSymbol}
                        </Text>
                        <Text size="sm">
                          Total Sent: {item.totalSent} {tokenSymbol}
                        </Text>
                      </>
                    )}
                  </>
                </Table.Td>
                <Table.Td>
                  {item.status ||
                    (item.mempool ? "Pending" : "Confirmed on blockchain")}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>

      {/* Pagination + Download Button */}
      <Group justify="space-between" mt="md" align="center">
        <Flex align="center" gap="md">
          <Pagination
            total={calculatedTotalPages}
            value={currentPage}
            onChange={onPageChange}
            color="teal"
          />
          <Select
            placeholder="Rows per page"
            data={["3", "10", "20", "50"]}
            value={rowsPerPage}
            onChange={(value) => {
              setRowsPerPage(value || "3");
              onPageChange(1); // Reset to first page when changing rows per page
            }}
            w={120}
          />
        </Flex>
        <Button
          leftSection={<IconDownload size={16} />}
          variant="outline"
          color="gray"
          onClick={downloadCSV}
          disabled={allHistory.length === 0}
        >
          Export to CSV
        </Button>
      </Group>
    </Card>
  );
};

export default TransactionHistory;
