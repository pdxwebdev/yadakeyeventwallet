import React from "react";
import { Table, ScrollArea, Card, Title } from "@mantine/core";

const KeyEventLogTable = (props) => {
  const { keyEventLogs } = props;

  return (
    <Card shadow="sm" p="lg" radius="md" withBorder>
      <Title order={3} mb="md">
        Key Event Log Entries
      </Title>
      <ScrollArea>
        <Table striped highlightOnHover>
          <thead>
            <tr>
              <th>Twice Pre-Rotated Key Hash</th>
              <th>Pre-Rotated Key Hash</th>
              <th>Public Key Hash</th>
            </tr>
          </thead>
          <tbody>
            {keyEventLogs.map((log, index) => (
              <tr key={index}>
                <td>{log.twice_prerotated_key_hash}</td>
                <td>{log.prerotated_key_hash}</td>
                <td>{log.public_key_hash}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
};

export default KeyEventLogTable;
