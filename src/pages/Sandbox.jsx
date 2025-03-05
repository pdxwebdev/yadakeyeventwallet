import { testDerivation, testEncryptDecrypt } from "../utils/hdWallet";
import { Transaction } from "../utils/transaction";
import KeyEventLog from "../components/keyeventlog";
import { useState } from "react";
import SandboxInstructionsModal from "../components/SandboxInstructionsModal";
import { Button, Switch, Tabs } from "@mantine/core";
import { IconWriting } from "@tabler/icons-react";

// Sandbox component contains your current HD Wallet UI
function Sandbox() {
  const [opened, setOpened] = useState(true);
  const [onchainMode, setOnchainMode] = useState(false);
  const [kels, setKels] = useState({
    "User 1": {
      hidden: false,
      kel: [],
      other_kel_id: "User 2",
    },
    "User 2": {
      hidden: false,
      kel: [],
      other_kel_id: "User 1",
    },
  });

  const handleGenerateTxn = () => {
    console.log(new Transaction());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <h1>Yada Event Log Sandbox</h1>
      <Switch
        mb="xl"
        label="onchain mode"
        value={onchainMode}
        onChange={() => setOnchainMode(() => !onchainMode)}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          marginBottom: "20px",
          gap: 10,
        }}
      >
        <SandboxInstructionsModal
          kels={kels}
          onchainMode={onchainMode}
          opened={opened}
          setOpened={setOpened}
        />
        {/* <Button onClick={handleGenerateTxn}>Generate txn</Button>
        <Button onClick={testDerivation}>Run test</Button>
        <Button onClick={testEncryptDecrypt}>Test Encrypt / Decrypt</Button> */}
      </div>
      <Tabs defaultValue="User 1">
        <Tabs.List>
          {Object.keys(kels).map((key) => {
            return (
              <Tabs.Tab value={key} leftSection={<IconWriting size={12} />}>
                {key}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
        {Object.keys(kels).map((key) => (
          <Tabs.Panel value={key} key={key}>
            <KeyEventLog
              setOpened={setOpened}
              onchainMode={onchainMode}
              id={key}
              setKels={setKels}
              kels={kels}
              kel={kels[key]}
              other_kel_id={kels[key].other_kel_id}
              hidden={kels[key].hidden}
              defaultWallet={kels[key].default_wallet}
            />
          </Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
}

export default Sandbox;
