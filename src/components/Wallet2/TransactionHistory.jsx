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
import { useState, useEffect, useMemo, useRef } from "react";
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
  const [rowsPerPage, setRowsPerPage] = useState("5");
  const [tokenTransfers, setTokenTransfers] = useState({});
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [refetchKey, setRefetchKey] = useState(0);
  // Stable ref so the fetch effect can check already-loaded addresses without
  // adding tokenTransfers as a dep (which would cause infinite loops).
  const tokenTransfersRef = useRef(tokenTransfers);
  useEffect(() => {
    tokenTransfersRef.current = tokenTransfers;
  }, [tokenTransfers]);

  // Clear in-memory cache whenever token or chain changes so stale entries
  // don't block fetching for the new selection.
  useEffect(() => {
    setTokenTransfers({});
  }, [selectedToken, selectedBlockchain?.chainId]);

  const clearCache = () => {
    const chainId = selectedBlockchain?.chainId;
    const prefix = `token_transfers_${chainId}_`;
    Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix))
      .forEach((k) => localStorage.removeItem(k));
    setTokenTransfers({});
    setRefetchKey((k) => k + 1); // force the fetch effect to re-run
  };
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

    // Dedupe by address — skip addresses already loaded in state or cache
    const alreadyLoaded = tokenTransfersRef.current;
    const addressSet = new Set(
      paginatedHistory
        .map((item) => item.address || item.public_key_hash)
        .filter(Boolean)
        .filter((addr) => !alreadyLoaded[addr.toLowerCase()])
    );

    if (addressSet.size === 0) return;

    setTransfersLoading(true);

    const REQUEST_INTERVAL_MS = 210; // just under 5/sec
    const MAX_RETRIES = 3;

    const fetchAll = async () => {
      const updates = {};
      const addressList = [...addressSet];

      const fetchAddress = async (address) => {
        const cacheKey = `token_transfers_${chainId}_${address.toLowerCase()}_${
          selectedToken ?? "native"
        }`;

        // Check localStorage cache first
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            updates[address.toLowerCase()] = JSON.parse(cached);
            return;
          }
        } catch {
          // ignore malformed cache
        }

        try {
          let url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=${action}&address=${address}&sort=asc&apikey=${apiKey}`;
          if (!isNative) {
            url += `&contractaddress=${selectedToken}`;
          }

          let data;
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const res = await fetch(url);
            data = await res.json();
            const isRateLimit =
              data?.status !== "1" &&
              typeof data?.result === "string" &&
              data.result.toLowerCase().includes("rate limit");
            if (!isRateLimit) break;
            // Back off 1s per attempt before retrying
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }

          // "No transactions found" is a valid empty result — cache it as zero.
          const noTxs =
            data?.status === "0" &&
            typeof data?.result === "string" &&
            data.result.toLowerCase().includes("no transactions");

          // For any other non-success response (bad key, unknown error) skip caching.
          if (data?.status !== "1" && !Array.isArray(data?.result) && !noTxs) {
            console.warn(
              `Etherscan error for ${address}:`,
              data?.message ?? data?.result
            );
            return;
          }

          const txList = Array.isArray(data?.result) ? data.result : [];

          // Prefer the first received transaction; fall back to any tx.
          const addrLower = address.toLowerCase();
          const receivedTx = txList.find(
            (tx) => tx.to?.toLowerCase() === addrLower
          );
          const tx = receivedTx ?? txList[0];

          if (tx) {
            const isReceived = tx.to?.toLowerCase() === addrLower;
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
            updates[addrLower] = {
              value: formatted,
              isReceived,
              symbol: isNative ? tokenSymbol : tx.tokenSymbol || tokenSymbol,
            };
          }

          // Only cache a zero entry when the API confirmed no transactions exist.
          // (data.status === "1" with empty result means genuinely no txs.)
          const entry = updates[addrLower] ?? {
            value: "0",
            isReceived: false,
            symbol: tokenSymbol,
          };
          updates[addrLower] = entry;
          try {
            localStorage.setItem(cacheKey, JSON.stringify(entry));
          } catch {
            // ignore storage quota errors
          }
        } catch (e) {
          console.warn(`Error fetching transfers for ${address}:`, e);
        }
      };

      // Sequential with 210ms gap — stays under etherscan's 5 req/sec hard limit
      for (let i = 0; i < addressList.length; i++) {
        await fetchAddress(addressList[i]);
        if (i + 1 < addressList.length) {
          await new Promise((r) => setTimeout(r, REQUEST_INTERVAL_MS));
        }
      }

      setTokenTransfers((prev) => ({ ...prev, ...updates }));
      setTransfersLoading(false);
    };

    fetchAll();
  }, [pageKey, selectedToken, selectedBlockchain?.chainId, refetchKey]);

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

    const rows = allHistory.map((item) => {
      const addrKey = (item.address || item.public_key_hash)?.toLowerCase();
      const live = addrKey ? tokenTransfers[addrKey] : null;
      const amount = live?.value ?? item.outputs?.[0]?.value ?? "";
      const symbol = live?.symbol ?? tokenSymbol;
      const toAddress = item.outputs?.[0]?.to || "";
      const base = [
        item.type || "",
        item.rotation ?? "",
        item.public_key_hash || "N/A",
        item.id || "",
        item.date || "",
      ];

      return [
        ...base,
        toAddress,
        amount,
        symbol,
        item.status || (item.mempool ? "Pending" : "Confirmed"),
        item.totalReceived || "",
        item.totalSent || "",
      ];
    });

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
                        const isZero = parseFloat(live.value) === 0;
                        return (
                          <Text
                            c={
                              isZero
                                ? "dimmed"
                                : live.isReceived
                                ? "green"
                                : "red"
                            }
                            fw={500}
                          >
                            {isZero ? "" : live.isReceived ? "+" : "-"}
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
            data={["5", "10", "20"]}
            value={rowsPerPage}
            onChange={(value) => {
              setRowsPerPage(value || "5");
              onPageChange(1); // Reset to first page when changing rows per page
            }}
            w={120}
          />
        </Flex>
        <Group gap="xs">
          <Button variant="subtle" color="red" size="xs" onClick={clearCache}>
            Clear Cache
          </Button>
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
      </Group>
    </Card>
  );
};

export default TransactionHistory;
