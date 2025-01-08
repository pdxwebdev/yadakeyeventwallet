import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  testDerivation,
  generateMnemonic,
  createHDWallet,
  importWif,
  getP2PKH,
  generateSignatureWithPrivateKey,
  testEncryptDecrypt,
  encryptMessage,
  serializeToBinary,
  deserializeFromHex,
  decryptMessage,
  deriveSecurePath,
} from "./hdWallet";
import { Transaction } from "./transaction";

export default function KeyEventLog(props) {
  const { hidden, kels, setKels, id, other_kel_id, kel, defaultWallet } = props;
  const [hdWallet, setHdWallet] = useState(null);
  const [mfa, setMfa] = useState([]);
  const [mnemonic, setMnemonic] = useState("");
  const [walletAddress, setWalletAddress] = useState("");

  useEffect(() => {
    setKels((prevKels) => {
      return { ...prevKels, [id]: kel };
    }); // Safely update the kels array in the parent component
  }, [kel, setKels]);

  useEffect(() => {
    if (!hdWallet && hidden && defaultWallet) {
      setHdWallet(defaultWallet);
    }
    if (!hdWallet && !hidden) {
      handleGenerateMnemonic();
    }
  }, [hdWallet]);

  const handleGenerateMnemonic = async () => {
    const newMnemonic = generateMnemonic();
    setMnemonic(newMnemonic);
    const wallet = createHDWallet(newMnemonic);
    setHdWallet(wallet);
  };

  const handleChangeAddress = useCallback(async () => {
    const a = await deriveSecurePath(hdWallet, mfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, mfa); //0/0/0 --> //0/0/0/0
    const txn = new Transaction({
      public_key: Buffer.from(a.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            b.publicKey //0/0/0
          ), // attacker address attempting to steal yada
        },
      ],
    });
    txn.public_key_hash = getP2PKH(a.publicKey);
    kel.kel.push(txn);
    setHdWallet(a);
    console.log(getP2PKH(a.publicKey));

    setKels({ ...kels, [id]: kel });
    console.log(JSON.stringify(kel));
    await sendTransaction(a, txn);
  }, [hdWallet, kel, mfa, id]);

  const handleSendYada = useCallback(async () => {
    if (kel.length <= 0) return alert("No inception event on key event log");
    const a = await deriveSecurePath(hdWallet, mfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, mfa); //0/0/0 --> //0/0/0/0
    const txn = new Transaction({
      public_key: Buffer.from(a.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: "1ArsFNcc5fU3cfSUiNJCu6LhT8CeZgtEcC", // attacker address attempting to steal yada
        },
      ],
    });
    txn.public_key_hash = getP2PKH(a.publicKey);
    await sendTransaction(a, txn);
    kel.kel.push(txn);

    const d = await deriveSecurePath(c, mfa); //0/0/0/0/0
    const e = await deriveSecurePath(d, mfa); //0/0/0/0/0/0
    const f = await deriveSecurePath(e, mfa); //0/0/0/0/0/0/0
    const ke = new Transaction({
      public_key: Buffer.from(d.publicKey).toString("hex"), // NOT rotated
      twice_prerotated_key_hash: getP2PKH(
        f.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        e.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            e.publicKey // rotated once
          ),
        },
      ],
    });
    ke.public_key_hash = getP2PKH(d.publicKey);
    kel.kel.push(ke);
    setKels({ ...kels, [id]: kel });
    setHdWallet(a);
    console.log(JSON.stringify(kel));
    await sendTransaction(a, ke);
  }, [hdWallet, kel, mfa]);

  const handleSendRelationshipRequest = useCallback(async () => {
    if (kel.kel.length <= 0)
      return alert("No inception event on key event log");
    if (Object.keys(kels).length < 2)
      return alert("Both kels must be initialized.");
    if (kels[other_kel_id].kel.length <= 0)
      return alert("Both kels must be initialized.");

    const other_kel = kels[other_kel_id].kel;
    const other_key_most_recent_event = other_kel[other_kel.length - 1];
    const a = await deriveSecurePath(hdWallet, mfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, mfa); //0/0/0 --> //0/0/0/0
    const mfaAddress = getP2PKH(
      Buffer.from(other_key_most_recent_event.public_key, "hex")
    );
    const za = await deriveSecurePath(hdWallet, mfa + mfaAddress); //0/0 --> //0/0/0
    const zb = await deriveSecurePath(za, mfa + mfaAddress); //0/0 --> //0/0/0
    const zc = await deriveSecurePath(zb, mfa + mfaAddress); //0/0 --> //0/0/0
    const message = JSON.stringify({
      twice_prerotated_key_hash: getP2PKH(zc.publicKey),
      prerotated_key_hash: getP2PKH(zb.publicKey),
      public_key: Buffer.from(za.publicKey).toString("hex"),
      mfa: mfaAddress,
    });
    console.log(
      getP2PKH(Buffer.from(other_key_most_recent_event.public_key, "hex"))
    );
    const encrypted = serializeToBinary(
      await encryptMessage(
        Buffer.from(other_key_most_recent_event.public_key, "hex"),
        message
      )
    );
    console.log(`encrypted: ${encrypted}`);
    const txn = new Transaction({
      public_key: Buffer.from(a.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            Buffer.from(other_key_most_recent_event.public_key, "hex") // rotated once
          ),
        },
      ],
      relationship: encrypted,
    });
    txn.public_key_hash = getP2PKH(a.publicKey);
    await sendTransaction(a, txn);

    const d = await deriveSecurePath(c, mfa); //0/0/0/0/0
    const ke = new Transaction({
      public_key: Buffer.from(b.publicKey).toString("hex"), // NOT rotated
      twice_prerotated_key_hash: getP2PKH(
        d.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            c.publicKey // rotated once
          ),
        },
      ],
    });
    ke.public_key_hash = getP2PKH(b.publicKey);
    kels[id].kel.push(txn, ke);
    await sendTransaction(a, ke);

    const privateKeyEvent = new Transaction({
      public_key: Buffer.from(za.publicKey).toString("hex"), // NOT rotated
      twice_prerotated_key_hash: getP2PKH(
        zc.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        zb.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            zb.publicKey //0/0/0
          ),
        },
      ],
    });
    privateKeyEvent.public_key_hash = getP2PKH(za.publicKey);
    const new_id = `Session for ${id}`;
    if (!kels[new_id]) {
      kels[new_id] = {
        hidden: true,
        other_kel_id: `Session for ${other_kel_id}`,
        kel: [privateKeyEvent],
        default_wallet: za,
        parent: kels[id],
        parent_key: b,
      };
    }
    setHdWallet(b);
    setKels({ ...kels, [new_id]: kels[new_id], [id]: kels[id] });
    //console.log(JSON.stringify(kel));
  }, [hdWallet, kel, mfa, kels]);

  const handleAcceptRelationshipRequest = useCallback(async () => {
    if (kel.kel.length <= 0)
      return alert("No inception event on key event log");
    if (Object.keys(kels).length < 2)
      return alert("Both kels must be initialized.");
    if (kels[other_kel_id].kel.length <= 0)
      return alert("Both kels must be initialized.");

    const other_kel = kels[other_kel_id].kel;
    const other_key_most_recent_event = other_kel[other_kel.length - 1];
    const other_key_most_recent_unconfirmed_event =
      other_kel[other_kel.length - 2];
    console.log(getP2PKH(hdWallet.publicKey));
    let decrypted = {};
    if (other_key_most_recent_unconfirmed_event.relationship !== "") {
      decrypted = JSON.parse(
        await decryptMessage(
          Buffer.from(hdWallet.privateKey),
          deserializeFromHex(
            other_key_most_recent_unconfirmed_event.relationship
          )
        )
      );
    } else {
      decrypted = {
        public_key: getP2PKH(
          Buffer.from(other_key_most_recent_unconfirmed_event.public_key, "hex")
        ),
      };
    }
    console.log(decrypted);
    console.log(getP2PKH(Buffer.from(decrypted.public_key, "hex")));

    const newKeyEvent = new Transaction({
      ...other_key_most_recent_event,
      ...decrypted,
    });

    newKeyEvent.public_key_hash = getP2PKH(
      Buffer.from(decrypted.public_key, "hex")
    );
    const a = await deriveSecurePath(hdWallet, mfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, mfa); //0/0/0 --> //0/0/0/0

    const za = await deriveSecurePath(hdWallet, mfa + decrypted.mfa); //0/0 --> //0/0/0
    const zb = await deriveSecurePath(za, mfa + decrypted.mfa); //0/0 --> //0/0/0
    const zc = await deriveSecurePath(zb, mfa + decrypted.mfa); //0/0 --> //0/0/0
    const message = JSON.stringify({
      twice_prerotated_key_hash: getP2PKH(zc.publicKey),
      prerotated_key_hash: getP2PKH(zb.publicKey),
      public_key: Buffer.from(za.publicKey).toString("hex"),
      mfa: decrypted.mfa,
    });
    const encrypted = serializeToBinary(
      await encryptMessage(
        Buffer.from(other_key_most_recent_event.public_key, "hex"),
        message
      )
    );
    console.log(Buffer.from(za.publicKey).toString("hex"));
    const txn = new Transaction({
      public_key: Buffer.from(za.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            Buffer.from(other_key_most_recent_event.public_key, "hex") // rotated once
          ),
        },
      ],
      relationship: encrypted,
    });
    txn.public_key_hash = getP2PKH(a.publicKey);
    await sendTransaction(za, txn);

    const d = await deriveSecurePath(c, mfa); //0/0/0/0/0
    const ke = new Transaction({
      public_key: Buffer.from(b.publicKey).toString("hex"), // NOT rotated
      twice_prerotated_key_hash: getP2PKH(
        d.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            c.publicKey // rotated once
          ),
        },
      ],
    });

    ke.public_key_hash = getP2PKH(b.publicKey);
    kels[id].kel.push(txn, ke);

    const privateKeyEvent = new Transaction({
      public_key: Buffer.from(za.publicKey).toString("hex"), // NOT rotated
      twice_prerotated_key_hash: getP2PKH(
        zc.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        zb.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(zb.publicKey, "hex"),
        },
      ],
    });
    privateKeyEvent.public_key_hash = getP2PKH(za.publicKey);

    const new_id = `Session for ${id}`;
    if (!kels[new_id]) {
      kels[new_id] = {
        hidden: true,
        other_kel_id: `Session for ${other_kel_id}`,
        kel: [privateKeyEvent],
        default_wallet: za,
        parent: kels[id],
        parent_key: b,
      };
    }
    setKels({ ...kels, [new_id]: kels[new_id], [id]: kels[id] });
    setHdWallet(b);
    //console.log(JSON.stringify(kel));
    await sendTransaction(a, ke);
  }, [hdWallet, kel, mfa, kels]);

  const handleSendMessage = useCallback(async () => {
    if (kel.length <= 0) return alert("No inception event on key event log");

    const other_kel = kels[other_kel_id].kel;
    const other_key_most_recent_event = other_kel[other_kel.length - 1];
    const other_key_most_recent_unconfirmed_event =
      other_kel[other_kel.length - 2] ||
      kels[other_kel_id].parent.kel[kels[other_kel_id].parent.kel.length - 2];
    const decrypted = JSON.parse(
      await decryptMessage(
        Buffer.from(
          other_kel.length > 1
            ? hdWallet.privateKey
            : kels[id].parent_key.privateKey
        ),
        deserializeFromHex(other_key_most_recent_unconfirmed_event.relationship)
      )
    );

    const a = await deriveSecurePath(hdWallet, mfa + decrypted.mfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, mfa + decrypted.mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, mfa + decrypted.mfa); //0/0/0 --> //0/0/0/0
    const d = await deriveSecurePath(c, mfa + decrypted.mfa); //0/0/0 --> //0/0/0/0

    console.log(decrypted);
    const message = JSON.stringify({
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(b.publicKey),
      public_key: Buffer.from(b.publicKey).toString("hex"),
      mfa: decrypted.mfa,
    });

    const encrypted = serializeToBinary(
      await encryptMessage(Buffer.from(decrypted.public_key, "hex"), message)
    );
    console.log(decrypted.public_key);
    const txn = new Transaction({
      public_key: Buffer.from(a.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            Buffer.from(decrypted.public_key, "hex") // rotated once
          ),
        },
      ],
      relationship: encrypted,
    });
    txn.public_key_hash = getP2PKH(a.publicKey);
    await sendTransaction(a, txn);
    kels[id].kel.push(txn);

    const txn2 = new Transaction({
      public_key: Buffer.from(b.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        d.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      outputs: [
        {
          to: getP2PKH(
            c.publicKey //0/0/0
          ),
        },
      ],
    });
    txn2.public_key_hash = getP2PKH(b.publicKey);
    await sendTransaction(b, txn);
    kels[id].kel.push(txn2);
    setKels({ ...kels, [id]: kels[id] });
    setHdWallet(b);
  }, [hdWallet, kel, mfa, kels]);

  const [wif, setWif] = useState("");
  const handleWifImport = () => {
    importWif(wif);
  };

  const verify = (prev2, prev1, txn) => {
    if (
      !prev1 &&
      txn.public_key_hash &&
      txn.outputs.length === 1 &&
      txn.outputs[0].to === txn.prerotated_key_hash &&
      txn.relationship === ""
    )
      return "Inception";

    if (
      prev1 &&
      prev2 &&
      txn.outputs.length === 1 &&
      txn.twice_prerotated_key_hash &&
      txn.twice_prerotated_key_hash.length > 0 &&
      txn.prerotated_key_hash &&
      txn.prerotated_key_hash.length > 0 &&
      prev2.twice_prerotated_key_hash === txn.public_key_hash &&
      prev1.twice_prerotated_key_hash === txn.outputs[0].to &&
      prev1.prerotated_key_hash === txn.public_key_hash
    )
      return "Confirmed";

    if (
      prev1 &&
      (txn.outputs.length > 1 ||
        txn.outputs[0].to !== prev1.prerotated_key_hash ||
        txn.relationship !== "")
    )
      return "Requires confirmation";

    return "False";
  };

  const sendTransaction = async (wallet, txn) => {
    return;
    await txn.generateHash();
    txn.id = await generateSignatureWithPrivateKey(wallet.privateKey, txn.hash);
    axios.post(
      "http://localhost:8005/transaction?username_signature=asdf",
      txn,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <h3>{id}</h3>
        <button onClick={handleChangeAddress}>Rotate Key</button>
        <button onClick={handleSendYada}>Send Yada</button>
        <button onClick={handleSendRelationshipRequest}>
          Send Relationship Request
        </button>
        <button onClick={handleAcceptRelationshipRequest}>
          Accept Relationship Request
        </button>
        <button onClick={handleSendMessage}>Send Private Message</button>

        <p>Import WIF</p>
        <input
          type="text"
          value={wif}
          onChange={(e) => {
            setWif(e.currentTarget.value);
          }}
        />
        <button onClick={handleWifImport}>Import</button>
        <p>Wallet Address: {walletAddress}</p>
        <p>2FA Input</p>
        <input
          type="text"
          value={mfa}
          onChange={(e) => {
            setMfa(e.currentTarget.value);
          }}
        />
      </div>
      <table style={{ display: "block" }}>
        <thead>
          <tr>
            {/* <th>Public key</th> */}
            <th>Twice prerotated key hash</th>
            <th>Prerotated key hash</th>
            <th>Output</th>
            <th>Message</th>
            <th>Public key Hash</th>
            <th>Key event type</th>
          </tr>
        </thead>
        <tbody>
          {kel.kel.length > 0 &&
            kel.kel.map((txn, index, array) => {
              const prevTxn1 = index >= 1 ? array[index - 1] : null;
              const prevTxn2 = index >= 2 ? array[index - 2] : null;
              return (
                <tr key={txn.prerotated_key_hash}>
                  {/* <td style={{ fontSize: 8 }}>{txn.public_key}</td> */}
                  <td style={{ fontSize: 8 }}>
                    {txn.twice_prerotated_key_hash}
                  </td>
                  <td style={{ fontSize: 8 }}>{txn.prerotated_key_hash}</td>
                  <td style={{ fontSize: 8 }}>{txn.outputs[0].to}</td>
                  <td
                    style={{ fontSize: 8, maxWidth: 100, overflow: "hidden" }}
                  >
                    {txn.relationship}
                  </td>
                  <td style={{ fontSize: 8 }}>{txn.public_key_hash}</td>
                  <td style={{ fontSize: 8 }}>
                    {verify(prevTxn2, prevTxn1, txn)}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </>
  );
}
