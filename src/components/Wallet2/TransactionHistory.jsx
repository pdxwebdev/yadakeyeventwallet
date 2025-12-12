import {
  Card,
  Pagination,
  Table,
  Text,
  Title,
  Button,
  Group,
} from "@mantine/core";
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
  let token;
  if (selectedBlockchain.isBridge) {
    const { selectedToken, supportedTokens } = useAppContext();
    token = supportedTokens.find((entry) => entry.address === selectedToken);
    if (!token) return <></>;
  } else {
    token = { symbol: "YDA" };
  }

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
            token.symbol,
            item.status || (item.mempool ? "Pending" : "Confirmed"),
            item.totalReceived || "",
            item.totalSent || "",
          ]);
        } else {
          return [
            ...base,
            "", // To
            "", // Amount
            token.symbol,
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
            {combinedHistory.map((item, index) => (
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
                    {item.outputs?.length > 0 ? (
                      item.outputs.map((output, idx) => (
                        <Text key={idx}>
                          To: {output.to} / Amount: {output.value}{" "}
                          {token.symbol}
                        </Text>
                      ))
                    ) : (
                      <Text>No outputs available</Text>
                    )}
                    <Text>Date: {item.date}</Text>
                    {item.type === "Sent Key Event" && (
                      <>
                        <Text>
                          Total Received: {item.totalReceived} {token.symbol}
                        </Text>
                        <Text>
                          Total Sent: {item.totalSent} {token.symbol}
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
      <Group justify="space-between" mt="md">
        <Pagination
          total={totalPages}
          value={currentPage}
          onChange={onPageChange}
          color="teal"
        />
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
