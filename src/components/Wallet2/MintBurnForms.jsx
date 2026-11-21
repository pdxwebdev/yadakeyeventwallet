import {
  Badge,
  Button,
  Group,
  TextInput,
  ActionIcon,
  Stack,
  FileButton,
  Text,
  Divider,
  Table,
  Anchor,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import axios from "axios";
import React from "react";
import { IconCopy, IconTrash, IconUpload } from "@tabler/icons-react";
import AmountInput from "./AmountInput";
import { generateSHA256, getP2PKH } from "../../utils/hdWallet";
import { BRIDGE_ABI, baseAddresses, localProvider } from "../../shared/constants";
import YadaCoin from "../../blockchains/YadaCoin";

function loadStoredUnwraps() {
  try {
    const rows = JSON.parse(localStorage.getItem(UNWRAP_STORAGE_KEY) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function loadUnwrapAttempts() {
  try {
    const rows = JSON.parse(
      localStorage.getItem(UNWRAP_ATTEMPTS_KEY) || "{}"
    );
    return rows && typeof rows === "object" ? rows : {};
  } catch {
    return {};
  }
}

function saveUnwrapAttempt(baseTxHash, attempt) {
  if (!baseTxHash) return;
  try {
    const rows = loadUnwrapAttempts();
    rows[String(baseTxHash).toLowerCase()] = attempt;
    localStorage.setItem(UNWRAP_ATTEMPTS_KEY, JSON.stringify(rows));
  } catch {
    // storage unavailable
  }
}

function permitAmount(value) {
  try {
    return ethers.formatUnits(value || "0", 6);
  } catch {
    return value;
  }
}

const WRAP_ADDRESS = "16U1gAmHazqqEkbRE9KFPShAperjJreMRA";
const WRAP_START_HEIGHT = 620273;
const BASE_BRIDGE_START_BLOCK = 56248238;
const UNWRAP_STORAGE_KEY = "pendingYadaUnwraps";
const UNWRAP_ATTEMPTS_KEY = "yadaUnwrapAttempts";
const LOG_SPAN = 90000;
const baseLogProvider = new ethers.JsonRpcProvider(
  "https://base.rpc.blxrbdn.com",
  8453,
  { staticNetwork: true }
);
const FULFILLED_KEY = "yadaWrapFulfilled";

const loadFulfilled = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FULFILLED_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

const saveFulfilled = (ids) => {
  localStorage.setItem(FULFILLED_KEY, JSON.stringify([...ids]));
};

const BURN_CACHE_KEY = "yadaWydaBurnLogCache";
const LOG_CONCURRENCY = 6;
const BURN_CONFIRMATIONS = 64;

const loadBurnCache = (key) => {
  try {
    const cache = JSON.parse(localStorage.getItem(BURN_CACHE_KEY) || "null");
    return cache && cache.key === key && Array.isArray(cache.rows) ? cache : null;
  } catch {
    return null;
  }
};

const saveBurnCache = (cache) => {
  try {
    localStorage.setItem(BURN_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable
  }
};

const toBurnRow = (log) => ({
  id: `${log.transactionHash}-${log.index}`,
  txHash: log.transactionHash,
  blockNumber: log.blockNumber,
  index: log.index,
  destination: log.args.bitcoinAddress,
  amount: log.args.amount.toString(),
});

const fetchLogRange = async (contract, filter, from, to) => {
  if (from > to) return [];
  const ranges = [];
  for (let start = from; start <= to; start += LOG_SPAN) {
    ranges.push([start, Math.min(start + LOG_SPAN - 1, to)]);
  }
  const results = new Array(ranges.length);
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const index = next++;
      const [rangeFrom, rangeTo] = ranges[index];
      results[index] = await contract.queryFilter(filter, rangeFrom, rangeTo);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LOG_CONCURRENCY, ranges.length) }, worker)
  );
  return results.flat();
};

const TokenManagementForm = ({
  walletManager,
  appContext,
  webcamRef,
  tokenSymbol,
  wrappedTokenSymbol,
  styles,
  unwrapOnly = false,
}) => {
  const { selectedToken } = appContext;

  const [mintEntries, setMintEntries] = React.useState([
    { id: "1", address: "", amount: "", yadaTxnId: "" },
  ]);
  const [wrapRequests, setWrapRequests] = React.useState([]);
  const [wrapLoading, setWrapLoading] = React.useState(false);
  const [unwrapRequests, setUnwrapRequests] = React.useState([]);
  const [permitRequests, setPermitRequests] = React.useState([]);
  const [swapLoading, setSwapLoading] = React.useState(false);
  const [unwrapLoading, setUnwrapLoading] = React.useState(false);
  const [unwrappingId, setUnwrappingId] = React.useState(null);
  const [permitBusyId, setPermitBusyId] = React.useState(null);

  const [burnEntries, setBurnEntries] = React.useState([
    { id: "1", address: "", amount: "" },
  ]);

  // Mint operations
  const addMintEntry = () => {
    setMintEntries([
      ...mintEntries,
      { id: Date.now().toString(), address: "", amount: "", yadaTxnId: "" },
    ]);
  };

  const removeMintEntry = (id) => {
    if (mintEntries.length > 1) {
      setMintEntries(mintEntries.filter((e) => e.id !== id));
    }
  };

  const updateMintEntry = (id, field, value) => {
    setMintEntries(
      mintEntries.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const handleMintCsvImport = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);
      const newEntries = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(",");
        if (parts.length < 2) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid line ${i + 1}: expected "address,amount"`,
            color: "red",
          });
          return;
        }

        let address = parts[0].trim().replace(/^["']|["']$/g, "");
        let amount = parts[1].trim().replace(/^["']|["']$/g, "");

        if (!ethers.isAddress(address)) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid address on line ${i + 1}: ${address}`,
            color: "red",
          });
          return;
        }

        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid amount on line ${i + 1}: ${amount}`,
            color: "red",
          });
          return;
        }

        newEntries.push({
          id: Date.now().toString() + i,
          address,
          amount,
          yadaTxnId: "",
        });
      }

      if (newEntries.length === 0) {
        notifications.show({
          title: "CSV Error",
          message: "No valid entries found in CSV",
          color: "red",
        });
        return;
      }

      setMintEntries(newEntries);
      notifications.show({
        title: "Success",
        message: `Imported ${newEntries.length} recipients from CSV`,
        color: "green",
      });
    };

    reader.readAsText(file);
  };

  const loadWrapRequests = async () => {
    setWrapLoading(true);
    try {
      const res = await axios.get(
        `${import.meta.env.VITE_API_URL}/explorer-search?term=${WRAP_ADDRESS}`
      );
      const blocks = Array.isArray(res.data?.result) ? res.data.result : [];
      const fulfilled = loadFulfilled();
      const requests = [];
      for (const block of blocks) {
        if (Number(block.index) < WRAP_START_HEIGHT) continue;
        for (const txn of block.transactions || []) {
          let senderAddress = "";
          try {
            senderAddress = getP2PKH(Buffer.from(txn.public_key, "hex"));
          } catch {
            senderAddress = "";
          }
          if (senderAddress === WRAP_ADDRESS) continue;
          const paid = (txn.outputs || []).find(
            (output) =>
              output.to === WRAP_ADDRESS && Number(output.value) > 0
          );
          if (!paid) continue;
          if (!ethers.isAddress(txn.relationship || "")) continue;
          requests.push({
            id: txn.id,
            block: block.index,
            destination: txn.relationship,
            amount: String(paid.value),
            fulfilled: fulfilled.has(txn.id),
          });
        }
      }
      const bridgeAddress = appContext.contractAddresses?.bridgeAddress;
      if (bridgeAddress) {
        const bridge = new ethers.Contract(
          bridgeAddress,
          ["function isYadaWrapFulfilled(string) view returns (bool)"],
          localProvider
        );
        await Promise.all(
          requests.map(async (request) => {
            try {
              if (await bridge.isYadaWrapFulfilled(request.id)) {
                request.fulfilled = true;
                fulfilled.add(request.id);
              }
            } catch {
              // current bridge has no fulfillment record yet
            }
          })
        );
        saveFulfilled(fulfilled);
      }
      setWrapRequests(requests);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to load wrap requests",
        color: "red",
      });
    } finally {
      setWrapLoading(false);
    }
  };

  const loadPermitRequests = async () => {
    try {
      const permitRes = await axios.get("http://localhost:8111/crypto-onramp/pending-permits");
      setPermitRequests(Array.isArray(permitRes.data?.permits) ? permitRes.data.permits : []);
    } catch {
      setPermitRequests([]);
    }
  };

  const quoteMinOut = async (amount) => {
    const pool = new ethers.Contract(
      baseAddresses.poolAddress,
      ["function reserveUsdc() view returns (uint256)", "function reserveWyda() view returns (uint256)"],
      localProvider
    );
    const reserveUsdc = await pool.reserveUsdc();
    const reserveWyda = await pool.reserveWyda();
    if (reserveUsdc === 0n || reserveWyda === 0n) return 0n;
    return ((reserveWyda * amount) / (reserveUsdc + amount)) * 99n / 100n;
  };

  const swapPermit = async (request) => {
    if (!appContext.privateKey?.privateKey) {
      throw new Error("Scan the bridge owner key first");
    }
    if (!request.yadacoin_address) {
      throw new Error("Missing Yadacoin address");
    }
    const code = await localProvider.getCode(baseAddresses.bridgeAddress);
    const selector = ethers.id("relaySwap(address,address,address,address,uint256,uint256,uint256,uint8,bytes32,bytes32,string)").slice(2, 10);
    if (!code.toLowerCase().includes(selector)) {
      throw new Error("Deployed bridge has no relaySwap. These permits can only be spent by that bridge.");
    }
    const signer = new ethers.Wallet(
      ethers.hexlify(appContext.privateKey.privateKey),
      localProvider
    );
    const bridge = new ethers.Contract(
      baseAddresses.bridgeAddress,
      ["function relaySwap(address,address,address,address,uint256,uint256,uint256,uint8,bytes32,bytes32,string)"],
      signer
    );
    const amount = BigInt(request.value);
    const tx = await bridge.relaySwap(
      baseAddresses.usdcAddress,
      baseAddresses.poolAddress,
      baseAddresses.yadaERC20Address,
      request.wallet_address,
      amount,
      await quoteMinOut(amount),
      request.deadline,
      request.v,
      request.r,
      request.s,
      request.yadacoin_address
    );
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error("relaySwap failed");
    await axios.post("http://localhost:8111/crypto-onramp/pending-swap", {
      session_id: request.session_id,
      status: "fulfilled",
    });
    const topic = ethers.id("BurnForYadaCoinWithdrawal(address,address,uint256,string)");
    const burned = receipt.logs.find((log) => log.topics[0] === topic);
    const ydaAmount = burned
      ? ethers.formatUnits(BigInt(burned.topics[3]), 18)
      : "0";
    const saved = loadStoredUnwraps().filter((row) => row.txHash !== receipt.hash);
    saved.unshift({
      id: receipt.hash,
      txHash: receipt.hash,
      explorer: `https://basescan.org/tx/${receipt.hash}`,
      destination: request.yadacoin_address,
      amount: ydaAmount,
      fulfilled: false,
      inMempool: false,
    });
    localStorage.setItem(UNWRAP_STORAGE_KEY, JSON.stringify(saved.slice(0, 50)));
    return {
      hash: receipt.hash,
      ydaAmount,
    };
  };

  const unwrapToYada = async (address, amount, relationship) => {
    if (!address || !amount || Number(amount) <= 0) {
      throw new Error("Nothing to unwrap");
    }
    await new YadaCoin().signTransaction(appContext, webcamRef, {
      recipients: [{ address, amount }],
      relationship,
      useStoredYadaKey: true,
    });
  };

  const swapPermits = async (requests) => {
    setSwapLoading(true);
    const failed = [];
    let swapped = 0;
    const used = new Set();
    const ordered = [...requests].sort((a, b) => {
      try {
        const left = BigInt(a.value || "0");
        const right = BigInt(b.value || "0");
        return left < right ? 1 : left > right ? -1 : 0;
      } catch {
        return 0;
      }
    });
    try {
      for (const request of ordered) {
        const wallet = String(request.wallet_address || "").toLowerCase();
        if (used.has(wallet + ":" + (request.nonce || request.value))) {
          await axios.post("http://localhost:8111/crypto-onramp/pending-swap", {
            session_id: request.session_id,
            status: "fulfilled",
          });
          continue;
        }
        try {
          await swapPermit(request);
          swapped += 1;
          if (request.nonce) used.add(wallet + ":" + request.nonce);
        } catch (error) {
          failed.push(error.shortMessage || error.message);
        }
      }
      await loadPermitRequests();
      notifications.show({
        title: failed.length ? "Swap finished with errors" : "Swap finished",
        message: `${swapped} swapped${failed.length ? `, ${failed.length} failed: ${failed[0]}` : ""}`,
        color: failed.length ? "yellow" : "green",
      });
    } finally {
      setSwapLoading(false);
    }
  };

  const loadUnwrapRequests = async () => {
    setUnwrapLoading(true);
    try {
      const bridgeAddress = baseAddresses.bridgeAddress;
      if (!bridgeAddress) {
        setUnwrapRequests([]);
        return;
      }
      const explorer = "https://basescan.org";
      const logProvider = baseLogProvider;
      const wydaAddress = baseAddresses.yadaERC20Address;
      const latest = await logProvider.getBlockNumber();
      const cacheKey = `${bridgeAddress.toLowerCase()}:${wydaAddress.toLowerCase()}`;
      const cache = loadBurnCache(cacheKey);
      const defaultStart = Math.max(
        0,
        Math.min(
          BASE_BRIDGE_START_BLOCK > latest
            ? latest - 500000
            : BASE_BRIDGE_START_BLOCK,
          latest - 500000
        )
      );
      const start = cache ? cache.toBlock + 1 : defaultStart;
      const bridge = new ethers.Contract(bridgeAddress, BRIDGE_ABI, logProvider);
      const filter = bridge.filters.BurnForYadaCoinWithdrawal(null, wydaAddress);
      const fresh = (await fetchLogRange(bridge, filter, start, latest)).map(toBurnRow);
      const finalizedTo = latest - BURN_CONFIRMATIONS;
      const newlyFinal = fresh.filter((row) => row.blockNumber <= finalizedTo);
      const cachedRows = cache ? cache.rows : [];
      const cacheToBlock = Math.max(finalizedTo, cache ? cache.toBlock : -1);
      if (cacheToBlock > (cache ? cache.toBlock : -1)) {
        saveBurnCache({
          key: cacheKey,
          toBlock: cacheToBlock,
          rows: [...cachedRows, ...newlyFinal],
        });
      }
      const burnRows = new Map();
      for (const row of [...cachedRows, ...fresh]) burnRows.set(row.id, row);
      const requests = [...burnRows.values()]
        .sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)
        .map((row) => ({
          id: row.id,
          txHash: row.txHash,
          explorer: `${explorer}/tx/${row.txHash}`,
          destination: row.destination,
          amount: ethers.formatUnits(row.amount, 18),
          fulfilled: false,
          inMempool: false,
          failed: false,
        }))
        .reverse();
      const byAddress = new Map();
      for (const request of requests) {
        const address = request.destination;
        if (!address) continue;
        if (!byAddress.has(address)) byAddress.set(address, []);
        byAddress.get(address).push(request);
      }
      await Promise.all(
        [...byAddress.entries()].map(async ([address, addressRequests]) => {
          const bases = [import.meta.env.VITE_API_URL || ""];
          const paidRelationships = new Map();
          const mempoolRelationships = new Map();
          const failedRelationships = new Set();
          const reportedRelationships = new Set();
          const setPaid = (bucket, relationship, txnId) => {
            const key = String(relationship).toLowerCase();
            if (txnId) {
              bucket.set(key, txnId);
            } else if (!bucket.has(key)) {
              bucket.set(key, null);
            }
          };
          const addPaid = (txn, bucket) => {
            const paid = (txn.outputs || []).some(
              (output) => output.to === address && Number(output.value) > 0
            );
            if (paid && txn.relationship) {
              setPaid(bucket, txn.relationship, txn.id);
            }
          };
          const addFailed = (row) => {
            const txn = row?.txn || row;
            if (txn?.relationship) {
              failedRelationships.add(String(txn.relationship).toLowerCase());
            }
          };
          await Promise.all(
            [...new Set(bases)].map(async (base) => {
              try {
                const res = await axios.get(
                  `${base}/unwrap-fulfillment?address=${encodeURIComponent(address)}`
                );
                (res.data?.relationships || []).forEach((rel) => {
                  if (rel) reportedRelationships.add(String(rel).toLowerCase());
                });
              } catch {
                // endpoint is not deployed on this node
              }
              try {
                const res = await axios.get(
                  `${base}/explorer-search?term=${encodeURIComponent(address)}`
                );
                const blocks = Array.isArray(res.data?.result) ? res.data.result : [];
                const resultType = String(res.data?.resultType || "");
                if (resultType.startsWith("failed")) {
                  blocks.forEach(addFailed);
                } else if (resultType === "mempool_outputs_to") {
                  blocks.forEach((txn) => addPaid(txn, mempoolRelationships));
                } else {
                  for (const block of blocks) {
                    for (const txn of block.transactions || []) addPaid(txn, paidRelationships);
                  }
                }
              } catch {
                // address has no explorer result on this node
              }
              try {
                const res = await axios.get(`${base}/get-mempool?page_size=100`);
                (res.data?.transactions || []).forEach((txn) =>
                  addPaid(txn, mempoolRelationships)
                );
              } catch {
                // mempool endpoint unavailable
              }
            })
          );
          for (const relationship of reportedRelationships) {
            if (!mempoolRelationships.has(relationship)) {
              setPaid(paidRelationships, relationship, null);
            }
          }
          for (const request of addressRequests) {
            const hash = request.txHash.toLowerCase();
            const bare = hash.replace(/^0x/, "");
            const payoutTxnId =
              paidRelationships.get(hash) || paidRelationships.get(bare) || null;
            const mempoolTxnId =
              mempoolRelationships.get(hash) ||
              mempoolRelationships.get(bare) ||
              null;
            request.fulfilled =
              paidRelationships.has(hash) || paidRelationships.has(bare);
            request.inMempool =
              !request.fulfilled &&
              (mempoolRelationships.has(hash) || mempoolRelationships.has(bare));
            const linkedTxnId = request.fulfilled
              ? payoutTxnId
              : request.inMempool
              ? mempoolTxnId
              : null;
            request.fulfillTxId = linkedTxnId;
            request.fulfillExplorer = linkedTxnId
              ? `${
                  import.meta.env.VITE_API_URL || ""
                }/explorer?term=${encodeURIComponent(linkedTxnId)}`
              : null;
            if (
              !request.fulfilled &&
              !request.inMempool &&
              (failedRelationships.has(hash) || failedRelationships.has(bare))
            ) {
              request.failed = true;
              request.failureReason =
                request.failureReason || "YadaCoin transaction was rejected";
            }
          }
        })
      );
      const seen = new Set(requests.map((request) => request.txHash.toLowerCase()));
      const stored = loadStoredUnwraps().filter(
        (request) => request.txHash && !seen.has(request.txHash.toLowerCase())
      );
      const merged = [...stored, ...requests];
      const attempts = loadUnwrapAttempts();
      const explorerBase = import.meta.env.VITE_API_URL || "";
      for (const request of merged) {
        const attempt = attempts[String(request.txHash).toLowerCase()];
        const attemptTxnId = attempt?.actionId || attempt?.actionHash;
        if (!attemptTxnId) continue;
        request.attemptTxId = attemptTxnId;
        if (request.fulfilled || request.inMempool) {
          const txnId = request.fulfillTxId || attemptTxnId;
          request.fulfillExplorer = `${explorerBase}/explorer?term=${encodeURIComponent(
            txnId
          )}`;
        }
      }
      await Promise.all(
        merged
          .filter((request) => !request.fulfilled && !request.inMempool)
          .map(async (request) => {
            const attempt = attempts[String(request.txHash).toLowerCase()];
            if (!attempt) return;
            const term = attempt.actionId || attempt.actionHash;
            if (!term) return;
            try {
              const res = await axios.get(
                `${import.meta.env.VITE_API_URL || ""}/explorer-search?term=${encodeURIComponent(
                  term
                )}`
              );
              const resultType = String(res.data?.resultType || "");
              if (resultType.startsWith("failed")) {
                request.failed = true;
                request.failureReason =
                  (Array.isArray(res.data.result) &&
                    res.data.result[0]?.reason) ||
                  "Transaction rejected by the node";
              }
            } catch {
              // node does not expose the failed txn (yet)
            }
          })
      );
      await Promise.all(
        merged
          .filter(
            (request) =>
              request.fulfilled && !request.fulfillExplorer && request.txHash
          )
          .map(async (request) => {
            const bare = String(request.txHash)
              .toLowerCase()
              .replace(/^0x/, "");
            for (const relationship of [request.txHash, bare]) {
              try {
                const digest = await generateSHA256(String(relationship));
                const res = await axios.get(
                  `${explorerBase}/explorer-search?term=${digest}`
                );
                const blocks = Array.isArray(res.data?.result)
                  ? res.data.result
                  : [];
                for (const block of blocks) {
                  for (const txn of block.transactions || []) {
                    const rel = String(txn.relationship || "")
                      .toLowerCase()
                      .replace(/^0x/, "");
                    if (rel && rel === bare && txn.id) {
                      request.fulfillTxId = txn.id;
                      request.fulfillExplorer = `${explorerBase}/explorer?term=${encodeURIComponent(
                        txn.id
                      )}`;
                      return;
                    }
                  }
                }
              } catch {
                // payout txn is not resolvable on this node
              }
            }
          })
      );
      const stillOpen = merged.filter((request) => !request.fulfilled);
      localStorage.setItem(UNWRAP_STORAGE_KEY, JSON.stringify(stillOpen.slice(0, 50)));
      setUnwrapRequests(merged);
      await loadPermitRequests();
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to load unwrap requests",
        color: "red",
      });
    } finally {
      setUnwrapLoading(false);
    }
  };

  React.useEffect(() => {
    loadWrapRequests();
    loadUnwrapRequests();
  }, []);

  const handleMint = async () => {
    const validEntries = mintEntries.filter(
      (e) =>
        ethers.isAddress(e.address) &&
        e.amount &&
        !isNaN(parseFloat(e.amount)) &&
        parseFloat(e.amount) > 0
    );

    if (validEntries.length === 0) {
      notifications.show({
        title: "Error",
        message: "At least one valid recipient and amount is required",
        color: "red",
      });
      return;
    }

    try {
      await walletManager.mintTokens(
        appContext,
        webcamRef,
        selectedToken,
        validEntries
      );

      notifications.show({
        title: "Success",
        message: `Successfully minted to ${validEntries.length} recipient(s) in one transaction!`,
        color: "green",
      });

      const fulfilled = loadFulfilled();
      validEntries.forEach((entry) => {
        if (entry.yadaTxnId) fulfilled.add(entry.yadaTxnId);
      });
      saveFulfilled(fulfilled);
      setMintEntries([{ id: "1", address: "", amount: "", yadaTxnId: "" }]);
      await loadWrapRequests();
      await walletManager.fetchBalance(appContext);
      await walletManager.buildTransactionHistory(appContext);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to mint tokens",
        color: "red",
      });
    }
  };

  // Burn operations
  const addBurnEntry = () => {
    setBurnEntries([
      ...burnEntries,
      { id: Date.now().toString(), address: "", amount: "" },
    ]);
  };

  const removeBurnEntry = (id) => {
    if (burnEntries.length > 1) {
      setBurnEntries(burnEntries.filter((e) => e.id !== id));
    }
  };

  const updateBurnEntry = (id, field, value) => {
    setBurnEntries(
      burnEntries.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const handleBurnCsvImport = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);
      const newEntries = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(",");
        if (parts.length < 2) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid line ${i + 1}: expected "address,amount"`,
            color: "red",
          });
          return;
        }

        let address = parts[0].trim().replace(/^["']|["']$/g, "");
        let amount = parts[1].trim().replace(/^["']|["']$/g, "");

        if (!ethers.isAddress(address)) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid address on line ${i + 1}: ${address}`,
            color: "red",
          });
          return;
        }

        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid amount on line ${i + 1}: ${amount}`,
            color: "red",
          });
          return;
        }

        newEntries.push({
          id: Date.now().toString() + i,
          address,
          amount,
        });
      }

      if (newEntries.length === 0) {
        notifications.show({
          title: "CSV Error",
          message: "No valid entries found in CSV",
          color: "red",
        });
        return;
      }

      setBurnEntries(newEntries);
      notifications.show({
        title: "Success",
        message: `Imported ${newEntries.length} accounts from CSV`,
        color: "green",
      });
    };

    reader.readAsText(file);
  };

  const handleBurn = async () => {
    const validEntries = burnEntries.filter(
      (e) =>
        ethers.isAddress(e.address) &&
        e.amount &&
        !isNaN(parseFloat(e.amount)) &&
        parseFloat(e.amount) > 0
    );

    if (validEntries.length === 0) {
      notifications.show({
        title: "Error",
        message: "At least one valid account and amount is required",
        color: "red",
      });
      return;
    }

    try {
      await walletManager.burnTokens(
        appContext,
        webcamRef,
        selectedToken,
        validEntries
      );

      notifications.show({
        title: "Success",
        message: `Successfully burned from ${validEntries.length} account(s) in one transaction!`,
        color: "green",
      });

      setBurnEntries([{ id: "1", address: "", amount: "" }]);
      await walletManager.fetchBalance(appContext);
      await walletManager.buildTransactionHistory(appContext);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to burn tokens",
        color: "red",
      });
    }
  };

  const isMintDisabled =
    !selectedToken ||
    mintEntries.every(
      (e) => !e.address || !e.amount || parseFloat(e.amount || "0") <= 0
    );

  const isBurnDisabled =
    !selectedToken ||
    burnEntries.every(
      (e) => !e.address || !e.amount || parseFloat(e.amount || "0") <= 0
    );

  return (
    <Stack gap="lg">
      {!unwrapOnly && (
      <div>
        <Text size="sm" fw={500} mb="md">
          YadaCoin wrap requests
        </Text>
        <Group justify="space-between" mb="sm">
          <Text size="xs" c="dimmed">
            Deposits to {WRAP_ADDRESS} from block {WRAP_START_HEIGHT}. The explorer returns the latest blocks that touch this address.
          </Text>
          <Button variant="outline" onClick={loadWrapRequests} loading={wrapLoading}>
            Refresh
          </Button>
        </Group>
        <Table striped highlightOnHover mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Txn</Table.Th>
              <Table.Th>Destination</Table.Th>
              <Table.Th>Amount</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {wrapRequests.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text size="sm" c="dimmed">
                    {wrapLoading ? "Loading..." : "No wrap requests in range"}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              wrapRequests.map((request) => (
                <Table.Tr key={request.id}>
                  <Table.Td>
                    <Anchor
                      href={`${import.meta.env.VITE_API_URL}/explorer?term=${encodeURIComponent(request.id)}`}
                      target="_blank"
                      size="sm"
                    >
                      {request.id.slice(0, 12)}...
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{request.destination}</Text>
                  </Table.Td>
                  <Table.Td>{request.amount}</Table.Td>
                  <Table.Td>
                    {request.fulfilled ? (
                      <Anchor
                        href={`${import.meta.env.VITE_API_URL}/explorer?term=${encodeURIComponent(request.id)}`}
                        target="_blank"
                      >
                        <Badge color="green">Fulfilled</Badge>
                      </Anchor>
                    ) : (
                      <Badge color="yellow">Pending</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      disabled={request.fulfilled}
                      onClick={() =>
                        setMintEntries([
                          {
                            id: request.id,
                            address: request.destination,
                            amount: request.amount,
                            yadaTxnId: request.id,
                          },
                        ])
                      }
                    >
                      Mint
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
        <Group justify="space-between" mb="sm">
          <Text size="sm" fw={500}>
            Signed swap permits
          </Text>
          <Button
            size="xs"
            disabled={permitRequests.length === 0}
            loading={swapLoading}
            onClick={() => swapPermits(permitRequests)}
          >
            Swap all
          </Button>
        </Group>
        <Table striped highlightOnHover mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>YadaCoin address</Table.Th>
              <Table.Th>USDC</Table.Th>
              <Table.Th>Wallet</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {permitRequests.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text size="sm" c="dimmed">No signed permits</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              permitRequests.map((request) => (
                <Table.Tr key={request.session_id}>
                  <Table.Td><Text size="xs">{request.yadacoin_address}</Text></Table.Td>
                  <Table.Td>{permitAmount(request.value)}</Table.Td>
                  <Table.Td><Text size="xs">{request.wallet_address}</Text></Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        loading={permitBusyId === request.session_id}
                        disabled={
                          permitBusyId !== null &&
                          permitBusyId !== request.session_id
                        }
                        onClick={async () => {
                          setPermitBusyId(request.session_id);
                          try {
                            await swapPermits([request]);
                          } finally {
                            setPermitBusyId(null);
                          }
                        }}
                      >
                        Swap
                      </Button>
                      <Button
                        size="xs"
                        loading={permitBusyId === request.session_id}
                        disabled={
                          permitBusyId !== null &&
                          permitBusyId !== request.session_id
                        }
                        onClick={async () => {
                          setPermitBusyId(request.session_id);
                          try {
                            const yada = new YadaCoin();
                            const scanned = await yada.signTransaction(
                              appContext,
                              webcamRef,
                              { useStoredYadaKey: true, scanOnly: true }
                            );
                            const swapped = await swapPermit(request);
                            await yada.signTransaction(appContext, webcamRef, {
                              recipients: [
                                {
                                  address: request.yadacoin_address,
                                  amount: swapped.ydaAmount,
                                },
                              ],
                              relationship: swapped.hash,
                              useStoredYadaKey: true,
                              scanned,
                            });
                            await loadPermitRequests();
                            notifications.show({
                              title: "Swap and unwrap submitted",
                              message: swapped.hash,
                              color: "green",
                            });
                          } catch (error) {
                            notifications.show({
                              title: "Swap and unwrap failed",
                              message: error.shortMessage || error.message,
                              color: "red",
                            });
                          } finally {
                            setPermitBusyId(null);
                          }
                        }}
                      >
                        Swap & Unwrap
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </div>
      )}
        <Text size="sm" fw={500} mb="md">
          Pending unwrap requests
        </Text>
        <Group justify="space-between" mb="sm">
          <Text size="xs" c="dimmed">
            Burn already happened. A payout is fulfilled when its YadaCoin relationship is the Base tx id.
          </Text>
          <Button variant="outline" onClick={loadUnwrapRequests} loading={unwrapLoading}>
            Refresh
          </Button>
        </Group>
        <Table striped highlightOnHover mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Txn</Table.Th>
              <Table.Th>Destination</Table.Th>
              <Table.Th>Amount</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {unwrapRequests.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text size="sm" c="dimmed">
                    {unwrapLoading ? "Loading..." : "No unwrap requests"}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              unwrapRequests.map((request) => (
                <Table.Tr key={request.id}>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Anchor href={request.explorer} target="_blank" size="sm">
                        {request.txHash.slice(0, 12)}...
                      </Anchor>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        aria-label="Copy transaction id"
                        onClick={() => navigator.clipboard.writeText(request.txHash)}
                      >
                        <IconCopy size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{request.destination}</Text>
                  </Table.Td>
                  <Table.Td>{request.amount}</Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      {(request.fulfilled || request.inMempool) &&
                      request.fulfillExplorer ? (
                        <Anchor
                          href={request.fulfillExplorer}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Badge color={request.fulfilled ? "green" : "yellow"}>
                            {request.fulfilled ? "Fulfilled" : "Pending"}
                          </Badge>
                        </Anchor>
                      ) : (
                        <Badge
                          color={
                            request.fulfilled
                              ? "green"
                              : request.inMempool
                              ? "yellow"
                              : request.failed
                              ? "red"
                              : "blue"
                          }
                          title={
                            request.fulfilled
                              ? ""
                              : request.inMempool
                              ? "In the mempool"
                              : request.failed
                              ? request.failureReason || "Transaction rejected"
                              : "Requested; not in the mempool or blockchain"
                          }
                        >
                          {request.fulfilled
                            ? "Fulfilled"
                            : request.inMempool
                            ? "Pending"
                            : request.failed
                            ? "Failed"
                            : "Requested"}
                        </Badge>
                      )}
                      {!request.fulfilled && !request.inMempool && (
                        <Button
                          size="xs"
                          loading={unwrappingId === request.id}
                          disabled={unwrappingId !== null && unwrappingId !== request.id}
                          onClick={async () => {
                            if (appContext.selectedBlockchain?.id !== "yda") {
                              notifications.show({
                                title: "Unwrap failed",
                                message:
                                  "Select YadaCoin, scan the current payout key, then click Unwrap.",
                                color: "red",
                              });
                              return;
                            }
                            setUnwrappingId(request.id);
                            try {
                              const yada = new YadaCoin();
                              const result = await yada.unwrapPair(
                                appContext,
                                webcamRef,
                                {
                                  destination: request.destination,
                                  amount: request.amount,
                                  relationship: request.txHash,
                                }
                              );
                              saveUnwrapAttempt(request.txHash, {
                                actionId: result.action.id,
                                actionHash: result.action.hash,
                                confirmingId: result.confirming.id,
                                submittedAt: Date.now(),
                              });
                              notifications.show({
                                title: "Unwrap submitted",
                                message: request.txHash,
                                color: "green",
                              });
                            } catch (error) {
                              if (error.message !== "Scan cancelled") {
                                notifications.show({
                                  title: "Unwrap failed",
                                  message: error.shortMessage || error.message,
                                  color: "red",
                                });
                              }
                            } finally {
                              setUnwrappingId(null);
                            }
                            // Refresh in the background so the button does not
                            // stay disabled while Base logs are re-scanned.
                            void loadUnwrapRequests();
                          }}
                        >
                          Unwrap
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
        {!unwrapOnly && (
        <>
        <div>
        <Text size="sm" fw={500} mb="md">
          Mint Tokens
        </Text>
        <Stack gap="sm">
          {mintEntries.map((entry, index) => (
            <Group key={entry.id} align="flex-end">
              <TextInput
                label={index === 0 ? "Recipient Address" : ""}
                placeholder="Enter recipient address"
                value={entry.address}
                onChange={(e) =>
                  updateMintEntry(entry.id, "address", e.currentTarget.value)
                }
                error={entry.address !== "" && !ethers.isAddress(entry.address)}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              <AmountInput
                label={index === 0 ? `Amount (${wrappedTokenSymbol})` : ""}
                placeholder="Amount to mint"
                value={entry.amount}
                onChange={(value) =>
                  updateMintEntry(
                    entry.id,
                    "amount",
                    value === undefined ? "" : value.toString()
                  )
                }
                decimalScale={18}
                disabled={!selectedToken}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              {mintEntries.length > 1 && (
                <ActionIcon
                  color="red"
                  variant="subtle"
                  onClick={() => removeMintEntry(entry.id)}
                  mb="sm"
                >
                  <IconTrash size={20} />
                </ActionIcon>
              )}
            </Group>
          ))}

          <Group justify="space-between">
            <Group>
              <Button variant="outline" onClick={addMintEntry}>
                Add Recipient
              </Button>
              <FileButton onChange={handleMintCsvImport} accept=".csv,text/csv">
                {(props) => (
                  <Button
                    {...props}
                    leftSection={<IconUpload size={16} />}
                    variant="outline"
                  >
                    Import CSV
                  </Button>
                )}
              </FileButton>
            </Group>
            <Button onClick={handleMint} disabled={isMintDisabled}>
              Mint Tokens
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            CSV format: address,amount (one per line). Header row optional.
          </Text>
        </Stack>
      </div>

      <Divider />

      {/* Burn Section */}
      <div>
        <Text size="sm" fw={500} mb="md">
          Burn Tokens
        </Text>
        <Stack gap="sm">
          {burnEntries.map((entry, index) => (
            <Group key={entry.id} align="flex-end">
              <TextInput
                label={index === 0 ? "Account Address" : ""}
                placeholder="Enter account address"
                value={entry.address}
                onChange={(e) =>
                  updateBurnEntry(entry.id, "address", e.currentTarget.value)
                }
                error={entry.address !== "" && !ethers.isAddress(entry.address)}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              <AmountInput
                label={index === 0 ? `Amount (${wrappedTokenSymbol})` : ""}
                placeholder="Amount to burn"
                value={entry.amount}
                onChange={(value) =>
                  updateBurnEntry(
                    entry.id,
                    "amount",
                    value === undefined ? "" : value.toString()
                  )
                }
                decimalScale={18}
                disabled={!selectedToken}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              {burnEntries.length > 1 && (
                <ActionIcon
                  color="red"
                  variant="subtle"
                  onClick={() => removeBurnEntry(entry.id)}
                  mb="sm"
                >
                  <IconTrash size={20} />
                </ActionIcon>
              )}
            </Group>
          ))}

          <Group justify="space-between">
            <Group>
              <Button variant="outline" onClick={addBurnEntry}>
                Add Account
              </Button>
              <FileButton onChange={handleBurnCsvImport} accept=".csv,text/csv">
                {(props) => (
                  <Button
                    {...props}
                    leftSection={<IconUpload size={16} />}
                    variant="outline"
                  >
                    Import CSV
                  </Button>
                )}
              </FileButton>
            </Group>
            <Button onClick={handleBurn} disabled={isBurnDisabled} color="red">
              Burn Tokens
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            CSV format: address,amount (one per line). Header row optional.
          </Text>
        </Stack>
      </div>
        </>
        )}
    </Stack>
  );
};

// Export legacy names for backward compatibility
const MintForm = TokenManagementForm;
const BurnForm = TokenManagementForm;

export { TokenManagementForm, MintForm, BurnForm };
