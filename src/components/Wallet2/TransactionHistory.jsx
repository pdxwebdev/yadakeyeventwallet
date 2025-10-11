import { Card, Pagination, Table, Text, Title } from "@mantine/core";
import { useAppContext } from "../../context/AppContext";
import { BLOCKCHAINS } from "../../shared/constants";

const TransactionHistory = ({
  combinedHistory,
  currentPage,
  totalPages,
  onPageChange,
  styles,
  selectedBlockchain,
}) => {
  let token;
  if (selectedBlockchain.isBridge) {
    const { selectedToken, supportedTokens } = useAppContext();
    token = supportedTokens.find((entry) => {
      return entry.address === selectedToken;
    });
    if (!token) return <></>;
  } else {
    token = {
      symbol: "YDA",
    };
  }
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
                        TxID: {item.id.slice(0, 8)}...
                      </a>
                    </Text>
                    {item.outputs.length > 0 ? (
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
      <Pagination
        total={totalPages}
        value={currentPage}
        onChange={onPageChange}
        mt="md"
        color="teal"
      />
    </Card>
  );
};

export default TransactionHistory;
