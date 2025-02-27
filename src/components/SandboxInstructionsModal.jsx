import { useState } from "react";
import { Modal, Button, List, ThemeIcon } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";

export default function SandboxInstructionsModal() {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <Button onClick={() => setOpened(true)}>Open Instructions</Button>

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
        <List
          spacing="sm"
          size="md"
          icon={
            <ThemeIcon color="blue" size={24} radius="xl">
              <IconCheck size="1rem" />
            </ThemeIcon>
          }
        >
          <List.Item>
            First, click the <strong>Rotate Key</strong> button under the{" "}
            <strong>User 1</strong> section.
          </List.Item>
          <List.Item>
            Then, click the <strong>Rotate Key</strong> button under the{" "}
            <strong>User 2</strong> section.
          </List.Item>
          <List.Item>This will initialize both key logs.</List.Item>
          <List.Item>
            You will then see new log entries after pressing these buttons. You
            have just initialized your key event log on the Yada blockchain.
          </List.Item>
          <List.Item>
            Next, wait for the status of each log entry to change from{" "}
            <strong>'Pending'</strong> to <strong>'Onchain'</strong>. This
            indicates that you are ready to move to the next step.
          </List.Item>
          <List.Item>
            Click <strong>'Send Relationship Request'</strong> under the{" "}
            <strong>User 1</strong> section.
          </List.Item>
          <List.Item>
            <strong>WAIT FOR STATUS TO CHANGE TO ONCHAIN.</strong>
          </List.Item>
          <List.Item>
            Then, click <strong>'Accept Relationship Request'</strong> under the{" "}
            <strong>User 2</strong> section.
          </List.Item>
          <List.Item>
            Wait for that to change to <strong>Onchain</strong> status as well.
          </List.Item>
          <List.Item>
            You'll notice two new sections: <strong>'Session User 1'</strong>{" "}
            and <strong>'Session User 2'</strong>.
          </List.Item>
          <List.Item>
            This is a fork from both key logs and represents a private key
            rotation between these two parties. This can be used for very secure
            communication.
          </List.Item>
          <List.Item>
            Next, under <strong>Session User 1</strong>, click{" "}
            <strong>'Send Yada Message'</strong>.
          </List.Item>
          <List.Item>
            This rotates the User 1 side of the relationship.
          </List.Item>
          <List.Item>
            Next, under <strong>Session User 2</strong>, click{" "}
            <strong>'Send Yada Message'</strong>.
          </List.Item>
          <List.Item>
            This rotates the User 2 side of the relationship.
          </List.Item>
          <List.Item>
            The more often the rotation, the more secure. If rotated often
            enough, this can even provide quantum resistance.
          </List.Item>
        </List>
      </Modal>
    </>
  );
}
