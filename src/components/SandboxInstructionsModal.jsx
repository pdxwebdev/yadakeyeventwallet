/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

import { useState } from "react";
import { Modal, Button, List, ThemeIcon } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";

export default function SandboxInstructionsModal(props) {
  const { kels, onchainMode, setOpened, opened } = props;

  return (
    <>
      <Button onClick={() => setOpened(true)} color="cyan">
        Open Tutorial
      </Button>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Key Rotation Sandbox/Simulator Instructions"
        size="lg"
        styles={{
          title: {
            fontSize: "1.5rem",
            fontWeight: "bold",
            color: "#1E40AF", // Custom dark blue
          },
        }}
      >
        <List spacing="sm" size="md" p="xl">
          <List.Item
            icon={
              kels["User 1"].kel.length > 0 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            First, click the <strong>Intialize wallet</strong> button under the{" "}
            <strong>User 1</strong> section.
          </List.Item>
          <List.Item
            icon={
              kels["User 2"].kel.length > 0 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            Then, click the <strong>Intialize wallet</strong> button under the{" "}
            <strong>User 2</strong> section.
          </List.Item>
          <List.Item>This will initialize both key logs.</List.Item>
          <List.Item>
            You will then see new log entries after pressing these buttons. You
            have just initialized your key event log on the Yada blockchain.
          </List.Item>
          {onchainMode && (
            <List.Item>
              Next, wait for the status of each log entry to change from{" "}
              <strong>'Pending'</strong> to <strong>'Onchain'</strong>. This
              indicates that you are ready to move to the next step.
            </List.Item>
          )}
          <List.Item
            icon={
              kels["User 1"].kel.length > 1 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            Click <strong>'Request to branch log with User 2'</strong> under the{" "}
            <strong>User 1</strong> section.
          </List.Item>
          {onchainMode && (
            <List.Item>
              <strong>WAIT FOR STATUS TO CHANGE TO ONCHAIN.</strong>
            </List.Item>
          )}
          <List.Item
            icon={
              kels["User 2"].kel.length > 1 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            Then, click{" "}
            <strong>'Accept request to branch log with User 1'</strong> under
            the <strong>User 2</strong> section.
          </List.Item>
          {onchainMode && (
            <List.Item>
              Wait for that to change to <strong>Onchain</strong> status as
              well.
            </List.Item>
          )}
          <List.Item>
            You'll notice two new sections:{" "}
            <strong>'Session for User 1'</strong> and{" "}
            <strong>'Session for User 2'</strong>.
          </List.Item>
          <List.Item>
            This is a fork from both key logs and represents a private key
            rotation between these two parties. This can be used for very secure
            communication.
          </List.Item>
          <List.Item>
            Next, under <strong>Session for User 1</strong>, click{" "}
            <strong>'Send 1 Yada'</strong>.
          </List.Item>
          <List.Item
            icon={
              kels["Session for User 1"] &&
              kels["Session for User 1"].kel.length > 1 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            This rotates the User 1 side of the relationship.
          </List.Item>
          <List.Item
            icon={
              kels["Session for User 2"] &&
              kels["Session for User 2"].kel.length > 1 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            Next, under <strong>Session for User 2</strong>, click{" "}
            <strong>'Send 1 Yada'</strong>.
          </List.Item>
          <List.Item>
            This rotates the User 2 side of the relationship.
          </List.Item>
          <List.Item>
            If you look in the far right column. There is a property named
            'mfa'. This is an example of a property which is consistent
            throughout the entire workflow (User 1, User 2, Session for User 1,
            Session for User 2) and if it is changed, the key chain will break
            and the blockchcain will reject the transaction.
          </List.Item>
        </List>
      </Modal>
    </>
  );
}
