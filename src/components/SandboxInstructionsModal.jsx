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
              kels["Wallet"].kel.length > 0 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            First, click the <strong>Intialize wallet</strong> button under the{" "}
            <strong>Wallet</strong> section.
          </List.Item>
          <List.Item
            icon={
              kels["Password Manager"].kel.length > 0 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            Then, click the <strong>Intialize wallet</strong> button under the{" "}
            <strong>Password Manager</strong> section.
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
              kels["Wallet"].kel.length > 1 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            Click <strong>'Request to branch log with Password Manager'</strong>{" "}
            under the <strong>Wallet</strong> section.
          </List.Item>
          {onchainMode && (
            <List.Item>
              <strong>WAIT FOR STATUS TO CHANGE TO ONCHAIN.</strong>
            </List.Item>
          )}
          <List.Item
            icon={
              kels["Password Manager"].kel.length > 1 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            Then, click{" "}
            <strong>'Accept request to branch log with Wallet'</strong> under
            the <strong>Password Manager</strong> section.
          </List.Item>
          {onchainMode && (
            <List.Item>
              Wait for that to change to <strong>Onchain</strong> status as
              well.
            </List.Item>
          )}
          <List.Item>
            You'll notice two new sections:{" "}
            <strong>'Session for Wallet'</strong> and{" "}
            <strong>'Session for Password Manager'</strong>.
          </List.Item>
          <List.Item>
            This is a fork from both key logs and represents a private key
            rotation between these two parties. This can be used for very secure
            communication.
          </List.Item>
          <List.Item
            icon={
              kels["Session for Wallet"] &&
              kels["Session for Wallet"].kel.length > 1 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            Next, under <strong>Session for Wallet</strong>, click{" "}
            <strong>'Send 1 Yada'</strong>.
          </List.Item>
          <List.Item>
            This rotates the Wallet side of the relationship.
          </List.Item>
          <List.Item
            icon={
              kels["Session for Password Manager"] &&
              kels["Session for Password Manager"].kel.length > 1 && (
                <ThemeIcon color="green" size={24} radius="xl">
                  <IconCheck size="1rem" />
                </ThemeIcon>
              )
            }
          >
            Next, under <strong>Session for Password Manager</strong>, click{" "}
            <strong>'Send 1 Yada'</strong>.
          </List.Item>
          <List.Item>
            This rotates the Password Manager side of the relationship.
          </List.Item>
          <List.Item>
            If the contract address were to change between session user 1 and
            session user 2, or the passwords were not correct, there would be an
            error raised and the transaction would be denied. Notice the how the
            values/colors correspond to one another in a diagonal pattern from
            row to row.
          </List.Item>
          <List.Item>
            Also, scroll to the right and notice we are exposing the private
            key, the chain code, password, and the contract address of the
            previous record. This allows the consensus layer to verify that the
            action taken in the unconfirmed event is valid. We do all of this
            without compromising the key log or the current key!
          </List.Item>
        </List>
      </Modal>
    </>
  );
}
