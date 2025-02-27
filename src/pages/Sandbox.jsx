import { testDerivation, testEncryptDecrypt } from "../utils/hdWallet";
import { Transaction } from "../utils/transaction";
import KeyEventLog from "../components/keyeventlog";
import { useState } from "react";
import SandboxInstructionsModal from "../components/SandboxInstructionsModal";
import { Switch } from "@mantine/core";

// Sandbox component contains your current HD Wallet UI
function Sandbox() {
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginBottom: "20px",
        }}
      >
        <h1>Yada Event Log Sandbox</h1>
        <Switch
          label="onchain mode"
          value={onchainMode}
          onChange={() => setOnchainMode(() => !onchainMode)}
        />
        <SandboxInstructionsModal />
        <button onClick={handleGenerateTxn}>Generate txn</button>
        <button onClick={testDerivation}>Run test</button>
        <button onClick={testEncryptDecrypt}>Test Encrypt / Decrypt</button>
      </div>
      <div style={{ display: "flex", flexDirection: "row" }}>
        {Object.keys(kels).map((key) => (
          <KeyEventLog
            onchainMode={onchainMode}
            key={key}
            id={key}
            setKels={setKels}
            kels={kels}
            kel={kels[key]}
            other_kel_id={kels[key].other_kel_id}
            hidden={kels[key].hidden}
            defaultWallet={kels[key].default_wallet}
          />
        ))}
      </div>
    </div>
  );
}

export default Sandbox;
