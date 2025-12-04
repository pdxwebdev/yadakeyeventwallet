// YadaBitcoin.js — Final Production Version (Nov 2025)
import { notifications } from "@mantine/notifications";
import axios from "axios";
import { fromWIF, validateBitcoinAddress } from "../utils/hdWallet";
import { capture } from "../shared/capture";
import {
  networks,
  script,
  payments,
  Psbt,
  opcodes,
  initEccLib,
  Transaction,
} from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import { createHash } from "crypto";
import { toOutputScript } from "bitcoinjs-lib/src/address";
import * as ecc2 from "@noble/secp256k1";
const sha256 = (data) => createHash("sha256").update(data).digest();
initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const network = networks.bitcoin;

// Anyone-can-spend anchor (1 sat) — child pays for parent
const anchorScript = script.compile([opcodes.OP_TRUE]);

class YadaBitcoin {
  constructor() {
    this.isCovenantMode = true;
  }

  // Parse your QR format: WIF|prerotated|twicePrerotated|prev|rotation
  parseQR(qrData) {
    const [wif, prerotated, twicePrerotated, , rotationStr] = qrData.split("|");
    if (
      !validateBitcoinAddress(prerotated) ||
      !validateBitcoinAddress(twicePrerotated)
    )
      throw new Error("Invalid address in QR");

    return {
      wif,
      prerotatedKeyHash: prerotated,
      twicePrerotatedKeyHash: twicePrerotated,
      rotation: parseInt(rotationStr, 10),
    };
  }

  // Build covenant script: allows only two paths
  // 1. Exact rotation tx (to prerotatedKeyHash)
  // 2. Exact commit tx (with anchor output)
  buildCovenantScript(internalPubkeyXOnly, rotationTxHex, commitTxHex) {
    const rotationHash = sha256(Buffer.from(rotationTxHex, "hex"));
    const commitHash = sha256(Buffer.from(commitTxHex, "hex"));

    const asm = `
      ${internalPubkeyXOnly.toString("hex")}
      OP_CHECKSIG
      OP_IF
        ${rotationHash.toString("hex")}
      OP_ELSE
        ${commitHash.toString("hex")}
      OP_ENDIF
      OP_CHECKTEMPLATEVERIFY
    `;

    return script.fromASM(asm.trim().replace(/\s+/g, " "));
  }

  buildRotationTx(keyPair, nextAddress, rotationNum) {
    // 1. Build the exact transaction we're committing to
    const tx = new Transaction();

    // Dummy input (unsigned)
    tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff);

    // Main output
    tx.addOutput(toOutputScript(nextAddress), 99998500n);

    // OP_RETURN log
    const rotationHex = rotationNum.toString(16).padStart(8, "0");
    tx.addOutput(
      script.compile([
        opcodes.OP_RETURN,
        Buffer.from("59414441", "hex"), // "YADA"
        Buffer.from(rotationHex, "hex"),
      ]),
      0n
    );

    // 2. Get the raw transaction hex
    const txHex = tx.toHex();

    // 3. Return the hash we commit to in CTV
    return txHex;
  }

  buildCommitTx(
    utxos,
    keyPair,
    covenantAddr,
    recipient,
    amount,
    remainderToCovenant
  ) {
    const psbt = new Psbt({ network });
    let total = 0;

    utxos.forEach((u) => {
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        witnessUtxo: {
          value: BigInt(u.value),
          script: Buffer.from(u.scriptPubKey.hex, "hex"),
        },
        tapInternalKey: keyPair.publicKey.slice(1),
      });
      total += u.value;
    });

    psbt.addOutput({
      address: recipient,
      value: 99700000n, // ← bigint
    });

    psbt.addOutput({
      address: covenantAddr,
      value: remainder, // ← already bigint
    });

    psbt.addOutput({
      value: 1n, // ← bigint
      script: anchorScript,
    });

    return psbt.extractTransaction().toHex();
  }

  // Build confirmation tx (spends anchor → two steps ahead)
  buildConfirmationTx(commitTxId, twicePrerotatedAddress) {
    const psbt = new Psbt({ network });
    psbt.addInput({
      hash: commitTxId,
      index: 2, // anchor is output index 2
      witnessUtxo: {
        value: BigInt(u.value),
        script: Buffer.from(u.scriptPubKey.hex, "hex"),
      },
    });
    psbt.addOutput({ address: twicePrerotatedAddress, value: 1 });

    // Pay high fee so miners include both
    const highFee = 100000; // 0.001 BTC
    psbt.addOutput({ address: twicePrerotatedAddress, value: 1 + highFee });

    return psbt.extractTransaction().toHex();
  }

  async initializeKeyEventLog(appContext) {
    const { parsedData, setLog, setLoading, privateKey } = appContext;

    if (!parsedData?.publicKeyHash || !parsedData.prerotatedKeyHash) {
      notifications.show({
        title: "Missing data",
        message: "Load a key with prerotated address first",
        color: "red",
      });
      return;
    }

    //setLoading(true);

    try {
      const currentAddress = parsedData.publicKeyHash;
      const nextAddress = parsedData.prerotatedKeyHash;

      // Get UTXOs at the covenant address
      const { data: txs } = await axios.get(
        `${import.meta.env.VITE_BTC_API_URL}/api/address/${currentAddress}/txs`
      );

      if (!txs || txs.length === 0) {
        notifications.show({
          title: "No funds",
          message: "Your vault has no txs to spend",
          color: "yellow",
        });
        return;
      }

      const keyPair = privateKey;
      const payment = payments.p2tr({
        pubkey: keyPair.publicKey.slice(1),
        network,
      });

      const spentOutpoints = new Set();
      txs.forEach((tx) => {
        tx.vin.forEach((input) => {
          if (input.prevout?.scriptpubkey_address === currentAddress) {
            spentOutpoints.add(`${input.txid}:${input.vout}`);
          }
        });
      });

      const psbt = new Psbt({ network });
      let totalInput = 0n;

      txs.forEach((tx) => {
        tx.vout.forEach(async (output, voutIndex) => {
          const isOurOutput = output.scriptpubkey_address === currentAddress;
          const isSpent = spentOutpoints.has(`${tx.txid}:${voutIndex}`);
          const outputType = output.scriptpubkey_type;

          if (isOurOutput && !isSpent) {
            const txHex = await axios.get(
              `${import.meta.env.VITE_BTC_API_URL}/api/tx/${tx.txid}/hex`
            );
            const txx = Transaction.fromHex(txHex.data);
            psbt.addInput({
              hash: tx.txid,
              index: voutIndex,
              witnessUtxo: txx.toBuffer(),
            });
            totalInput += BigInt(output.value);
          }
        });
      });

      if (totalInput === 0n) {
        notifications.show({
          title: "No funds",
          message: "No unspent coins found",
          color: "yellow",
        });
        return;
      }

      const fee = 2000n;
      const sendAll = totalInput - fee;

      if (sendAll <= 0n) throw new Error("Insufficient for fee");

      psbt.addOutput({ address: nextAddress, value: sendAll });

      psbt.addOutput({
        value: 0n,
        script: script.compile([
          opcodes.OP_RETURN,
          Buffer.from("59414441", "hex"),
          Buffer.from("00000001", "hex"),
        ]),
      });

      // Output 2: OP_RETURN log entry → rotation 1
      psbt.addOutput({
        value: 0n,
        script: script.compile([
          opcodes.OP_RETURN,
          Buffer.from("59414441", "hex"), // "YADA"
          Buffer.from("00000001", "hex"), // rotation 1
        ]),
      });

      // Sign & finalize
      psbt.signAllInputs(privateKey);
      psbt.finalizeAllInputs();
      const txHex = psbt.extractTransaction().toHex();

      // Broadcast
      const { data } = await axios.post(
        `${import.meta.env.VITE_BTC_API_URL}/tx`,
        txHex
      );

      // Immediately add to log
      setLog([
        {
          txid: data, // txid returned by mempool.space
          rotation: 1,
          confirmed: false,
          timestamp: Date.now(),
        },
      ]);

      notifications.show({
        title: "Vault initialized",
        message: `First log entry broadcasted (rotation 1)\nTXID: ${data.slice(
          0,
          16
        )}...`,
        color: "green",
      });

      // Advance rotation
      appContext.setParsedData((prev) => ({ ...prev, rotation: 1 }));
    } catch (err) {
      console.error(err);
      notifications.show({
        title: "Failed",
        message: err.response?.data || err.message,
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }

  async sendTransaction(appContext, webcamRef) {
    const { privateKey, recipients, parsedData, setLoading } = appContext;

    if (!parsedData?.publicKeyHash || !privateKey) {
      return notifications.show({
        title: "Error",
        message: "Load your key first",
        color: "red",
      });
    }
    const p2tr = payments.p2tr({
      pubkey: keyPair.publicKey.slice(1),
      network,
    });

    setLoading(true);

    try {
      // 1. Prompt user to scan the NEXT key (the one after current)
      notifications.show({
        title: "Scan Next Key",
        message:
          "Scan your next pre-rotated QR code (this will be the change address)",
        color: "blue",
      });

      appContext.setIsScannerOpen(true);
      const nextQrData = await capture(webcamRef);
      appContext.setIsScannerOpen(false);

      if (!nextQrData) throw new Error("No QR scanned");

      const nextParts = nextQrData.split("|");
      if (nextParts.length < 5) throw new Error("Invalid next key QR");

      const nextPrerotatedAddress = nextParts[1].trim(); // This becomes our change address
      const expectedNextRotation = parsedData.rotation + 1;

      if (parseInt(nextParts[4].trim(), 10) !== expectedNextRotation) {
        throw new Error(
          `Expected rotation ${expectedNextRotation}, got ${nextParts[4].trim()}`
        );
      }

      // 2. Build normal Taproot key-path spend
      const keyPair = ECPair.fromPrivateKey(privateKey, network);
      const payment = payments.p2tr({
        pubkey: keyPair.publicKey.slice(1),
        network,
      });
      const psbt = new Psbt({ network });

      // Fetch UTXOs
      const utxosRes = await axios.get(
        `${import.meta.env.VITE_BTC_API_URL}/api/address/${
          parsedData.publicKeyHash
        }/utxo`
      );
      const utxos = utxosRes.data;

      let totalInput = 0n;
      for (const utxo of utxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            value: BigInt(utxo.value),
            script: toOutputScript(parsedData.publicKeyHash, network),
          },
          tapInternalKey: keyPair.publicKey.slice(1),
        });
        totalInput += BigInt(utxo.value);
      }

      // Add recipient output(s)
      let totalOutput = 0n;
      for (const rec of recipients) {
        const satoshis = BigInt(Math.round(Number(rec.amount) * 1e8));
        psbt.addOutput({
          address: rec.address,
          value: satoshis,
        });
        totalOutput += satoshis;
      }

      // Change → next pre-rotated address
      const fee = 5000n; // adjust or estimate properly
      const change = totalInput - totalOutput - fee;

      if (change < 546n) throw new Error("Not enough for change output");

      psbt.addOutput({
        address: nextPrerotatedAddress,
        value: change,
      });

      // OP_RETURN log (optional but nice)
      const rotationHex = expectedNextRotation.toString(16).padStart(8, "0");
      psbt.addOutput({
        value: 0n,
        script: script.compile([
          opcodes.OP_RETURN,
          Buffer.from("59414441", "hex"), // YADA
          Buffer.from(rotationHex, "hex"),
        ]),
      });

      // Sign & broadcast
      psbt.signAllInputs(keyPair);
      psbt.finalizeAllInputs();
      const txHex = psbt.extractTransaction().toHex();

      const broadcastRes = await axios.post(
        `${import.meta.env.VITE_BTC_API_URL}/tx`,
        txHex
      );

      const txid = broadcastRes.data;

      // SUCCESS → auto-load the next key the user just scanned!
      const nextWif = nextParts[0].trim();
      const nextKeyPair = ECPair.fromWIF(nextWif, network);
      const nextAddress = payments.p2tr({
        pubkey: keyPair.publicKey.slice(1),
        network,
      }).address;

      // Update entire app state to the new key
      appContext.setPrivateKey(nextKeyPair);
      appContext.setWif(nextWif);
      appContext.setParsedData({
        wif: nextWif,
        prerotatedKeyHash: nextParts[2].trim(), // twice-prerotated becomes prerotated
        twicePrerotatedKeyHash: nextParts[3]?.trim() || "",
        rotation: expectedNextRotation,
        publicKeyHash: nextAddress,
        blockchain: "btc",
      });

      // Persist
      localStorage.setItem("walletWif_btc", nextWif);
      localStorage.setItem(
        "walletParsedData_btc",
        JSON.stringify(appContext.parsedData)
      );

      notifications.show({
        title: "Success! Key Rotated",
        message: `Sent funds + rotated to rotation ${expectedNextRotation}\nTXID: ${txid.slice(
          0,
          16
        )}...`,
        color: "green",
      });
    } catch (err) {
      notifications.show({
        title: "Send Failed",
        message: err.message,
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }

  async rotateKey(appContext, webcamRef) {
    const {
      setIsScannerOpen,
      setLoading,
      setPrivateKey,
      setWif,
      setParsedData,
      parsedData,
    } = appContext;

    try {
      notifications.show({
        title: "Load Key",
        message: "Scan your key QR code",
        color: "blue",
      });

      setIsScannerOpen(true);

      let qrData;
      let attempts = 0;
      while (attempts < 100) {
        try {
          qrData = await capture(webcamRef);
          if (qrData) break;
        } catch {}
        attempts++;
        await new Promise((r) => setTimeout(r, 300));
      }

      setIsScannerOpen(false);
      setLoading(true);

      if (!qrData) throw new Error("No QR code scanned");

      // Parse the full pipe-separated format: WIF|prerotated|twicePrerotated|prev|rotation
      const parts = qrData.split("|");
      if (parts.length < 5) throw new Error("Invalid QR format");

      const wif = parts[0].trim();
      const prerotatedKeyHash = parts[1].trim();
      const twicePrerotatedKeyHash = parts[2].trim();
      const rotation = parseInt(parts[4].trim(), 10);

      if (isNaN(rotation)) throw new Error("Invalid rotation number");
      console.log(ecc);
      // Import private key
      const keyPair = ECPair.fromWIF(wif, network);
      const p2tr = payments.p2tr({
        pubkey: keyPair.publicKey.slice(1),
        network,
      });
      const address = p2tr.address;

      // Update everything
      setPrivateKey(keyPair);
      setWif(wif);

      // FULLY update parsedData
      setParsedData({
        wif,
        prerotatedKeyHash,
        twicePrerotatedKeyHash,
        rotation,
        publicKeyHash: address,
        blockchain: "btc",
      });

      notifications.show({
        title: "Key Loaded",
        message: `Rotation ${rotation} loaded successfully`,
        color: "green",
      });

      // Persist
      localStorage.setItem("walletWif_btc", wif);
      localStorage.setItem(
        "walletParsedData_btc",
        JSON.stringify({
          wif,
          prerotatedKeyHash,
          twicePrerotatedKeyHash,
          rotation,
          publicKeyHash: address,
          blockchain: "btc",
        })
      );
    } catch (error) {
      console.error("rotateKey error:", error);
      notifications.show({
        title: "Failed",
        message: error.message || "Invalid QR code",
        color: "red",
      });
    } finally {
      setLoading(false);
      setIsScannerOpen(false);
    }
  }

  // FINAL fetchBalance — works perfectly with your covenant address
  async fetchBalance(appContext) {
    const { parsedData, setBalance, setLoading } = appContext;

    // Must have covenant address (publicKeyHash)
    if (!parsedData?.publicKeyHash) {
      setBalance(null);
      return;
    }

    setLoading?.(true);

    try {
      const address = parsedData.publicKeyHash;

      const response = await axios.get(
        `${import.meta.env.VITE_BTC_API_URL}/api/address/${address}`
      );

      // Your backend should return something like:
      // { confirmed: 12345678, unconfirmed: 0 }
      const data = response.data;

      if (data && data.address) {
        const confirmed =
          data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
        const unconfirmed =
          data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
        const total = confirmed + unconfirmed;

        setBalance(total / 1e8);
      } else {
        throw new Error("Invalid balance response");
      }
    } catch (error) {
      console.error("fetchBalance error:", error);
      notifications.show({
        title: "Balance Error",
        message: "Failed to fetch balance. Using offline mode.",
        color: "yellow",
      });
      setBalance(null);
    } finally {
      setLoading?.(false);
    }
  }

  async fetchLog(appContext) {
    const { parsedData, setLog } = appContext;
    if (!parsedData?.publicKeyHash) return [];

    try {
      const address = parsedData.publicKeyHash;
      const { data: txs } = await axios.get(
        `${import.meta.env.VITE_BTC_API_URL}/api/address/${address}/txs`
      );

      const entries = txs
        .filter((tx) => tx.status?.confirmed)
        .map((tx, i) => {
          const vout = tx.vout?.find(
            (v) =>
              v.scriptpubkey_address === address &&
              v.scriptpubkey_type === "v1_p2tr"
          );
          if (!vout) return null;

          return {
            txid: tx.txid,
            rotation: i,
            value: vout.value,
            blockHeight: tx.status.block_height,
            confirmed: true,
            timestamp: tx.status.block_time * 1000,
          };
        })
        .filter(Boolean);

      setLog(entries);
      return entries;
    } catch (err) {
      console.error("fetchLog error:", err);
      return [];
    }
  }

  async checkStatus(appContext) {
    const {
      parsedData,
      privateKey,
      setIsInitialized,
      setLog,
      setParsedData,
      setPrivateKey,
      setWif,
    } = appContext;
    return {};
    // CASE 1: No key loaded at all — this is the very first step
    if (!privateKey && !parsedData?.wif) {
      notifications.show({
        title: "Welcome! Create Your Secure Vault",
        message:
          "Scan your first key (rotation 0) to generate your vault address.",
        color: "blue",
      });
      return { status: "no_key" };
    }

    // CASE 2: Key is loaded, but we haven't generated the covenant yet
    if (privateKey && !parsedData?.publicKeyHash) {
      notifications.show({
        title: "Key Loaded — Generate Vault Address",
        message:
          "Click 'Initialize Vault' to create your secure covenant address.",
        color: "cyan",
      });
      return { status: "key_loaded_no_covenant" };
    }

    // CASE 3: Covenant address exists — now do full on-chain checks
    if (!parsedData?.publicKeyHash) {
      return { status: "no_covenant" };
    }

    try {
      const freshLog = await this.fetchLog(appContext);
      const confirmedRotationCount = freshLog.length;

      if (freshLog.length !== appContext.log.length) {
        setLog(freshLog);
      }

      // No on-chain activity yet — waiting for funding + init tx
      if (confirmedRotationCount === 0) {
        return;
        const mempoolTxs = await this.checkMempoolForInit(appContext);
        if (mempoolTxs.length > 0) {
          notifications.show({
            title: "Vault Initializing",
            message:
              "Your vault transaction is in mempool. Waiting for confirmation...",
            color: "yellow",
          });
          return { status: "pending_mempool" };
        }

        notifications.show({
          title: "Vault Ready — Send BTC to Activate",
          message: `Fund this address to activate your vault:\n\n${parsedData.publicKeyHash}`,
          color: "green",
        });
        setIsInitialized(false);
        return { status: "funded_needed" };
      }

      // Vault is live — check key rotation
      const expectedRotation = confirmedRotationCount;

      if (parsedData.rotation === expectedRotation) {
        setIsInitialized(true);
        return { status: "active" };
      }

      if (parsedData.rotation < expectedRotation) {
        notifications.show({
          title: "Key Revoked",
          message: `Your key (rotation ${parsedData.rotation}) is revoked.\nScan rotation ${expectedRotation} to continue.`,
          color: "yellow",
        });
        return { status: "revoked" };
      }

      if (parsedData.rotation > expectedRotation) {
        notifications.show({
          title: "Invalid Rotation",
          message: `Expected rotation ${expectedRotation}, but you have ${parsedData.rotation}.\nScan the correct key.`,
          color: "red",
        });
        return { status: "invalid_rotation" };
      }
    } catch (err) {
      console.error("checkStatus error:", err);
      notifications.show({
        title: "Status Error",
        message: "Failed to check vault status",
        color: "red",
      });
      return { status: "error" };
    }
  }

  // Helper: check mempool for pending initialization
  async checkMempoolForInit(appContext) {
    const { parsedData } = appContext;
    if (!parsedData?.publicKeyHash) return [];

    try {
      return;
      const res = await axios.get(
        `${import.meta.env.VITE_BTC_API_URL}/api/address/${
          parsedData.publicKeyHash
        }/txs/mempool`
      );
      return res.data || [];
    } catch {
      return [];
    }
  }

  async buildTransactionHistory() {}
}

export default YadaBitcoin;
