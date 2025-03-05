/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import {
  testDerivation,
  generateMnemonic,
  createHDWallet,
  getP2PKH,
  generateSignatureWithPrivateKey,
  testEncryptDecrypt,
  encryptMessage,
  serializeToBinary,
  deserializeFromHex,
  decryptMessage,
  deriveSecurePath,
  generateSHA256,
} from "../utils/hdWallet";
import { Transaction } from "../utils/transaction";
import { memoize, Table, Text, Button } from "@mantine/core";
import * as bip39 from "bip39";
import * as bip32 from "bip32";
import * as tinySecp256k1 from "tiny-secp256k1";

export default function KeyEventLog(props) {
  const {
    hidden,
    kels,
    setKels,
    id,
    other_kel_id,
    kel,
    defaultWallet,
    onchainMode,
    setOpened,
  } = props;
  const [rootKey, setRootKey] = useState(null);
  const [hdWallet, setHdWallet] = useState(null);
  const [mfa, setMfa] = useState("");
  const [newMfa, setNewMfa] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [walletAddress, setWalletAddress] = useState("");

  const onchainModeRef = useRef(onchainMode);

  useEffect(() => {
    onchainModeRef.current = onchainMode; // Always update the ref when prop changes
  }, [onchainMode]);

  useEffect(() => {
    setKels((prevKels) => {
      return { ...prevKels, [id]: kel };
    }); // Safely update the kels array in the parent component
  }, [kel, setKels]);

  useEffect(() => {
    if (onchainMode) return;
    if (!hdWallet && hidden && defaultWallet) {
      setHdWallet(defaultWallet);
    }
    if (!hdWallet) {
      setInterval(() => {
        kel.kel.forEach(async (txn, index) => {
          if (txn.status !== "pending") return;
          const res = await axios.get(
            `${import.meta.env.VITE_API_URL}/get-transaction-by-id?id=${txn.id}`
          );
          if (res.data.id) {
            if (res.data.mempool === true) {
              kel.kel[index].status = "pending";
            } else {
              kel.kel[index].status = "onchain";
              setHdWallet((prevHdWallet) => kel.kel[index].key);
            }
          } else if (res.data.status === false) {
            kel.kel.splice(index, 1);
            if (kel.kel[kel.kel.length - 1])
              setHdWallet((prevHdWallet) => kel.kel[kel.kel.length - 1].key);
          }
        });
        setKels((prevState) => {
          return { ...prevState, [id]: kel };
        });
      }, 10000);
    }
    if (!hdWallet && !hidden) {
      handleGenerateMnemonic();
    }
  }, [hdWallet, kel, kels]);

  const handleGenerateMnemonic = async () => {
    const newMnemonic = generateMnemonic();
    setMnemonic(newMnemonic);
    const wallet = createHDWallet(newMnemonic);
    setHdWallet(wallet);
  };

  const handleChangeAddress = useCallback(async () => {
    console.log(mnemonic);
    const a = await deriveSecurePath(hdWallet, mfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, newMfa || mfa); //0/0/0 --> //0/0/0/0
    const message = JSON.stringify({
      message: "pass it on",
    });
    const encrypted = serializeToBinary(
      await encryptMessage(c.publicKey, message)
    );
    const txn = new Transaction({
      key: a,
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
      relationship: newMfa ? encrypted : undefined,
      relationship_hash: await generateSHA256(encrypted),
      public_key_hash: getP2PKH(a.publicKey),
      prev_public_key_hash:
        kel.kel.length > 0 ? kel.kel[kel.kel.length - 1].public_key_hash : "",
    });

    txn.key = a;
    kel.kel.push(txn);
    console.log(getP2PKH(a.publicKey));

    await sendTransaction(a, txn);
    if (newMfa) {
      const newa = await deriveSecurePath(a, mfa); //0/0 --> //0/0/0
      const newb = await deriveSecurePath(newa, newMfa); //0/0/0 --> //0/0/0/0
      const newc = await deriveSecurePath(newb, newMfa); //0/0/0 --> //0/0/0/0
      const txn2 = new Transaction({
        key: newa,
        public_key: Buffer.from(newa.publicKey).toString("hex"), //0/0
        twice_prerotated_key_hash: getP2PKH(
          newc.publicKey //0/0/0
        ),
        prerotated_key_hash: getP2PKH(
          newb.publicKey //0/0/0
        ),
        outputs: [
          {
            to: getP2PKH(
              newb.publicKey //0/0/0
            ), // attacker address attempting to steal yada
          },
        ],
        public_key_hash: getP2PKH(newa.publicKey),
        prev_public_key_hash: kel.kel[kel.kel.length - 1].public_key_hash,
      });
      txn2.key = newa;
      kel.kel.push(txn2);
      await sendTransaction(newa, txn2);
      kels[id].last_decrypt_key = newb;
    } else {
      kels[id].last_decrypt_key = b;
    }

    setKels({ ...kels, [id]: kel });
    console.log(JSON.stringify(kel));
    setMfa(newMfa || mfa);
    setNewMfa("");
    setOpened(true);
  }, [hdWallet, kel, mfa, id, newMfa, kels]);

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
    const mfaAddress = other_key_most_recent_event.prerotated_key_hash;
    const za = await deriveSecurePath(hdWallet, mfa + mfaAddress); //0/0 --> //0/0/0
    const zb = await deriveSecurePath(za, mfa + mfaAddress); //0/0 --> //0/0/0
    const zc = await deriveSecurePath(zb, mfa + mfaAddress); //0/0 --> //0/0/0
    const message = JSON.stringify(
      {
        public_key: Buffer.from(za.publicKey).toString("hex"),
        mfa: mfaAddress,
        encryption_key_hash: getP2PKH(
          Buffer.from(other_key_most_recent_event.public_key, "hex")
        ),
      },
      null,
      4
    );
    console.log(
      getP2PKH(Buffer.from(other_key_most_recent_event.public_key, "hex"))
    );
    const encrypted = serializeToBinary(
      await encryptMessage(
        Buffer.from(kels[other_kel_id].last_decrypt_key.publicKey, "hex"),
        message
      )
    );
    console.log(`encrypted: ${encrypted}`);
    const txn = new Transaction({
      key: a,
      public_key: Buffer.from(a.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: other_key_most_recent_event.prerotated_key_hash, // rotated once
          value: 0,
        },
      ],
      relationship: encrypted,
      relationship_hash: await generateSHA256(encrypted),
      public_key_hash: getP2PKH(a.publicKey),
      prev_public_key_hash: kel.kel[kel.kel.length - 1].public_key_hash,
    });
    txn.message = message;
    txn.key = a;
    await sendTransaction(a, txn);

    const d = await deriveSecurePath(c, mfa); //0/0/0/0/0
    const ke = new Transaction({
      key: b,
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
      public_key_hash: getP2PKH(b.publicKey),
      prev_public_key_hash: txn.public_key_hash,
    });
    ke.key = b;
    kels[id].kel.push(txn, ke);
    await sendTransaction(b, ke);
    kel.last_decrypt_key = c;

    const privateKeyEvent = new Transaction({
      key: za,
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
      public_key_hash: getP2PKH(za.publicKey),
    });

    privateKeyEvent.key = za;

    await sendTransaction(za, privateKeyEvent, false);
    const new_id = `Session for ${id}`;
    if (!kels[new_id]) {
      kels[new_id] = {
        hidden: true,
        other_kel_id: `Session for ${other_kel_id}`,
        kel: [privateKeyEvent],
        default_wallet: za,
        parent: kels[id],
        parent_key: b,
        last_decrypt_key: a,
        onchainMode: false,
      };
    }
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
          Buffer.from(kels[id].last_decrypt_key.privateKey),
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

    const a = await deriveSecurePath(hdWallet, mfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, mfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, mfa); //0/0/0 --> //0/0/0/0

    const za = await deriveSecurePath(hdWallet, mfa + decrypted.mfa); //0/0 --> //0/0/0
    const zb = await deriveSecurePath(za, mfa + decrypted.mfa); //0/0 --> //0/0/0
    const zc = await deriveSecurePath(zb, mfa + decrypted.mfa); //0/0 --> //0/0/0
    const message = JSON.stringify(
      {
        public_key: Buffer.from(zb.publicKey).toString("hex"),
        mfa: decrypted.mfa,
        encryption_key_hash: getP2PKH(
          Buffer.from(kels[other_kel_id].last_decrypt_key.publicKey, "hex")
        ),
      },
      null,
      4
    );
    const encrypted = serializeToBinary(
      await encryptMessage(
        Buffer.from(kels[other_kel_id].last_decrypt_key.publicKey, "hex"),
        message
      )
    );
    console.log(Buffer.from(a.publicKey).toString("hex"));
    const txn = new Transaction({
      key: a,
      public_key: Buffer.from(a.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: other_key_most_recent_event.prerotated_key_hash, // rotated once
          value: 0,
        },
      ],
      relationship: encrypted,
      relationship_hash: await generateSHA256(encrypted),
      public_key_hash: getP2PKH(a.publicKey),
      prev_public_key_hash: kel.kel[kel.kel.length - 1].public_key_hash,
    });
    txn.message = message;
    txn.key = a;
    await sendTransaction(a, txn);

    const d = await deriveSecurePath(c, mfa); //0/0/0/0/0
    const ke = new Transaction({
      key: b,
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
      public_key_hash: getP2PKH(b.publicKey),
      prev_public_key_hash: txn.public_key_hash,
    });
    ke.key = b;
    kels[id].kel.push(txn, ke);
    await sendTransaction(b, ke);
    kel.last_decrypt_key = c;

    const privateKeyEvent = new Transaction({
      key: za,
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
      public_key_hash: getP2PKH(za.publicKey),
    });
    privateKeyEvent.key = za;
    await sendTransaction(za, privateKeyEvent, false);

    const new_id = `Session for ${id}`;
    if (!kels[new_id]) {
      kels[new_id] = {
        hidden: true,
        other_kel_id: `Session for ${other_kel_id}`,
        kel: [privateKeyEvent],
        default_wallet: za,
        parent: kels[id],
        parent_key: b,
        last_decrypt_key: zb,
      };
    }
    setKels({ ...kels, [new_id]: kels[new_id], [id]: kels[id] });
    //console.log(JSON.stringify(kel));
  }, [hdWallet, kel, mfa, kels]);

  const handleSendMessage = useCallback(async () => {
    if (kel.length <= 0) return alert("No inception event on key event log");

    const other_kel = kels[other_kel_id].kel;
    const other_key_most_recent_event = other_kel[other_kel.length - 1];
    let other_key_most_recent_unconfirmed_event;
    let derivationMfa;
    let decrypted;
    if (kel.parent) {
      other_key_most_recent_unconfirmed_event =
        kels[other_kel_id].parent &&
        !kels[other_kel_id].kel[kels[other_kel_id].kel.length - 2]
          ? kels[other_kel_id].parent.kel[
              kels[other_kel_id].parent.kel.length - 2
            ]
          : kels[other_kel_id].kel[kels[other_kel_id].kel.length - 2];

      const decryptKey = kels[other_kel_id].kel[
        kels[other_kel_id].kel.length - 2
      ]
        ? kels[id].last_decrypt_key.privateKey
        : kels[id].parent.last_decrypt_key.privateKey;

      decrypted = JSON.parse(
        await decryptMessage(
          Buffer.from(decryptKey),
          deserializeFromHex(
            other_key_most_recent_unconfirmed_event.relationship
          )
        )
      );
      derivationMfa = mfa + decrypted.mfa;
      console.log(decrypted);
    } else {
      derivationMfa = mfa;
    }

    const a = await deriveSecurePath(hdWallet, derivationMfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, derivationMfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, derivationMfa); //0/0/0 --> //0/0/0/0
    const d = await deriveSecurePath(c, derivationMfa); //0/0/0 --> //0/0/0/0

    kel.last_decrypt_key = c;
    const message = JSON.stringify({
      public_key: Buffer.from(c.publicKey).toString("hex"),
      mfa: decrypted.mfa,
      encryption_key_hash: getP2PKH(Buffer.from(decrypted.public_key, "hex")),
    });

    const encrypted = serializeToBinary(
      await encryptMessage(Buffer.from(decrypted.public_key, "hex"), message)
    );
    console.log(decrypted.public_key);
    const txn = new Transaction({
      key: a,
      public_key: Buffer.from(a.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: other_kel[other_kel.length - 1].prerotated_key_hash,
        },
      ],
      relationship: encrypted,
      relationship_hash: await generateSHA256(encrypted),
      public_key_hash: getP2PKH(a.publicKey),
      prev_public_key_hash: kel.kel[kel.kel.length - 1].public_key_hash,
    });
    txn.key = a;
    await sendTransaction(a, txn);
    kels[id].kel.push(txn);

    const txn2 = new Transaction({
      key: b,
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
      public_key_hash: getP2PKH(b.publicKey),
      prev_public_key_hash: kel.kel[kel.kel.length - 1].public_key_hash,
    });
    txn2.key = b;
    await sendTransaction(b, txn2);
    kels[id].kel.push(txn2);
    setKels({ ...kels, [id]: kels[id] });
  }, [hdWallet, kel, mfa, kels]);

  const handleSendYada = useCallback(async () => {
    if (kel.length <= 0) return alert("No inception event on key event log");
    const other_kel = kels[other_kel_id].kel;
    const other_key_most_recent_event = other_kel[other_kel.length - 1];
    let other_key_most_recent_unconfirmed_event;
    let derivationMfa;
    let decrypted;
    if (kel.parent) {
      other_key_most_recent_unconfirmed_event =
        kels[other_kel_id].parent &&
        !kels[other_kel_id].kel[kels[other_kel_id].kel.length - 2]
          ? kels[other_kel_id].parent.kel[
              kels[other_kel_id].parent.kel.length - 2
            ]
          : kels[other_kel_id].kel[kels[other_kel_id].kel.length - 2];

      const decryptKey = kels[other_kel_id].kel[
        kels[other_kel_id].kel.length - 2
      ]
        ? kels[id].last_decrypt_key.privateKey
        : kels[id].parent.last_decrypt_key.privateKey;

      decrypted = JSON.parse(
        await decryptMessage(
          Buffer.from(decryptKey),
          deserializeFromHex(
            other_key_most_recent_unconfirmed_event.relationship
          )
        )
      );
      derivationMfa = mfa + decrypted.mfa;
      console.log(decrypted);
    } else {
      derivationMfa = mfa;
    }
    const a = await deriveSecurePath(hdWallet, derivationMfa); //0/0 --> //0/0/0
    const b = await deriveSecurePath(a, derivationMfa); //0/0/0 --> //0/0/0/0
    const c = await deriveSecurePath(b, derivationMfa); //0/0/0 --> //0/0/0/0
    const d = await deriveSecurePath(c, derivationMfa); //0/0/0 --> //0/0/0/0

    kel.last_decrypt_key = c;
    const message = JSON.stringify(
      {
        public_key: Buffer.from(c.publicKey).toString("hex"),
        mfa: decrypted.mfa,
        encryption_key_hash: getP2PKH(Buffer.from(decrypted.public_key, "hex")),
      },
      null,
      4
    );

    const encrypted = serializeToBinary(
      await encryptMessage(Buffer.from(decrypted.public_key, "hex"), message)
    );
    const txn = new Transaction({
      key: a,
      public_key: Buffer.from(a.publicKey).toString("hex"), //0/0
      twice_prerotated_key_hash: getP2PKH(
        c.publicKey //0/0/0
      ),
      prerotated_key_hash: getP2PKH(
        b.publicKey //0/0/0
      ),
      outputs: [
        {
          to: walletAddress || other_key_most_recent_event.prerotated_key_hash, // attacker address attempting to steal yada
          value: 1,
        },
      ],
      relationship: encrypted,
      relationship_hash: await generateSHA256(encrypted),
      public_key_hash: getP2PKH(a.publicKey),
      prev_public_key_hash: kel.kel[kel.kel.length - 1].public_key_hash,
    });
    txn.message = message;
    txn.key = a;
    await sendTransaction(a, txn);
    kel.kel.push(txn);

    const ke = new Transaction({
      key: b,
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
      public_key_hash: getP2PKH(b.publicKey),
      prev_public_key_hash: kel.kel[kel.kel.length - 1].public_key_hash,
    });
    ke.key = b;
    kel.kel.push(ke);
    if (
      other_kel[other_kel.length - 2] &&
      other_kel[other_kel.length - 2].outputs[0].to ===
        getP2PKH(hdWallet.publicKey)
    ) {
      kels[id].last_decrypt_key = hdWallet;
    } else if (
      other_kel[other_kel.length - 1] &&
      other_kel[other_kel.length - 1].outputs[0].to ===
        getP2PKH(hdWallet.publicKey)
    )
      kels[id].last_decrypt_key = hdWallet;
    setKels({ ...kels, [id]: kel });
    console.log(JSON.stringify(kel));
    await sendTransaction(b, ke);
  }, [hdWallet, kel, mfa, walletAddress, kels]);

  const [wif, setWif] = useState("");

  const verify = (prev2, prev1, txn) => {
    if (
      txn.outputs.length > 1 ||
      txn.relationship !== "" ||
      txn.outputs[0].to !== txn.prerotated_key_hash
    )
      return "Requires confirmation";

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
      !prev2 &&
      txn.outputs.length === 1 &&
      txn.twice_prerotated_key_hash &&
      txn.twice_prerotated_key_hash.length > 0 &&
      txn.prerotated_key_hash &&
      txn.prerotated_key_hash.length > 0 &&
      prev1.twice_prerotated_key_hash === txn.outputs[0].to &&
      prev1.prerotated_key_hash === txn.public_key_hash
    )
      return "Confirmed";

    return "False";
  };

  const sendTransaction = useCallback(
    async (wallet, txn, saveWallet = true) => {
      await txn.generateHash();
      txn.id = await generateSignatureWithPrivateKey(
        wallet.privateKey,
        txn.hash
      );
      if (saveWallet) {
        setHdWallet(wallet);
      }
      if (!onchainModeRef.current) {
        txn.status = "offchainmode";
        return;
      }
      axios.post(
        `${import.meta.env.VITE_API_URL}/transaction?username_signature=asdf`,
        txn.toJson(),
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    },
    [onchainMode]
  );

  const handleSeedImport = async () => {
    const wallet = createHDWallet(mnemonic);

    let a = await deriveSecurePath(wallet, mfa); //0/0 --> //0/0/0

    const pk = Buffer.from(a.publicKey).toString("hex");
    const res = await axios.get(
      `${
        import.meta.env.VITE_API_URL
      }/key-event-log?username_signature=asdf&public_key=${pk}`
    );
    console.log(res.data);
    if (res.data.key_event_log) {
      for (let i = 1; i < res.data.key_event_log.length; i++) {
        a = await deriveSecurePath(a, mfa); //0/0 --> //0/0/0
      }

      setHdWallet(a);
      kels[id].kel = res.data.key_event_log.map((txn) => {
        txn.status = "onchain";
        return txn;
      });
      kels[id].kel[kels[id].kel.length - 1].key = a;
      setKels({ ...kels, [id]: kels[id] });
    }
  };

  const getPreviousKey = async (address) => {
    const wallet = createHDWallet(mnemonic);

    let a = await deriveSecurePath(wallet, mfa); //0/0 --> //0/0/0

    const pk = Buffer.from(a.publicKey).toString("hex");
    const res = await axios.get(
      `${
        import.meta.env.VITE_API_URL
      }/key-event-log?username_signature=asdf&public_key=${pk}`
    );
    console.log(res.data);
    if (res.data.key_event_log) {
      for (let i = 1; i < res.data.key_event_log.length; i++) {
        a = await deriveSecurePath(a, mfa); //0/0 --> //0/0/0
      }

      setHdWallet(a);
      kels[id].kel = res.data.key_event_log.map((txn) => {
        txn.status = "onchain";
        return txn;
      });
      kels[id].kel[kels[id].kel.length - 1].key = a;
      setKels({ ...kels, [id]: kels[id] });
    }
  };
  const stringToColor = (str) => {
    let hash = 0;
    // Compute a hash from the input string
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = "#";
    // Extract and adjust each RGB component
    for (let i = 0; i < 3; i++) {
      // Extract one 8-bit component from the hash
      let value = (hash >> (i * 8)) & 0xff;
      // Mix with white (255) to lighten the color (pastel effect)
      value = Math.floor((value + 255) / 2);
      // Convert the value to a two-digit hexadecimal string
      color += ("00" + value.toString(16)).substr(-2);
    }
    return color;
  };
  const pending_request =
    kels[id].kel.at(-1) &&
    kels[kels[id].other_kel_id] &&
    kels[kels[id].other_kel_id].kel.at(-2) &&
    kels[kels[id].other_kel_id].kel.at(-2).outputs[0].to ===
      kels[id].kel.at(-1).prerotated_key_hash;
  const ready_for_request =
    kels[kels[id].other_kel_id] && kels[kels[id].other_kel_id].kel[0];
  const current_key_match_with_latest_key_event =
    kel.kel.at(-1) &&
    hdWallet &&
    kel.kel.at(-1).public_key_hash === getP2PKH(hdWallet.publicKey);
  return (
    <div style={{ display: "flex", flexDirection: "row" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <h3>{id}</h3>
        <h4
          style={{
            backgroundColor:
              hdWallet &&
              kel.kel.length > 0 &&
              stringToColor(getP2PKH(hdWallet.publicKey)),
          }}
        >
          Current key:{" "}
          {hdWallet && kel.kel.length > 0 && getP2PKH(hdWallet.publicKey)}
        </h4>
        {kels[id].kel.length === 0 && kel.hidden === false && (
          <Button
            // disabled={
            //   kel.kel[kel.kel.length - 1] &&
            //   kel.kel[kel.kel.length - 1].status === "pending"
            // }
            onClick={handleChangeAddress}
          >
            Initialize wallet
          </Button>
        )}
        {ready_for_request &&
          !pending_request &&
          !kels[id].parent &&
          kels[id].kel.length === 1 &&
          id == "User 1" && (
            <Button onClick={handleSendRelationshipRequest}>
              Request to branch log with {kels[id].other_kel_id}
            </Button>
          )}
        {pending_request && !kels[id].parent && id == "User 2" && (
          <Button onClick={handleAcceptRelationshipRequest}>
            Accept request to branch log with {kels[id].other_kel_id}
          </Button>
        )}

        {/* {kel.hidden === true && (
          <Button onClick={handleSendMessage}>Send Private Message</Button>
        )} */}

        {/* <p>Import WIF</p>
        <input
          type="text"
          value={wif}
          onChange={(e) => {
            setWif(e.currentTarget.value);
          }}
        /> */}
        {/* <Button onClick={handleWifImport}>Import</Button> */}

        {/* <p>Import Seed</p>
        <input
          type="text"
          value={mnemonic}
          onChange={(e) => {
            setMnemonic(e.currentTarget.value);
          }}
        /> */}
        {/* <Button onClick={handleSeedImport}>Import</Button> */}

        {/* <input
          placeholder="Address"
          type="text"
          value={walletAddress}
          onChange={(e) => {
            setWalletAddress(e.currentTarget.value);
          }}
        /> */}
        {kels[id].parent &&
          kels[other_kel_id] &&
          kels[id].kel.length === 1 &&
          kels[other_kel_id].kel.length === 1 && (
            <Button onClick={handleSendYada}>Send 1 Yada</Button>
          )}
        {/* <p>Change password</p>
        <input
          placeholder="Current"
          type="text"
          value={mfa}
          onChange={(e) => {
            setMfa(e.currentTarget.value);
          }}
        />
        <input
          placeholder="New"
          type="text"
          value={newMfa}
          onChange={(e) => {
            setNewMfa(e.currentTarget.value);
          }}
        /> */}
      </div>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Twice Pre-Rotated Key Hash</Table.Th>
            <Table.Th>Pre-Rotated Key Hash</Table.Th>
            <Table.Th>Public Key Hash</Table.Th>
            <Table.Th>Prev Key Hash</Table.Th>
            <Table.Th>Key Event Type</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Outputs</Table.Th>
            <Table.Th>Message</Table.Th>
            <Table.Th>Private key</Table.Th>
            <Table.Th>Chaincode</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {kel.kel.length > 0 &&
            kel.kel.map((txn, index, array) => {
              const prevTxn1 = index >= 1 ? array[index - 1] : null;
              const prevTxn2 = index >= 2 ? array[index - 2] : null;

              let verifyDerivation = null;
              const fn = async (tx) => {
                return getP2PKH(
                  (
                    await deriveSecurePath(
                      bip32
                        .BIP32Factory(tinySecp256k1)
                        .fromPrivateKey(tx.key.privateKey, tx.key.chainCode),
                      mfa
                    )
                  ).publicKey
                );
              };
              if (prevTxn1) {
                verifyDerivation = fn(prevTxn1);
              }
              return (
                <Table.Tr
                  key={txn.id}
                  title={txn.id}
                  style={{ height: "200px" }}
                >
                  <Table.Td
                    style={{
                      fontSize: 8,
                      backgroundColor: stringToColor(
                        txn.twice_prerotated_key_hash
                      ),
                    }}
                  >
                    <Text>{txn.twice_prerotated_key_hash}</Text>
                  </Table.Td>
                  <Table.Td
                    style={{
                      fontSize: 8,
                      backgroundColor: stringToColor(txn.prerotated_key_hash),
                    }}
                  >
                    <Text>{txn.prerotated_key_hash}</Text>
                  </Table.Td>
                  <Table.Td
                    style={{
                      fontSize: 8,
                      backgroundColor: stringToColor(txn.public_key_hash),
                    }}
                  >
                    <Text>{txn.public_key_hash}</Text>
                  </Table.Td>
                  <Table.Td
                    style={{
                      fontSize: 8,
                      backgroundColor: stringToColor(txn.prev_public_key_hash),
                    }}
                  >
                    <Text>{txn.prev_public_key_hash}</Text>
                  </Table.Td>
                  <Table.Td style={{ fontSize: 8 }}>
                    <Text>{verify(prevTxn2, prevTxn1, txn)}</Text>
                  </Table.Td>
                  <Table.Td style={{ fontSize: 8 }}>
                    <Text>{txn.status}</Text>
                  </Table.Td>
                  <Table.Td
                    style={{
                      fontSize: 8,
                      padding: 0, // Remove padding so the inner container fills the cell
                      overflow: "hidden",
                      maxWidth: 400,
                      height: "100%",
                    }}
                  >
                    {/* Using a flex container instead of a nested table */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        height: "100%",
                      }}
                    >
                      {txn.outputs.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            flex: 1,
                            backgroundColor: stringToColor(item.to),
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderBottom:
                              idx < txn.outputs.length - 1
                                ? "1px solid #ccc"
                                : "none",
                          }}
                        >
                          {item.to}: {item.value}
                        </div>
                      ))}
                    </div>
                  </Table.Td>
                  <Table.Td style={{ fontSize: 8 }}>
                    <pre>{txn.message}</pre>
                  </Table.Td>
                  <Table.Td style={{ fontSize: 8 }}>
                    <Text>{txn.key.privateKey}</Text>
                  </Table.Td>
                  <Table.Td style={{ fontSize: 8 }}>
                    <Text>{txn.key.chainCode}</Text>
                  </Table.Td>
                  <Table.Td style={{ fontSize: 8 }}>
                    <Text>
                      {getP2PKH(
                        bip32
                          .BIP32Factory(tinySecp256k1)
                          .fromPrivateKey(txn.key.privateKey, txn.key.chainCode)
                          .publicKey
                      )}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ fontSize: 8 }}>
                    {prevTxn1 && <Text>{verifyDerivation}</Text>}
                  </Table.Td>
                </Table.Tr>
              );
            })}
        </Table.Tbody>
      </Table>
    </div>
  );
}
