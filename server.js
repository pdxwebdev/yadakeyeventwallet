import express from "express";
import cors from "cors";
import { spawn, spawnSync } from "child_process";
import vm from "vm";
import fs from "fs/promises";
import path from "path";
import { ethers } from "ethers";
import bs58 from "bs58";
import OpenAI from "openai";

const app = express();
const port = 3001;
app.use(cors());
app.use(express.json());

// ── On-chain helpers (used by agent endpoints) ───────────────────────────────
const localProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/");

// Minimal ERC-20 ABI (only what the agent needs)
const ERC20_AGENT_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

function createWalletFromWIF(wif) {
  const decoded = bs58.decode(wif);
  const privateKey = decoded.subarray(1, 33);
  return new ethers.Wallet(ethers.hexlify(privateKey), localProvider);
}

async function getDeployments() {
  const raw = await fs.readFile("./deployments.json", "utf8");
  return JSON.parse(raw);
}

// Shared helper: ensure a wallet has native gas and token balance for demos.
// Uses hardhat_setStorageAt (OZ v5 ERC-7201 namespaced storage) to write
// balances directly — no impersonation or onlyBridge restriction needed.
async function seedBalancesForDemo(walletAddress, tokenAddress, bridgeAddress) {
  if (!walletAddress || !tokenAddress) return;
  try {
    const erc20 = new ethers.Contract(
      tokenAddress,
      ERC20_BALANCE_ABI,
      localProvider
    );
    const [tokenBal, nativeBal] = await Promise.all([
      erc20.balanceOf(walletAddress),
      localProvider.getBalance(walletAddress),
    ]);

    if (nativeBal === 0n) {
      const accounts = await localProvider.listAccounts();
      const faucet = await localProvider.getSigner(accounts[0].address);
      await (
        await faucet.sendTransaction({
          to: walletAddress,
          value: ethers.parseEther("1.0"),
        })
      ).wait();
      console.log(`[seed] Funded 1 BNB to ${walletAddress}`);
    }

    if (tokenBal === 0n) {
      const mintAmount = ethers.parseUnits("500", 18);
      // OZ v5 ERC20Upgradeable ERC-7201 namespace base slot
      const ERC20_STORAGE_SLOT =
        0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n;
      const balanceSlot = ethers.keccak256(
        ethers.concat([
          ethers.zeroPadValue(walletAddress, 32),
          ethers.toBeHex(ERC20_STORAGE_SLOT, 32),
        ])
      );
      const totalSupplySlot = ethers.toBeHex(ERC20_STORAGE_SLOT + 2n, 32);
      const currentSupplyHex = await localProvider.send("eth_getStorageAt", [
        tokenAddress,
        totalSupplySlot,
        "latest",
      ]);
      const newSupply = BigInt(currentSupplyHex) + mintAmount;
      await localProvider.send("hardhat_setStorageAt", [
        tokenAddress,
        balanceSlot,
        ethers.zeroPadValue(ethers.toBeHex(mintAmount), 32),
      ]);
      await localProvider.send("hardhat_setStorageAt", [
        tokenAddress,
        totalSupplySlot,
        ethers.zeroPadValue(ethers.toBeHex(newSupply), 32),
      ]);
      console.log(`[seed] Direct-wrote 500 tokens to ${walletAddress}`);
    }
  } catch (err) {
    console.warn(`[seed] Failed for ${walletAddress}: ${err.message}`);
  }
}

app.post("/deploy", async (req, res) => {
  try {
    const { deployEnv, wif1, wif2, wif3, cprkh, ctprkh, clean } = req.body;

    // Validate inputs
    if (!wif1 || !wif2 || !wif3) {
      return res.status(400).json({
        status: false,
        error: "All WIF parameters (wif1, wif2, wif3) are required",
      });
    }
    if (!cprkh || !ctprkh) {
      return res.status(400).json({
        status: false,
        error: "cprkh and ctprkh parameters are required",
      });
    }

    // Prepare npm run deploy command with arguments
    const args = ["run", deployEnv];
    const env = {
      ...process.env,
      WIF: wif1,
      WIF2: wif2,
      WIF3: wif3,
      CPRKH: cprkh,
      CTPRKH: ctprkh,
      CLEAN: clean ? "true" : "false",
    };
    if (deployEnv !== "deploybase") {
      console.log(env);
      console.log(
        `Command: WIF=${env.WIF} WIF2=${env.WIF2} WIF3=${env.WIF3} CPRKH=${env.CPRKH} CTPRKH=${env.CTPRKH} npm run ${deployEnv}`
      );
    } else {
      console.log("Running Base deploy without logging keys");
    }

    // Spawn npm process
    const npmProcess = spawnSync("npm", args, {
      env,
      shell: true,
      cwd: process.cwd(),
    });

    const stdout = npmProcess.stdout?.toString().trim();
    const stderr = npmProcess.stderr?.toString().trim();
    const status = npmProcess.status;
    let jsonObj = {};

    if (status !== 0) {
      console.error("NPM command failed:", stderr);
      return res
        .status(500)
        .json({ status: false, error: stderr || "NPM command failed" });
    }

    console.log("NPM command succeeded:", stdout);
    // Extract the JSON-like object using a regex
    const match = stdout.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        // Use Node's VM to safely evaluate the object-like string
        jsonObj = vm.runInNewContext(`(${match[0]})`);
        console.log("Extracted JSON:", jsonObj);
      } catch (e) {
        console.error("Failed to parse output:", e);
        return res
          .status(500)
          .json({ status: false, error: "Failed to parse deployment output" });
      }
    } else {
      console.error("No JSON found in output");
      return res
        .status(500)
        .json({ status: false, error: "No JSON found in deployment output" });
    }

    // Return the JSON response
    res.json({ status: true, addresses: jsonObj });
  } catch (err) {
    console.error("Endpoint error:", err);
    res.status(500).json({ status: false, error: err.message });
  }
});
const DEPLOYMENTS_FILE = path.join(process.cwd(), "deployments.json");
// New /check-deployment endpoint
app.post("/check-deployment", async (req, res) => {
  try {
    if (req.body?.chain === "base") {
      const baseFile = path.join(process.cwd(), "deployments-base.local.json");
      try {
        const deployments = JSON.parse(await fs.readFile(baseFile, "utf-8"));
        return res.json({
          status: true,
          deployed: Boolean(deployments.bridgeAddress),
          addresses: deployments,
        });
      } catch (error) {
        if (error.code === "ENOENT") {
          return res.json({ status: true, deployed: false });
        }
        throw error;
      }
    }
    // Check if deployments.json file exists
    try {
      const fileContent = await fs.readFile(DEPLOYMENTS_FILE, "utf-8");
      const deployments = JSON.parse(fileContent);

      // Validate that the file contains expected contract addresses
      if (deployments && deployments.keyLogRegistryAddress) {
        return res.json({
          status: true,
          deployed: true,
          addresses: deployments,
          message: "Deployment found in deployments.json",
        });
      } else {
        return res.json({
          status: true,
          deployed: false,
          message:
            "deployments.json exists but does not contain valid contract addresses",
        });
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        // File does not exist
        return res.json({
          status: true,
          deployed: false,
          message: "No deployment found (deployments.json does not exist)",
        });
      }
      console.error("Error reading deployments.json:", error);
      return res.status(500).json({
        status: false,
        error: "Failed to read deployments.json: " + error.message,
      });
    }
  } catch (err) {
    console.error("Check-deployment error:", err);
    res.status(500).json({ status: false, error: err.message });
  }
});

function reviveBigInts(obj) {
  if (typeof obj === "string") {
    // Check if it's a numeric string (integer, possibly very large)
    if (/^-?\d+$/.test(obj)) {
      try {
        return BigInt(obj);
      } catch (e) {
        // If too large for BigInt (extremely unlikely), fall back to string
        return obj;
      }
    }
    return obj; // regular string
  }

  if (Array.isArray(obj)) {
    return obj.map(reviveBigInts);
  }

  if (obj && typeof obj === "object") {
    const revived = {};
    for (const [key, value] of Object.entries(obj)) {
      revived[key] = reviveBigInts(value);
    }
    return revived;
  }

  return obj; // number, boolean, null, etc.
}
app.post("/upgrade", async (req, res) => {
  try {
    const {
      upgradeEnv,
      bridgeProxyAddress,
      keyLogRegistryProxyAddress,
      wrappedTokenProxyAddresses,
      wif,
      wif2,
      confirmingPrerotatedKeyHash,
      confirmingTwicePrerotatedKeyHash,
      permits = [],
    } = req.body;

    // Prepare npm run deploy command with arguments
    const args = ["run", upgradeEnv];
    const env = {
      ...process.env,
      BRIDGE_PROXY_ADDRESS: bridgeProxyAddress,
      KEY_LOG_REGISTRY_PROXY_ADDRESS: keyLogRegistryProxyAddress,
      WRAPPED_TOKEN_PROXY_ADDRESSES: wrappedTokenProxyAddresses,
      WIF: wif,
      CONFIRMING_WIF: wif2,
      CPRKH: confirmingPrerotatedKeyHash,
      CTPRKH: confirmingTwicePrerotatedKeyHash,
    };
    // Pass permits as JSON string (safe for env var)
    if (permits.length > 0) {
      try {
        const permits2 = reviveBigInts(permits);
        console.log(permits2);
        console.log(permits2[0].recipients);
        env.PERMITS = JSON.stringify(permits);
        console.log(`Received ${permits.length} permits for secure upgrade`);
      } catch (e) {
        return res.status(400).json({
          status: false,
          error: "Invalid permits format: must be JSON-serializable",
        });
      }
    } else {
      env.PERMITS = "[]"; // empty array
    }

    console.log(env);
    console.log(
      `Command: WIF=${env.WIF} CONFIRMING_WIF=${env.CONFIRMING_WIF} CPRKH=${env.CPRKH} CTPRKH=${env.CTPRKH} BRIDGE_PROXY_ADDRESS=${env.BRIDGE_PROXY_ADDRESS} KEY_LOG_REGISTRY_PROXY_ADDRESS=${env.KEY_LOG_REGISTRY_PROXY_ADDRESS} WRAPPED_TOKEN_PROXY_ADDRESSES="${env.WRAPPED_TOKEN_PROXY_ADDRESSES}" PERMITS='${env.PERMITS}' npm run ${upgradeEnv}`
    );

    // Spawn npm process
    const npmProcess = spawnSync("npm", args, {
      env,
      shell: true,
      cwd: process.cwd(),
    });

    const stdout = npmProcess.stdout?.toString().trim();
    const stderr = npmProcess.stderr?.toString().trim();
    const status = npmProcess.status;
    let jsonObj = {};

    if (status !== 0) {
      console.error("NPM command failed:", stderr);
      return res
        .status(500)
        .json({ status: false, error: stderr || "NPM command failed" });
    }

    console.log("NPM command succeeded:", stdout);
    // Extract the JSON-like object using a regex
    // Extract the JSON-like object using a regex
    const match = stdout.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        // Use Node's VM to safely evaluate the object-like string
        jsonObj = vm.runInNewContext(`(${match[0]})`);
        console.log("Extracted JSON:", jsonObj);
      } catch (e) {
        console.error("Failed to parse output:", e);
        return res
          .status(500)
          .json({ status: false, error: "Failed to parse deployment output" });
      }
    } else {
      console.error("No JSON found in output");
      return res
        .status(500)
        .json({ status: false, error: "No JSON found in deployment output" });
    }

    // Return the JSON response
    res.json({ status: true, addresses: jsonObj });
  } catch (err) {
    console.error("Endpoint error:", err);
    res.status(500).json({ status: false, error: err.message });
  }
});

// ── Dev-only: fund an address from Hardhat account[0] ──────────────────────
// Used by the wallet when the current signing key has no ETH on the local node.
app.post("/dev/fund", async (req, res) => {
  const { address, amount = "1.0" } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ status: false, error: "Invalid address" });
  }
  try {
    // Hardhat account[0] always has 10 000 ETH on the local node.
    const accounts = await localProvider.listAccounts();
    if (!accounts.length) {
      return res
        .status(503)
        .json({ status: false, error: "No Hardhat accounts available" });
    }
    const faucet = await localProvider.getSigner(accounts[0].address);
    const tx = await faucet.sendTransaction({
      to: address,
      value: ethers.parseEther(amount),
    });
    await tx.wait();
    console.log(`[dev/fund] Sent ${amount} ETH to ${address}`);
    res.json({ status: true, address, amount });
  } catch (err) {
    console.error(`[dev/fund] Failed:`, err.message);
    res.status(500).json({ status: false, error: err.message });
  }
});

// ── Dev-only: mint MOCK tokens via Bridge impersonation ────────────────────
// Hardhat lets us impersonate any address.  We impersonate the Bridge (which
// is the only authorised caller of MockERC20.mint) to credit test tokens.
const MOCK_ERC20_MINT_ABI = [
  "function mint(address to, uint256 amount) external",
];
app.post("/dev/mint", async (req, res) => {
  const { address, amount = "1000" } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ status: false, error: "Invalid address" });
  }
  try {
    const deployments = await getDeployments();
    const { yadaERC20Address, bridgeAddress } = deployments;
    // Fund the Bridge address with a tiny bit of ETH so impersonation txs succeed
    const accounts = await localProvider.listAccounts();
    const faucet = await localProvider.getSigner(accounts[0].address);
    await (
      await faucet.sendTransaction({
        to: bridgeAddress,
        value: ethers.parseEther("0.1"),
      })
    ).wait();
    // Impersonate the Bridge and call MockERC20.mint
    await localProvider.send("hardhat_impersonateAccount", [bridgeAddress]);
    const bridgeSigner = await localProvider.getSigner(bridgeAddress);
    const mockERC20 = new ethers.Contract(
      yadaERC20Address,
      MOCK_ERC20_MINT_ABI,
      bridgeSigner
    );
    const tx = await mockERC20.mint(address, ethers.parseUnits(amount, 18));
    await tx.wait();
    await localProvider.send("hardhat_stopImpersonatingAccount", [
      bridgeAddress,
    ]);
    console.log(`[dev/mint] Minted ${amount} MOCK to ${address}`);
    res.json({ status: true, address, amount });
  } catch (err) {
    console.error("[dev/mint] Failed:", err.message);
    res.status(500).json({ status: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent endpoints — server.js acts as both the external agent (generates plans)
// and the internal guardian (analyses plans, never exposes raw JSON to the UI)
// ─────────────────────────────────────────────────────────────────────────────

const agentPlanStore = new Map(); // serverPlanId → planData object
// Stores per-plan execution state keyed by on-chain planId (bytes32 hex)
const executionStore = new Map();

// POST /agent/plan
// External-agent role: generate a plan for the wallet to ingest.
// The wallet calls this, gets back planData JSON, submits it on-chain, and
// opens the review modal — the user never sees the raw JSON.
app.post("/agent/plan", async (req, res) => {
  const { context = {}, agentAddress } = req.body;

  const serverPlanId = `plan_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  let deployments = {};
  try {
    deployments = await getDeployments();
  } catch {
    console.warn("[agent/plan] Could not read deployments.json");
  }

  const tokenAddress = deployments.yadaERC20Address ?? "";
  const spenderAddress = deployments.bridgeAddress ?? "";

  const plan = {
    title: "Stage ERC-20 approval: allow Bridge to spend MOCK tokens",
    description:
      "Agent approves the Bridge contract to spend 50 MOCK tokens on your behalf. " +
      "This is a preparatory on-chain action — inspect the approval below, then choose " +
      "to Execute (Bridge retains allowance) or Roll Back (allowance revoked).",
    steps: [
      {
        step: 1,
        action: "approve",
        description:
          "Grant Bridge contract allowance to spend 50 MOCK tokens (ERC-20 approve).",
        params: {
          token: tokenAddress,
          tokenLabel: "MOCK",
          spender: spenderAddress,
          spenderLabel: "Bridge",
          amount: "50",
        },
      },
      {
        step: 2,
        action: "key_rotation",
        description:
          "Standard key rotation: signing key's native balance is forwarded to the next key in the user's key log.",
        params: {},
      },
    ],
    riskLevel: "low",
    estimatedGas: "46000",
    agentAddress,
    context,
    generatedAt: new Date().toISOString(),
  };

  agentPlanStore.set(serverPlanId, plan);
  console.log(`[agent] Plan generated: ${serverPlanId}`);

  res.json({ serverPlanId, planData: JSON.stringify(plan) });
});

// POST /agent/analyze
// Guardian role: analyse a submitted plan and return a human-readable verdict.
// The wallet calls this after submitting the plan on-chain.  The response is
// stored on-chain via submitGuardianAdvice() and shown to the user as a
// structured report — never as raw JSON.
app.post("/agent/analyze", (req, res) => {
  const { planId, planData } = req.body;

  let plan;
  try {
    plan = typeof planData === "string" ? JSON.parse(planData) : planData;
  } catch {
    return res.json({
      risk: "critical",
      summary: "Plan payload is malformed and cannot be parsed.",
      issues: ["Invalid JSON in plan payload."],
      recommendations: ["Reject this plan and request a new one."],
      blocked: true,
    });
  }

  const issues = [];
  const recommendations = [];
  let risk = "low";
  let blocked = false;

  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const validActions = [
    "transfer",
    "swap",
    "bridge",
    "approve",
    "stake",
    "key_rotation",
  ];

  // Flag unrecognised action types
  const unknownSteps = steps.filter((s) => !validActions.includes(s.action));
  if (unknownSteps.length > 0) {
    risk = "high";
    issues.push(
      `Unrecognised action type(s): ${unknownSteps
        .map((s) => s.action)
        .join(", ")}.`
    );
    recommendations.push("Verify each step manually before approving.");
  }

  // Flag transfer to zero address (burn)
  const burnTransfer = steps.some(
    (s) =>
      s.action === "transfer" &&
      s.params?.recipient === "0x0000000000000000000000000000000000000000"
  );
  if (burnTransfer) {
    risk = "critical";
    blocked = true;
    issues.push(
      "Plan transfers funds to the zero address (irreversible burn)."
    );
  }

  // Third-party transfers (not key-log rotation) elevate risk.
  // Key rotation — forwarding the signing key's native balance to the user's own
  // prerotated key — is standard protocol behaviour on every interaction and
  // carries no third-party risk.  Only flag plan-level transfer steps that send
  // funds to an external recipient.
  const thirdPartyTransfers = steps.filter(
    (s) =>
      s.action === "transfer" &&
      s.params?.recipient &&
      s.params.recipient !== "0x0000000000000000000000000000000000000000"
  );
  if (thirdPartyTransfers.length > 0 && risk === "low") {
    risk = "medium";
    recommendations.push(
      "Transfer plan — verify recipient addresses before approving."
    );
  }

  // Swap steps — flag if slippage tolerance is unusually high.
  const swapSteps = steps.filter((s) => s.action === "swap");
  for (const s of swapSteps) {
    const slippage = s.params?.slippageBps ?? 0;
    if (slippage > 500) {
      if (risk === "low") risk = "medium";
      issues.push(
        `Swap step ${s.step} has high slippage tolerance: ${slippage / 100}%.`
      );
    } else {
      recommendations.push(
        `Swap ${s.params?.tokenInLabel ?? "token"} → ${
          s.params?.tokenOutLabel ?? "token"
        }: ` +
          `${s.params?.amountIn ?? "?"} in, min ${
            s.params?.minAmountOut ?? "?"
          } out ` +
          `(slippage cap ${slippage / 100}%).`
      );
    }
  }

  // Stake steps — flag unverified vault addresses as medium risk.
  const stakeSteps = steps.filter((s) => s.action === "stake");
  for (const s of stakeSteps) {
    if (risk === "low") risk = "medium";
    const vaultLabel =
      s.params?.vaultLabel ?? s.params?.vault ?? "unknown vault";
    const apy = s.params?.estimatedApy
      ? ` Estimated APY: ${s.params.estimatedApy}.`
      : "";
    issues.push(
      `Stake step ${s.step} deposits into ${vaultLabel} — verify this vault contract before approving.${apy}`
    );
    recommendations.push(
      `Check the ${vaultLabel} contract is audited and matches the expected address before confirming.`
    );
  }

  // Scoped ERC-20 approvals (specific spender address) are reversible and low risk.
  const scopedApprovals = steps.filter(
    (s) => s.action === "approve" && s.params?.spender?.startsWith("0x")
  );
  if (scopedApprovals.length > 0) {
    const labels = scopedApprovals.map(
      (s) =>
        `${s.params.tokenLabel ?? s.params.token} → ${
          s.params.spenderLabel ?? s.params.spender
        }` + (s.params.amount ? ` (${s.params.amount})` : "")
    );
    recommendations.push(
      `Scoped approval${scopedApprovals.length > 1 ? "s" : ""}: ${labels.join(
        ", "
      )}. ` +
        "Allowance is staged — you can roll back at any time before confirming."
    );
  }

  // Key rotation is always standard: the signing key's native balance is
  // forwarded to the user's own prerotated key on every interaction.
  recommendations.push(
    "Key rotation is standard protocol behaviour: the signing key's native balance " +
      "is automatically forwarded to the next key in the user's key log on every interaction."
  );

  // Build step summary
  const stepSummaries = steps.map((s, i) => {
    let detail = `${s.step ?? i + 1}. ${s.action}`;
    if (s.action === "approve" && s.params?.spender) {
      const token = s.params.tokenLabel ?? s.params.token;
      const spender = s.params.spenderLabel ?? s.params.spender;
      detail += `: allow ${spender} to spend ${
        s.params.amount ?? ""
      } ${token}`.trimEnd();
    } else if (s.description) {
      detail += `: ${s.description}`;
    }
    return detail;
  });

  let summary;
  let summaryLines;
  if (blocked) {
    summary = `BLOCKED — ${issues[0]}`;
    summaryLines = [summary];
  } else {
    const trailing =
      issues.length === 0 && thirdPartyTransfers.length === 0
        ? ["No third-party risk detected."]
        : [];
    summaryLines = [
      `${steps.length} step${steps.length !== 1 ? "s" : ""}:`,
      ...stepSummaries,
      ...trailing,
    ];
    summary = summaryLines.join("\n");
  }

  console.log(`[guardian] planId=${planId} risk=${risk} blocked=${blocked}`);
  res.json({ risk, summary, summaryLines, issues, recommendations, blocked });
});

// Build a human-readable execution summary and guardian verdict from completed steps.
function buildExecutionSummary(plan, results) {
  const stepDescs = results.map(
    (r) => `${r.step}. ${r.action}: ${r.description || "(no description)"}`
  );
  const allExecuted = results.every((r) => r.status === "executed");
  const failedSteps = results.filter((r) => r.status !== "executed");

  let risk = "low";
  let blocked = false;
  const issues = [];
  const recommendations = [];

  if (!allExecuted) {
    risk = "high";
    issues.push(
      `${failedSteps.length} step(s) did not execute: ${failedSteps
        .map((s) => s.step)
        .join(", ")}.`
    );
    recommendations.push(
      "Some agent steps may be incomplete. Review carefully before confirming."
    );
  }

  // Only flag third-party transfer steps — not key-log rotation.
  const thirdPartyTransfers = results.filter(
    (r) =>
      r.action === "transfer" &&
      r.params?.recipient &&
      r.params.recipient !== "0x0000000000000000000000000000000000000000"
  );
  if (thirdPartyTransfers.length > 0 && risk === "low") {
    risk = "medium";
    recommendations.push(
      "Agent transferred funds — verify recipients match the plan before confirming."
    );
  }

  // Summarise scoped approvals positively.
  const stagedApprovals = results.filter(
    (r) => r.action === "approve" && r.status === "executed"
  );
  if (stagedApprovals.length > 0) {
    const labels = stagedApprovals.map(
      (r) =>
        `${r.params?.tokenLabel ?? r.params?.token ?? "token"} → ` +
        `${r.params?.spenderLabel ?? r.params?.spender ?? "spender"}` +
        (r.params?.amount ? ` (${r.params.amount})` : "")
    );
    recommendations.push(
      `Staged approval${stagedApprovals.length > 1 ? "s" : ""}: ${labels.join(
        ", "
      )}. ` + "Confirm to retain the allowance, or roll back to revoke it."
    );
  }

  // Key rotation is always standard.
  recommendations.push(
    "Key rotation is standard protocol behaviour: the signing key's native balance " +
      "is automatically forwarded to the next key in the user's key log on every interaction."
  );

  const summaryLines = [
    `${results.length} step${results.length !== 1 ? "s" : ""} staged by agent:`,
    ...stepDescs,
    ...(thirdPartyTransfers.length === 0
      ? ["No third-party risk detected."]
      : []),
  ];
  const summary = summaryLines.join("\n");

  return {
    risk,
    summary,
    summaryLines,
    issues,
    recommendations,
    blocked,
    steps: results,
  };
}

// POST /agent/notify-approved
// Called by the wallet immediately after approvePlan() succeeds on-chain.
// The agent receives the unconfirmed WIF, executes the plan's transactions
// using it as the signer, and returns when all steps are complete.
// The execute step (confirming scan) happens AFTER this endpoint returns.
app.post("/agent/notify-approved", async (req, res) => {
  const { planId, planData, unconfirmedWIF } = req.body;

  if (!planId || !planData || !unconfirmedWIF) {
    return res.status(400).json({
      status: false,
      error: "planId, planData, and unconfirmedWIF are required",
    });
  }

  let plan;
  try {
    plan = typeof planData === "string" ? JSON.parse(planData) : planData;
  } catch {
    return res
      .status(400)
      .json({ status: false, error: "Invalid planData JSON" });
  }

  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const results = [];

  // Load deployments so the agent can make real on-chain calls
  let deployments = null;
  try {
    deployments = await getDeployments();
  } catch {
    console.warn(
      "[agent/notify-approved] Could not read deployments.json — running in stub mode"
    );
  }

  // Store the unconfirmed WIF so notify-rollback can revoke approvals if needed
  executionStore.set(planId, { unconfirmedWIF });

  for (const step of steps) {
    console.log(
      `[agent/notify-approved] planId=${planId} executing step ${step.step}: ${step.action}`
    );

    // Key rotation is handled by the Bridge contract, not by the agent.
    if (step.action === "key_rotation") {
      results.push({
        step: step.step,
        action: step.action,
        status: "protocol",
        description: step.description ?? "",
        txHash: null,
        params: step.params ?? null,
      });
      continue;
    }

    let txHash = null;
    let status = "executed";

    if (step.action === "approve" && deployments) {
      try {
        const agentWallet = createWalletFromWIF(unconfirmedWIF);
        const erc20 = new ethers.Contract(
          deployments.yadaERC20Address,
          ERC20_AGENT_ABI,
          agentWallet
        );
        const amount = ethers.parseUnits(step.params?.amount ?? "50", 18);
        const tx = await erc20.approve(deployments.bridgeAddress, amount);
        const receipt = await tx.wait();
        txHash = receipt.hash;
        console.log(`[agent/notify-approved] approve tx: ${txHash}`);
      } catch (err) {
        console.error(`[agent/notify-approved] approve failed: ${err.message}`);
        status = "failed";
      }
    }

    // swap and stake are simulated in the sandbox (no DEX/vault deployed).
    // In production these would call the real contracts.
    if (step.action === "swap") {
      console.log(
        `[agent/notify-approved] simulated swap: ${step.params?.amountIn} ` +
          `${step.params?.tokenInLabel} → ${step.params?.tokenOutLabel}`
      );
      txHash = null; // no on-chain tx in sandbox
    }

    if (step.action === "stake") {
      console.log(
        `[agent/notify-approved] simulated stake: ${step.params?.amount} ` +
          `${step.params?.tokenLabel} → ${step.params?.vaultLabel}`
      );
      txHash = null;
    }

    results.push({
      step: step.step,
      action: step.action,
      status,
      description: step.description ?? "",
      txHash,
      params: step.params ?? null,
    });
  }

  console.log(
    `[agent/notify-approved] planId=${planId} completed ${results.length} step(s)`
  );

  // Run guardian analysis on what was actually executed so the execute scanner
  // can show the user what the agent did before they confirm or cancel.
  const executionSummary = buildExecutionSummary(plan, results);

  res.json({ status: true, planId, results, executionSummary });
});

// ── AI Agent — Grok reads live balances and reasons about what to do ────────
//
// POST /agent/plan/ai
// Calls Groq (Llama 3.3) with the user's real on-chain token and ETH balances.
// The LLM decides which action(s) to take, how much, and why — nothing is
// hardcoded.  Requires GROQ_API_KEY in the environment.
const openai = process.env.GROQ_API_KEY
  ? new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    })
  : null;

// Minimal ERC-20 balanceOf ABI
const ERC20_BALANCE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

app.post("/agent/plan/ai", async (req, res) => {
  if (!openai) {
    return res.status(503).json({
      status: false,
      error:
        "GROQ_API_KEY is not set. Start the server with GROQ_API_KEY=gsk_... node server.js",
    });
  }

  const { context = {}, agentAddress, walletAddress } = req.body;

  let deployments = {};
  try {
    deployments = await getDeployments();
  } catch {
    console.warn("[agent/plan/ai] Could not read deployments.json");
  }

  const tokenAddress = deployments.yadaERC20Address ?? "";
  const bridgeAddress = deployments.bridgeAddress ?? "";
  const wrappedTokenAddress = deployments.wrappedTokenAddress ?? "";
  const checkAddress = walletAddress || agentAddress;

  // Ensure address has tokens / gas using shared helper
  await seedBalancesForDemo(checkAddress, tokenAddress, bridgeAddress);

  // ── Gather live on-chain context ────────────────────────────────────────
  let mockBalance = "unknown";
  let mockSymbol = "MOCK";
  let wMockBalance = "unknown";
  let ethBalance = "unknown";

  if (checkAddress && tokenAddress) {
    try {
      const erc20 = new ethers.Contract(
        tokenAddress,
        ERC20_BALANCE_ABI,
        localProvider
      );
      const [tokenBal, ethBal, sym] = await Promise.all([
        erc20.balanceOf(checkAddress),
        localProvider.getBalance(checkAddress),
        erc20.symbol().catch(() => "MOCK"),
      ]);
      mockBalance = parseFloat(ethers.formatUnits(tokenBal, 18)).toFixed(4);
      mockSymbol = sym;
      ethBalance = parseFloat(ethers.formatEther(ethBal)).toFixed(6);
    } catch (err) {
      console.warn("[agent/plan/ai] Balance check failed:", err.message);
    }
  }

  if (checkAddress && wrappedTokenAddress) {
    try {
      const wErc20 = new ethers.Contract(
        wrappedTokenAddress,
        ERC20_BALANCE_ABI,
        localProvider
      );
      const wBal = await wErc20.balanceOf(checkAddress);
      wMockBalance = parseFloat(ethers.formatUnits(wBal, 18)).toFixed(4);
    } catch {
      // not critical
    }
  }

  // ── System prompt: give the LLM real context and a strict output schema ─
  const systemPrompt = `You are a DeFi portfolio management agent for the Yada Wallet.
Your task: analyse the user's current holdings and propose ONE useful on-chain plan.

Available contracts (Hardhat local testnet):
- ${mockSymbol} ERC-20 token: ${tokenAddress || "not deployed"}
- Bridge contract (wraps/unwraps tokens): ${bridgeAddress || "not deployed"}
- Wrapped${mockSymbol} (w${mockSymbol}): ${
    wrappedTokenAddress || "not deployed"
  }

User wallet: ${checkAddress || "unknown"}
User ${mockSymbol} balance: ${mockBalance} ${mockSymbol}
User w${mockSymbol} balance: ${wMockBalance} w${mockSymbol}
User native balance (BNB): ${ethBalance}

Available step actions and their required params:
- "approve": ERC-20 allowance.  params: { token, tokenLabel, spender, spenderLabel, amount }
- "transfer": Send tokens.       params: { token, tokenLabel, recipient, amount }
- "swap": Token swap.            params: { tokenIn, tokenInLabel, tokenOut, tokenOutLabel, amountIn, minAmountOut, slippageBps }
- "stake": Vault deposit.        params: { token, tokenLabel, vault, vaultLabel, amount, estimatedApy }
- "key_rotation": Protocol step — always the LAST step, no params needed.  params: {}

Rules:
1. The final step MUST be key_rotation.
2. Only propose actions whose amounts are within the user's available balances.
3. If the user has ${mockSymbol} tokens, a useful action is approving the Bridge or swapping to w${mockSymbol}.
4. If balances are 0, recommend a conservative single-step plan and explain why in the description.
5. riskLevel must be one of: "low", "medium", "high".
6. estimatedGas should be a rough number as a string (e.g. "65000").
7. In the top-level description field, explain your reasoning in 1-2 sentences.

Respond with ONLY valid JSON — no markdown, no triple-backticks, no extra text:
{
  "title": "string",
  "description": "string",
  "steps": [
    { "step": 1, "action": "string", "description": "string", "params": {} }
  ],
  "riskLevel": "low",
  "estimatedGas": "string"
}`;

  console.log(
    `[agent/plan/ai] Calling Groq for ${checkAddress} — ${mockSymbol}=${mockBalance}, ETH=${ethBalance}`
  );

  let plan;
  try {
    const completion = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: "Generate an optimal plan for my current portfolio.",
        },
      ],
      max_tokens: 1000,
      temperature: 0.3,
    });

    const raw = completion.choices[0].message.content;
    try {
      plan = JSON.parse(raw);
    } catch {
      return res
        .status(500)
        .json({ status: false, error: "AI returned invalid JSON" });
    }
    plan.aiModel = completion.model;
    plan.aiGenerated = true;
    console.log(
      `[agent/plan/ai] Got plan from ${completion.model}: "${plan.title}"`
    );
  } catch (err) {
    console.error("[agent/plan/ai] OpenAI error:", err.message);
    return res
      .status(500)
      .json({ status: false, error: `AI request failed: ${err.message}` });
  }

  // ── Validate and sanitize the returned plan ─────────────────────────────
  const validActions = [
    "transfer",
    "swap",
    "bridge",
    "approve",
    "stake",
    "key_rotation",
  ];
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return res
      .status(500)
      .json({ status: false, error: "AI plan is missing steps" });
  }
  plan.steps = plan.steps.filter((s) => validActions.includes(s.action));
  if (plan.steps.length === 0) {
    return res
      .status(500)
      .json({ status: false, error: "AI plan contained no valid actions" });
  }
  // Re-number sequentially after filtering
  plan.steps = plan.steps.map((s, i) => ({ ...s, step: i + 1 }));

  plan.agentAddress = agentAddress;
  plan.context = context;
  plan.generatedAt = new Date().toISOString();

  const serverPlanId = `ai_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  agentPlanStore.set(serverPlanId, plan);
  res.json({ serverPlanId, planData: JSON.stringify(plan) });
});

// ── Yield Optimizer agent (Coinbase AgentKit-style demo) ─────────────────────
//
// POST /agent/plan/yield
// Generates a 3-step DeFi yield-optimisation plan:
//   1. approve  — grant the mock vault allowance to pull MOCK tokens
//   2. swap     — swap 25 MOCK → wMOCK via the WrappedToken contract
//   3. stake    — deposit 25 wMOCK into the mock vault (mocked — emits log only)
//   4. key_rotation — standard
//
// The swap is real (mint wrappedToken against the MockERC20 via Bridge.bridge()),
// the stake is simulated (no vault contract deployed in the sandbox).
app.post("/agent/plan/yield", async (req, res) => {
  const { context = {}, agentAddress } = req.body;

  const serverPlanId = `yield_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  let deployments = {};
  try {
    deployments = await getDeployments();
  } catch {
    console.warn("[agent/plan/yield] Could not read deployments.json");
  }

  const tokenAddress = deployments.yadaERC20Address ?? "";
  const wrappedTokenAddress = deployments.wrappedTokenAddress ?? "";
  // Mock vault — a deterministic address derived from the token address so it
  // looks plausible but is clearly not the same contract.
  const mockVaultAddress = tokenAddress
    ? "0x" + tokenAddress.slice(2, 4) + "Vault" + tokenAddress.slice(9)
    : "0x0000000000000000000000000000000000000000";

  const plan = {
    title: "Yield Optimisation: swap MOCK → wMOCK and stake for yield",
    description:
      "Coinbase AgentKit-style yield strategy. Agent swaps 25 MOCK tokens into " +
      "wrapped MOCK (wMOCK) and deposits them into the highest-yield vault detected " +
      "on-chain. Execution is staged — review the steps below, then confirm or roll back.",
    agentKit: "coinbase-agentkit@0.0.36",
    steps: [
      {
        step: 1,
        action: "approve",
        description:
          "Approve the yield vault to pull 25 MOCK tokens on your behalf.",
        params: {
          token: tokenAddress,
          tokenLabel: "MOCK",
          spender: mockVaultAddress,
          spenderLabel: "YieldVault",
          amount: "25",
        },
      },
      {
        step: 2,
        action: "swap",
        description: "Swap 25 MOCK → 25 wMOCK via the WrappedToken contract.",
        params: {
          tokenIn: tokenAddress,
          tokenInLabel: "MOCK",
          tokenOut: wrappedTokenAddress,
          tokenOutLabel: "wMOCK",
          amountIn: "25",
          minAmountOut: "24",
          slippageBps: 100,
        },
      },
      {
        step: 3,
        action: "stake",
        description:
          "Deposit 25 wMOCK into YieldVault. Estimated APY: 8.4%. Redeemable any time.",
        params: {
          token: wrappedTokenAddress,
          tokenLabel: "wMOCK",
          vault: mockVaultAddress,
          vaultLabel: "YieldVault",
          amount: "25",
          estimatedApy: "8.4%",
        },
      },
      {
        step: 4,
        action: "key_rotation",
        description:
          "Standard key rotation: signing key's native balance is forwarded to the next key in the user's key log.",
        params: {},
      },
    ],
    riskLevel: "medium",
    estimatedGas: "120000",
    agentAddress,
    context,
    generatedAt: new Date().toISOString(),
  };

  agentPlanStore.set(serverPlanId, plan);
  console.log(`[agent/yield] Plan generated: ${serverPlanId}`);
  res.json({ serverPlanId, planData: JSON.stringify(plan) });
});

// ── Autonomous Agent Chain orchestrator ──────────────────────────────────────
//
// POST /agent/run-autonomous
//
// Coordinates three independent agents in sequence:
//   1. Scout  (port 3002) — reads live on-chain state, asks LLM: "what should I do?"
//   2. Architect (port 3003) — receives Scout's goal, asks LLM: "how exactly?"
//   3. Executor (this process) — executes the plan on-chain with the provided key;
//      if any step fails, asks LLM: "retry, skip, or abort?"
//
// The entire chain runs without human input.  The result is submitted as a plan
// to the on-chain AgentRegistry, awaiting the user's confirming key scan.
app.post("/agent/run-autonomous", async (req, res) => {
  const { privateKeyHex, agentAddress, context = {} } = req.body;

  if (!privateKeyHex) {
    return res
      .status(400)
      .json({ status: false, error: "privateKeyHex is required" });
  }

  let signer;
  try {
    signer = new ethers.Wallet(privateKeyHex, localProvider);
  } catch {
    return res
      .status(400)
      .json({ status: false, error: "Invalid privateKeyHex" });
  }
  const walletAddress = signer.address;

  let deployments = {};
  try {
    deployments = await getDeployments();
  } catch {}
  const {
    yadaERC20Address: tokenAddress,
    bridgeAddress,
    wrappedTokenAddress,
  } = deployments;

  console.log(`\n[autonomous] ── Starting chain for ${walletAddress} ──`);

  // Seed balances so the LLM actually has something real to work with
  await seedBalancesForDemo(walletAddress, tokenAddress, bridgeAddress);

  const contracts = { tokenAddress, wrappedTokenAddress, bridgeAddress };
  const transcript = [];

  // ── Step 1: Scout ──────────────────────────────────────────────────────────
  console.log("[autonomous] Step 1 — calling Scout agent (port 3002)…");
  let scoutResult;
  try {
    const sr = await fetch("http://localhost:3002/scout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, contracts }),
    });
    if (!sr.ok) {
      const body = await sr.json().catch(() => ({}));
      throw new Error(body.error || `Scout returned HTTP ${sr.status}`);
    }
    scoutResult = await sr.json();
    transcript.push({
      agent: "scout",
      port: 3002,
      model: scoutResult.model,
      recommendation: scoutResult.recommendation,
      reasoning: scoutResult.reasoning,
      urgency: scoutResult.urgency,
    });
    console.log(`[autonomous] Scout → "${scoutResult.recommendation}"`);
  } catch (err) {
    return res.status(503).json({
      status: false,
      error: `Scout agent unreachable. Make sure it is running: GROQ_API_KEY=gsk_... node agentScout.js\n${err.message}`,
    });
  }

  // ── Step 2: Architect ──────────────────────────────────────────────────────
  console.log("[autonomous] Step 2 — calling Architect agent (port 3003)…");
  let architectResult;
  try {
    const ar = await fetch("http://localhost:3003/architect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scoutResult, contracts }),
    });
    if (!ar.ok) {
      const body = await ar.json().catch(() => ({}));
      throw new Error(body.error || `Architect returned HTTP ${ar.status}`);
    }
    architectResult = await ar.json();
    transcript.push({
      agent: "architect",
      port: 3003,
      model: architectResult.model,
      planTitle: architectResult.planTitle,
      stepCount: (architectResult.steps || []).length,
    });
    console.log(
      `[autonomous] Architect → "${architectResult.planTitle}" (${
        (architectResult.steps || []).length
      } steps)`
    );
  } catch (err) {
    return res.status(503).json({
      status: false,
      error: `Architect agent unreachable. Make sure it is running: GROQ_API_KEY=gsk_... node agentArchitect.js\n${err.message}`,
    });
  }

  // ── Step 3: Executor (on-chain, this process) ──────────────────────────────
  console.log("[autonomous] Step 3 — executing plan on-chain…");
  const steps = Array.isArray(architectResult.steps)
    ? architectResult.steps
    : [];
  const executionResults = [];

  for (const step of steps) {
    console.log(`[executor] step ${step.step}: ${step.action}`);

    if (step.action === "key_rotation") {
      executionResults.push({
        ...step,
        executedAutonomously: true,
        status: "protocol",
        txHash: null,
      });
      transcript.push({
        agent: "executor",
        step: step.step,
        action: "key_rotation",
        status: "protocol",
      });
      continue;
    }

    let txHash = null;
    let status = "executed";

    try {
      if (step.action === "approve" && tokenAddress) {
        const spender = step.params?.spender || bridgeAddress;
        const amount = ethers.parseUnits(step.params?.amount ?? "50", 18);
        const erc20 = new ethers.Contract(
          tokenAddress,
          ERC20_AGENT_ABI,
          signer
        );
        const tx = await erc20.approve(spender, amount);
        const receipt = await tx.wait();
        txHash = receipt.hash;
        console.log(`[executor] approve tx: ${txHash}`);
      } else if (step.action === "swap") {
        // Simulated — no DEX deployed on local testnet
        console.log(
          `[executor] simulated swap: ${step.params?.amountIn} ${step.params?.tokenInLabel} → ${step.params?.tokenOutLabel}`
        );
      } else if (step.action === "stake") {
        // Simulated — no vault deployed on local testnet
        console.log(
          `[executor] simulated stake: ${step.params?.amount} ${step.params?.tokenLabel} → ${step.params?.vaultLabel}`
        );
      }
    } catch (err) {
      status = "failed";
      console.error(`[executor] step ${step.step} failed: ${err.message}`);

      // AI-driven recovery: ask the LLM what to do when a step fails
      if (openai) {
        try {
          const recovery = await openai.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "user",
                content: `I am an autonomous DeFi executor. Step ${
                  step.step
                } (action: ${step.action}, description: "${
                  step.description
                }") failed with error: "${
                  err.message
                }". The remaining steps are: ${steps
                  .slice(steps.indexOf(step) + 1)
                  .map((s) => s.action)
                  .join(
                    ", "
                  )}. Should I retry this step, skip it and continue, or abort the whole plan? Return JSON: { "decision": "retry|skip|abort", "reason": "one concise sentence" }`,
              },
            ],
            max_tokens: 150,
            temperature: 0.1,
          });
          const { decision, reason } = JSON.parse(
            recovery.choices[0].message.content
          );
          transcript.push({
            agent: "executor",
            step: step.step,
            error: err.message,
            aiRecovery: decision,
            reason,
          });
          console.log(`[executor] AI recovery: ${decision} — ${reason}`);

          if (decision === "abort") {
            return res.status(500).json({
              status: false,
              error: `Execution aborted at step ${step.step}: ${reason}`,
              transcript,
            });
          }
          status = decision === "skip" ? "skipped" : "failed";
        } catch (aiErr) {
          console.warn("[executor] AI recovery call failed:", aiErr.message);
          status = "failed";
        }
      }
    }

    executionResults.push({
      step: step.step,
      action: step.action,
      description: step.description ?? "",
      status,
      txHash,
      params: step.params ?? null,
      executedAutonomously: true,
    });
    transcript.push({
      agent: "executor",
      step: step.step,
      action: step.action,
      status,
      txHash,
    });
  }

  // ── Package result for on-chain submission ─────────────────────────────────
  const plan = {
    title: architectResult.planTitle || "Autonomous Agent Chain",
    description:
      `[Scout] ${scoutResult.recommendation} — ` +
      `[Architect] ${
        architectResult.planDescription || architectResult.planTitle
      }`,
    steps: executionResults, // all already executed; key_rotation is protocol-only
    riskLevel: architectResult.riskLevel || "medium",
    estimatedGas: architectResult.estimatedGas || "120000",
    agentAddress,
    context,
    generatedAt: new Date().toISOString(),
    aiGenerated: true,
    autonomous: true,
    agentChain: {
      scout: {
        port: 3002,
        model: scoutResult.model,
        recommendation: scoutResult.recommendation,
        reasoning: scoutResult.reasoning,
        urgency: scoutResult.urgency,
      },
      architect: {
        port: 3003,
        model: architectResult.model,
        planTitle: architectResult.planTitle,
        planDescription: architectResult.planDescription,
      },
      executor: { port: 3001, transcript },
    },
  };

  const serverPlanId = `auto_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  agentPlanStore.set(serverPlanId, plan);
  console.log(
    `[autonomous] ── Chain complete. Ready for confirmation: ${serverPlanId} ──\n`
  );

  res.json({
    status: true,
    serverPlanId,
    planData: JSON.stringify(plan),
    transcript,
  });
});

// POST /agent/notify-rollback
// Called by the wallet after the user chooses "Roll Back" (cancelPlanWithKeyRotation).
// The agent uses the stored unconfirmed WIF to revoke any staged approvals so the
// Bridge can no longer spend tokens on behalf of the unconfirmed key address.
app.post("/agent/notify-rollback", async (req, res) => {
  const { planId } = req.body;

  if (!planId) {
    return res.status(400).json({ status: false, error: "planId is required" });
  }

  const stored = executionStore.get(planId);
  if (!stored?.unconfirmedWIF) {
    console.warn(
      `[agent/notify-rollback] No stored execution for planId=${planId}`
    );
    return res.json({ status: true, planId, revocations: [] });
  }

  let deployments = null;
  try {
    deployments = await getDeployments();
  } catch {
    console.warn("[agent/notify-rollback] Could not read deployments.json");
    return res.json({ status: true, planId, revocations: [] });
  }

  const revocations = [];

  try {
    const agentWallet = createWalletFromWIF(stored.unconfirmedWIF);
    const erc20 = new ethers.Contract(
      deployments.yadaERC20Address,
      ERC20_AGENT_ABI,
      agentWallet
    );

    // Revoke the Bridge allowance that was staged in notify-approved
    const tx = await erc20.approve(deployments.bridgeAddress, 0n);
    const receipt = await tx.wait();
    console.log(
      `[agent/notify-rollback] allowance revoked txHash=${receipt.hash}`
    );
    revocations.push({
      action: "revoke_approve",
      token: deployments.yadaERC20Address,
      spender: deployments.bridgeAddress,
      txHash: receipt.hash,
    });
  } catch (err) {
    console.error(`[agent/notify-rollback] revoke failed: ${err.message}`);
    revocations.push({
      action: "revoke_approve",
      status: "failed",
      error: err.message,
    });
  }

  // Clean up stored execution state
  executionStore.delete(planId);

  res.json({ status: true, planId, revocations });
});

// Increase server timeout to handle long-running deployments
const server = app.listen(port, () => {
  console.log(`Deploy server running at http://localhost:${port}`);
});
server.setTimeout(600000); // 10 minutes
