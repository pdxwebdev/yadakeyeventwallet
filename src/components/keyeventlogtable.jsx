import React from "react";
import { Table, ScrollArea, Card, Title, Text } from "@mantine/core";

const KeyEventLogTable = (props) => {
  const { keyEventLogs } = props;

  return (
    <Card shadow="sm" p="lg" radius="md" withBorder>
      <Title order={3} mb="md">
        Key Event Log Entries
      </Title>
      <ScrollArea>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Twice Pre-Rotated Key Hash</Table.Th>
              <Table.Th>Pre-Rotated Key Hash</Table.Th>
              <Table.Th>Outputs</Table.Th>
              <Table.Th>Public Key Hash</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {keyEventLogs.map((log, index) => (
              <Table.Tr key={index}>
                <Table.Td>{log.twice_prerotated_key_hash}</Table.Td>
                <Table.Td>{log.prerotated_key_hash}</Table.Td>
                <Table.Td>
                  <Table striped highlightOnHover withRowBorders={true}>
                    {log.outputs.map((item) => {
                      return (
                        <Table.Tr>
                          <Table.Td>{item.to}</Table.Td>
                          <Table.Td style={{ textAlign: "left" }}>
                            {item.value}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table>
                </Table.Td>
                <Table.Td>{log.public_key_hash}</Table.Td>
                <Table.Td>{log.mempool ? "mempool" : "on-chain"}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
};

export default KeyEventLogTable;
