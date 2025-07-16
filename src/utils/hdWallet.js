/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

import { ethers } from "ethers";
import * as bip39 from "bip39";
import * as bip32 from "bip32";
import * as tinySecp256k1 from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import * as ECPairFactory from "ecpair";
import * as eccryptoJS from "eccrypto-js";
import * as shajs from "sha.js";
import axios from "axios";

const STORAGE_KEYS = { MNEMONIC: "mnemonic", PUBLIC_KEY: "publicKey" };

// Function to generate a mnemonic phrase
export const generateMnemonic = () => {
  return bip39.generateMnemonic(); // Returns a 12-word mnemonic
};

export const validateBitcoinAddress = (address, network = bitcoin.networks.bitcoin) => {
  try {
    // Remove whitespace
    address = address.trim();

    // Basic length check
    if (address.length < 26 || address.length > 62) {
      return false;
    }

    // Use bitcoinjs-lib to validate the address
    try {
      bitcoin.address.toOutputScript(address, network);
      return address;
    } catch (e) {
      return false;
    }
  } catch (e) {
    console.error('Address validation error:', e);
    return false;
  }
};

export const getP2PKH = (publicKey) => {
  const { address } = bitcoin.payments.p2pkh({
    pubkey: publicKey,
  });
  return address;
};

function randomBytes(size) {
  const array = new Uint8Array(size);
  window.crypto.getRandomValues(array);
  return Buffer.from(array);
}

function encodeASN1Integer(integer) {
  // Ensure integer is positive by prefixing with 0x00 if the high bit is set
  if (integer[0] & 0x80) {
    return Buffer.concat([Buffer.from([0x00]), integer]);
  }
  return integer;
}

export const generateSHA256 = async (input) => {
  return new shajs.sha256().update(input).digest("hex");
};

export const generateSignatureWithPrivateKey = async (
  privateKeyBuffer,
  message
) => {
  const ECPair = ECPairFactory.ECPairFactory(tinySecp256k1);
  const keyPair = ECPair.fromPrivateKey(privateKeyBuffer);
  const messageHash = await generateSHA256(message);

  // Custom nonce
  const customNonce = randomBytes(32); // Generate 32 random bytes
  // Signing the hash with the private key
  const rawSignature = tinySecp256k1.sign(
    Buffer.from(messageHash, "hex"),
    keyPair.privateKey,
    customNonce
  );

  // Manually encode the raw signature to DER format
  const r = rawSignature.slice(0, 32);
  const s = rawSignature.slice(32, 64);

  const rEncoded = encodeASN1Integer(r);
  const sEncoded = encodeASN1Integer(s);

  const derSignature = Buffer.concat([
    Buffer.from([0x30]), // DER Sequence
    Buffer.from([rEncoded.length + sEncoded.length + 4]), // Total length
    Buffer.from([0x02]), // Integer marker for r
    Buffer.from([rEncoded.length]), // r length
    rEncoded, // r value
    Buffer.from([0x02]), // Integer marker for s
    Buffer.from([sEncoded.length]), // s length
    sEncoded, // s value
  ]);

  // Return the DER-encoded signature as a Base64 string
  return derSignature.toString("base64");
};

// Function to create an HD wallet from mnemonic
export const createHDWallet = (mnemonic) => {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic");
  }

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.BIP32Factory(tinySecp256k1).fromSeed(seed);
  return root.deriveHardened(0);
};

export const initWalletFromMnemonic = async (mnemonic) => {
  const root = createHDWallet(mnemonic);
  const mfa = prompt("Enter your wallet password.");
  const roota = await deriveSecurePath(root, mfa);
  const rootb = await deriveSecurePath(roota, mfa);
  const log = await getKeyEventLog(rootb);
  const wallet = await syncWalletWithKel(roota, mfa, log);
  return { wallet, mfa, log };
};

export const getKeyEventLog = async (wallet) => {
  const pk = Buffer.from(wallet.publicKey).toString("hex");
  const res = await axios.get(
    `${
      import.meta.env.VITE_API_URL
    }/key-event-log?username_signature=asdf&public_key=${pk}`
  );
  return res.data.key_event_log;
};

export const syncWalletWithKel = async (wallet, mfa, key_event_log) => {
  let a = await deriveSecurePath(wallet, mfa);
  for (let i = 1; i < key_event_log.length; i++) {
    a = await deriveSecurePath(a, mfa); //0/0 --> //0/0/0
    key_event_log[i].key = a;
  }
  return a;
};

const deriveIndex = async (factor, level) => {
  const hash = BigInt('0x' + await generateSHA256(factor + level));
  const modulo = BigInt(2147483647);
  const remainder = hash % modulo;
  console.log(remainder.toString());
  return Number(remainder);
};

// Generate a secure derivation path
export const deriveSecurePath = async (root, secondFactor) => {
  let currentNode = root;

  // Fixed 4-level path
  for (let level = 0; level < 4; level++) {
    const index = await deriveIndex(secondFactor, level);
    console.log(index)
    currentNode = currentNode.deriveHardened(index);
  }
  currentNode.uncompressedPublicKey = decompressPublicKey(Buffer.from(currentNode.publicKey))
  console.log(getP2PKH(currentNode.publicKey))
  return currentNode;
};

export function decompressPublicKey(compressedKey) {
  if (!(compressedKey instanceof Buffer) || compressedKey.length !== 33) {
    throw new Error("Invalid compressed public key");
  }

  // Use bitcoinjs-lib's ECPair to handle key decompression
  const ECPair = ECPairFactory.default(tinySecp256k1);
  const keyPair = ECPair.fromPublicKey(compressedKey, { compressed: false });
  
  // Get the uncompressed public key (65 bytes)
  const uncompressedPublicKey = keyPair.publicKey; // This will be uncompressed by default when compressed: false is implied
  return uncompressedPublicKey;
}

export function serializeToBinary(encryptionOutput) {
  return Buffer.concat([
    encryptionOutput.iv,
    encryptionOutput.ephemPublicKey,
    encryptionOutput.ciphertext,
    encryptionOutput.mac,
  ]).toString("hex");
}

export function deserializeFromHex(serializedHex) {
  const buffer = Buffer.from(serializedHex, "hex");

  // Define the lengths of each component
  const ivLength = 16; // IV is always 16 bytes
  const ephemPublicKeyLength = 65; // Uncompressed public key length (change to 33 if compressed)
  const macLength = 32; // MAC is always 32 bytes

  // Extract components
  const iv = buffer.slice(0, ivLength);
  const ephemPublicKey = buffer.slice(
    ivLength,
    ivLength + ephemPublicKeyLength
  );
  const ciphertext = buffer.slice(
    ivLength + ephemPublicKeyLength,
    buffer.length - macLength
  );
  const mac = buffer.slice(buffer.length - macLength);

  // Return the deserialized object
  return { iv, ephemPublicKey, ciphertext, mac };
}

export async function encryptMessage(publicKey, message) {
  const msg = eccryptoJS.utf8ToBuffer(message);
  const encrypted = await eccryptoJS.encrypt(publicKey, msg);
  return encrypted;
}

export async function decryptMessage(privateKey, encrypted) {
  const decrypted = await eccryptoJS.decrypt(privateKey, encrypted);
  const message = eccryptoJS.bufferToUtf8(decrypted);
  return message;
}

// Example Usage
export const testEncryptDecrypt = async () => {
  const mnemonic = bip39.generateMnemonic();
  console.log("Mnemonic:", mnemonic);

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  console.log("Seed:", seed.toString("hex"));

  // 2. Create the master key (root) from the seed
  const keyPair = bip32.BIP32Factory(tinySecp256k1).fromSeed(seed);

  const publicKey = keyPair.publicKey;
  const privateKey = keyPair.privateKey;
  console.log(privateKey.length);

  const message = "Hello, world!";
  const encrypted = await encryptMessage(Buffer.from(publicKey), message);
  const decrypted = await decryptMessage(Buffer.from(privateKey), encrypted);

  console.log("Original message:", message);
  console.log("Encrypted message:", encrypted);
  console.log("Decrypted message:", decrypted);
  await chrome.storage.local.set({
    [STORAGE_KEYS.MNEMONIC]: mnemonic,
    [STORAGE_KEYS.PUBLIC_KEY]: publicKey,
  });
};

export const testDerivation = () => {
  // 1. Generate a BIP39 mnemonic and derive a seed
  const mnemonic = bip39.generateMnemonic();
  console.log("Mnemonic:", mnemonic);

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  console.log("Seed:", seed.toString("hex"));

  // 2. Create the master key (root) from the seed
  const root = bip32.BIP32Factory(tinySecp256k1).fromSeed(seed);
  console.log("Root Private Key:", root.toWIF());
  console.log("Root Public Key:", root.publicKey.toString("hex"));

  // 3. Derive intermediate hardened key: m/44'
  const intermediateKey1 = root.deriveHardened(44);
  console.log(
    "Intermediate Key 1 (m/44') Private Key:",
    intermediateKey1.toWIF()
  );

  // 4. Derive next hardened key: m/44'/0'
  const intermediateKey2 = intermediateKey1.deriveHardened(0);
  console.log(
    "Intermediate Key 2 (m/44'/0') Private Key:",
    intermediateKey2.toWIF()
  );

  // 5. Derive another hardened key: m/44'/0'/0'
  const intermediateKey3 = intermediateKey2.deriveHardened(0);
  console.log(
    "Intermediate Key 3 (m/44'/0'/0') Private Key:",
    intermediateKey3.toWIF()
  );

  // 6. Derive final hardened key: m/44'/0'/0'/0'
  const intermediateKey4 = intermediateKey3.deriveHardened(0);
  console.log(
    "Intermediate Key 4 (m/44'/0'/0'/0') Private Key:",
    intermediateKey4.toWIF()
  );

  // 7. Derive the same hardened key directly from root: m/44'/0'/0'/0'
  const num = hashToNumber(
    "b1c788abac15390de987ad17b65ac73c9b475d428a51f245c645a442fddd078b"
  );
  console.log(num);
  const directKey = root
    .deriveHardened(44)
    .deriveHardened(0)
    .deriveHardened(0)
    .deriveHardened(num);
  console.log("Direct Key (m/44'/0'/0'/0') Private Key:", directKey.toWIF());

  // Verify consistency between intermediate and direct derivation
  console.log(
    "Keys match:",
    Buffer.compare(intermediateKey4.privateKey, directKey.privateKey) === 0
  );

  // Create a new BIP32 node from the intermediate key
  const intermediateKey = bip32
    .BIP32Factory(tinySecp256k1)
    .fromPrivateKey(intermediateKey3.privateKey, intermediateKey3.chainCode);

  // Derive a child key: m/44'/0'/0'/0'
  const childKey = intermediateKey.deriveHardened(0);
  console.log("Child Private Key:", childKey.toWIF());
  console.log(
    "Child Public Key:",
    Buffer.from(childKey.publicKey).toString("hex")
  );
  console.log(
    "Keys match2:",
    Buffer.compare(childKey.privateKey, intermediateKey4.privateKey) === 0
  );

  // Derive another child key: m/44'/0'/0'/0'/1
  const anotherChildKey = childKey.deriveHardened(1);
  console.log("Another Child Private Key:", anotherChildKey.toWIF());
  console.log(
    "Another Child Public Key:",
    Buffer.from(anotherChildKey.publicKey).toString("hex")
  );
  const anotherDirectKey = root
    .deriveHardened(44)
    .deriveHardened(0)
    .deriveHardened(0)
    .deriveHardened(0)
    .deriveHardened(1);
  console.log(
    "Keys match3:",
    Buffer.compare(anotherDirectKey.privateKey, anotherDirectKey.privateKey) ===
      0
  );
};

export const fromWIF = (wif, hdWallet) => {
  const ECPair = ECPairFactory.ECPairFactory(tinySecp256k1);
  return ECPair.fromWIF(wif);
};
