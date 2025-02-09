import { testDerivation, testEncryptDecrypt } from "../utils/hdWallet";
import { Transaction } from "../utils/transaction";
import KeyEventLog from "../components/keyeventlog";
import { useState } from "react";

// Sandbox component contains your current HD Wallet UI
function Sandbox() {
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
      <div style={{ display: "flex", flexDirection: "column", marginBottom: "20px" }}>
        <h1>HD Wallet Example</h1>
        <button onClick={handleGenerateTxn}>Generate txn</button>
        <button onClick={testDerivation}>Run test</button>
        <button onClick={testEncryptDecrypt}>Test Encrypt / Decrypt</button>
      </div>
      <div style={{ display: "flex", flexDirection: "row" }}>
        {Object.keys(kels).map((key) => (
          <KeyEventLog
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