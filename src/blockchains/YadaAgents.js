/**
 * YadaAgents.js
 *
 * Blockchain module for interacting with the AgentRegistry contract.
 * Mirrors the pattern used by YadaBSC.js and other blockchain modules in this
 * project.
 *
 * Workflow:
 *  1. addAgent()            – register an ERC-8004 agent
 *  2. submitPlan()          – submit an off-chain plan (JSON) for guardian review
 *  3. fetchGuardianAdvice() – guardian relayer posts its analysis (server-side)
 *  4. approvePlan()         – owner approves after reviewing guardian advice
 *  5. executePlan()         – owner commits key hashes; caller then registers
 *                             those keys in KeyLogRegistry to prevent reuse
 */

import { ethers } from "ethers";
import { notifications } from "@mantine/notifications";
import {
  localProvider,
  AGENT_REGISTRY_ABI,
  BRIDGE_ABI,
} from "../shared/constants";
import { fromWIF } from "../utils/hdWallet";
import { createParamsArrayFromObject } from "../utils/signature";

// Plan status enum values (must match AgentRegistry.sol)
export const PlanStatus = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
  EXECUTED: 3,
};

export const PlanStatusLabel = {
  0: "Pending",
  1: "Approved",
  2: "Rejected",
  3: "Executed",
};

class YadaAgents {
  constructor() {}

  // ── Helpers ───────────────────────────────────────────────────────────────

  _registry(contractAddresses, signer) {
    return new ethers.Contract(
      contractAddresses.agentRegistryAddress,
      AGENT_REGISTRY_ABI,
      signer
    );
  }

  _bridge(contractAddresses, signer) {
    return new ethers.Contract(
      contractAddresses.bridgeAddress,
      BRIDGE_ABI,
      signer
    );
  }

  /**
   * Resolve the prevPublicKeyHash to use when registering a key in the KeyLogRegistry.
   * If the predecessor is already registered in the chain (`chainOf` is non-zero), use
   * the QR value so the rotation continues the existing chain.  Otherwise use ZeroAddress
   * so the key is registered as an inception entry (first time on this BSC registry).
   */
  async _getPrevPublicKeyHash(contractAddresses, prevPublicKeyHashFromQR) {
    if (
      !prevPublicKeyHashFromQR ||
      prevPublicKeyHashFromQR === ethers.ZeroAddress
    ) {
      return ethers.ZeroAddress;
    }
    if (!contractAddresses.keyLogRegistryAddress) return ethers.ZeroAddress;
    const klr = new ethers.Contract(
      contractAddresses.keyLogRegistryAddress,
      ["function getChainRoot(address) view returns (address, bool)"],
      localProvider
    );
    const [, exists] = await klr.getChainRoot(prevPublicKeyHashFromQR);
    return exists ? prevPublicKeyHashFromQR : ethers.ZeroAddress;
  }

  _getSigner(privateKey) {
    return new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
  }

  // ── Agent management ──────────────────────────────────────────────────────

  /**
   * Fetch all registered agents from the contract.
   * @returns {Promise<Agent[]>}
   */
  async fetchAgents(appContext) {
    const { privateKey, contractAddresses, setAgents } = appContext;
    if (!contractAddresses?.agentRegistryAddress || !privateKey) return [];

    try {
      const signer = this._getSigner(privateKey);
      const registry = this._registry(contractAddresses, signer);
      const addresses = await registry.getAgents();

      const agents = await Promise.all(
        addresses.map(async (addr) => {
          const a = await registry.getAgent(addr);
          return {
            agentAddress: a.agentAddress,
            name: a.name,
            endpointURI: a.endpointURI,
            capabilitiesURI: a.capabilitiesURI,
            trusted: a.trusted,
          };
        })
      );

      setAgents(agents);
      return agents;
    } catch (err) {
      console.error("fetchAgents error:", err);
      notifications.show({
        title: "Error",
        message: "Failed to fetch agents",
        color: "red",
      });
      return [];
    }
  }

  /**
   * Register a new agent.
   * @param {object} agentData { agentAddress, name, endpointURI, capabilitiesURI, trusted }
   */
  async addAgent(appContext, agentData) {
    const { privateKey, contractAddresses } = appContext;
    const signer = this._getSigner(privateKey);
    const registry = this._registry(contractAddresses, signer);

    const tx = await registry.addAgent(
      agentData.agentAddress,
      agentData.name,
      agentData.endpointURI || "",
      agentData.capabilitiesURI || "",
      agentData.trusted ?? true
    );
    await tx.wait();

    notifications.show({
      title: "Agent registered",
      message: `"${agentData.name}" added to the registry`,
      color: "green",
    });

    await this.fetchAgents(appContext);
  }

  /**
   * Remove an agent.
   */
  async removeAgent(appContext, agentAddress) {
    const { privateKey, contractAddresses } = appContext;
    const signer = this._getSigner(privateKey);
    const registry = this._registry(contractAddresses, signer);

    const tx = await registry.removeAgent(agentAddress);
    await tx.wait();

    notifications.show({
      title: "Agent removed",
      message: `Agent ${agentAddress} removed`,
      color: "yellow",
    });

    await this.fetchAgents(appContext);
  }

  /**
   * Toggle the trusted flag of an agent.
   */
  async setAgentTrust(appContext, agentAddress, trusted) {
    const { privateKey, contractAddresses } = appContext;
    const signer = this._getSigner(privateKey);
    const registry = this._registry(contractAddresses, signer);

    const tx = await registry.setAgentTrust(agentAddress, trusted);
    await tx.wait();
    await this.fetchAgents(appContext);
  }

  // ── Plan workflow ─────────────────────────────────────────────────────────

  /**
   * Submit a plan obtained off-chain (via endpointURI or any other means).
   * Sets the pending plan in context and triggers guardian review.
   *
   * @param {string} agentAddress  Agent that produced the plan
   * @param {string} planData      JSON string with the plan payload
   * @returns {Promise<string>}    planId (bytes32 hex)
   */
  async submitPlan(appContext, agentAddress, planData) {
    const { privateKey, contractAddresses, setPendingAgentPlan } = appContext;
    const signer = this._getSigner(privateKey);

    // Dev-only: auto-top-up the signing key if it has no ETH on the local node.
    try {
      const balance = await localProvider.getBalance(signer.address);
      if (balance === 0n) {
        await fetch("http://localhost:3001/dev/fund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: signer.address }),
        });
      }
    } catch {
      // Ignore — will surface as the real tx failure if this also fails
    }

    const registry = this._registry(contractAddresses, signer);

    const tx = await registry.submitPlan(agentAddress, planData);
    const receipt = await tx.wait();

    // Retrieve planId from the PlanSubmitted event
    const event = receipt.logs
      .map((l) => {
        try {
          return registry.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "PlanSubmitted");

    const planId = event?.args?.planId;

    if (planId) {
      const plan = await registry.getPlan(planId);
      setPendingAgentPlan({
        planId,
        agentAddress: plan.agentAddress,
        planData: plan.planData,
        guardianAdvice: plan.guardianAdvice,
        status: Number(plan.status),
        assignedKeys: [...plan.assignedKeys],
        createdAt: Number(plan.createdAt),
      });

      // Fire-and-forget — guardian runs in the background; the modal fetches
      // the verdict directly and doesn't wait for the on-chain write.
      this.requestGuardianAnalysis(appContext, planId, planData, agentAddress);
    }

    return planId;
  }

  /**
   * Fetch a plan from the contract and update context.
   */
  async fetchPlan(appContext, planId) {
    const { privateKey, contractAddresses, setPendingAgentPlan } = appContext;
    const signer = this._getSigner(privateKey);
    const registry = this._registry(contractAddresses, signer);

    const plan = await registry.getPlan(planId);
    const hydrated = {
      planId,
      agentAddress: plan.agentAddress,
      planData: plan.planData,
      guardianAdvice: plan.guardianAdvice,
      status: Number(plan.status),
      assignedKeys: [...plan.assignedKeys],
      createdAt: Number(plan.createdAt),
      resolvedAt: Number(plan.resolvedAt),
    };
    setPendingAgentPlan(hydrated);
    return hydrated;
  }

  /**
   * Poll the contract until guardian advice arrives (status still PENDING
   * but guardianAdvice is non-empty) or a timeout is reached.
   */
  async pollForGuardianAdvice(
    appContext,
    planId,
    timeoutMs = 60000,
    intervalMs = 3000
  ) {
    const {
      privateKey,
      contractAddresses,
      setPendingAgentPlan,
      setGuardianVerdict,
    } = appContext;
    const signer = this._getSigner(privateKey);
    const registry = this._registry(contractAddresses, signer);
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve) => {
      const poll = async () => {
        try {
          const plan = await registry.getPlan(planId);
          if (plan.guardianAdvice && plan.guardianAdvice !== "") {
            let advice;
            try {
              advice = JSON.parse(plan.guardianAdvice);
            } catch {
              advice = { raw: plan.guardianAdvice };
            }
            setGuardianVerdict(advice);
            setPendingAgentPlan((prev) => ({
              ...prev,
              guardianAdvice: plan.guardianAdvice,
            }));
            resolve(advice);
            return;
          }
        } catch (err) {
          console.warn("pollForGuardianAdvice:", err.message);
        }
        if (Date.now() < deadline) {
          setTimeout(poll, intervalMs);
        } else {
          resolve(null); // timed out
        }
      };
      poll();
    });
  }

  /**
   * Approve a pending plan by routing through the Bridge.
   * Registers the unconfirmed key in KeyLogRegistry and records the approval
   * in AgentRegistry. The AI agent is handed this key to sign its transactions
   * (those remain pending until the confirming key is presented at execute time).
   *
   * @param {object} unconfirmedKey  Parsed QR key object (wif, publicKeyHash, prerotatedKeyHash, ...)
   */
  async approvePlan(appContext, planId, unconfirmedKey) {
    const {
      contractAddresses,
      setPendingAgentPlan,
      pendingAgentPlan,
      agents,
      setExecutionResults,
    } = appContext;

    // Signer for the tx must be the unconfirmed key (msg.sender == publicKeyHash)
    const signer = new ethers.Wallet(
      ethers.hexlify(fromWIF(unconfirmedKey.wif).privateKey),
      localProvider
    );

    const bridge = this._bridge(contractAddresses, signer);
    const nonce = await bridge.nonces(signer.address);

    // Resolve prevPublicKeyHash: only continue the existing chain when the predecessor
    // is already registered on-chain; otherwise start a fresh inception chain.
    const resolvedPrev = await this._getPrevPublicKeyHash(
      contractAddresses,
      unconfirmedKey.prevPublicKeyHash
    );

    const unconfirmedParams = {
      amount: 0n,
      publicKey: unconfirmedKey.keyData.publicKey,
      prerotatedKeyHash: unconfirmedKey.prerotatedKeyHash,
      twicePrerotatedKeyHash: unconfirmedKey.twicePrerotatedKeyHash,
      prevPublicKeyHash: resolvedPrev,
      outputAddress: unconfirmedKey.prerotatedKeyHash,
    };

    const sigFields = [
      "bytes32",
      "tuple(uint256,bytes,address,address,address,address)",
      "uint256",
    ];
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

    const unconfirmedHash = ethers.keccak256(
      abiCoder.encode(sigFields, [
        planId,
        createParamsArrayFromObject(unconfirmedParams),
        nonce,
      ])
    );
    const unconfirmedSignature = await signer.signMessage(
      ethers.getBytes(unconfirmedHash)
    );

    // Optional native BNB permit: transfer balance minus estimated gas reserve
    const balance = await localProvider.getBalance(signer.address);
    let permits = [];
    let msgValue = 0n;

    if (balance > 0n) {
      const feeData = await localProvider.getFeeData();
      const gasPrice = feeData.gasPrice ?? ethers.parseUnits("5", "gwei");
      const gasReserve = 1000000n * gasPrice;
      const transferAmount = balance > gasReserve ? balance - gasReserve : 0n;

      if (transferAmount > 0n) {
        permits = [
          {
            token: ethers.ZeroAddress,
            amount: transferAmount,
            deadline: 0,
            v: 0,
            r: ethers.zeroPadBytes("0x", 32),
            s: ethers.zeroPadBytes("0x", 32),
            recipients: [
              {
                recipientAddress: unconfirmedKey.prerotatedKeyHash,
                amount: transferAmount,
                wrap: false,
                unwrap: false,
                mint: false,
                burn: false,
              },
            ],
          },
        ];
        msgValue = transferAmount;
      }
    }

    const ctx = {
      planId,
      permits,
      fee: { token: ethers.ZeroAddress, fee: 0n, expires: 0n, signature: "0x" },
      unconfirmed: createParamsArrayFromObject(unconfirmedParams),
      unconfirmedSignature,
    };

    const tx = await bridge.approvePlanWithKeyRotation(ctx, {
      value: msgValue,
    });
    await tx.wait();

    // Notify the agent to execute the plan steps using the unconfirmed key.
    // We await the result so the UI waits for the agent to finish before
    // opening the execute scanner.
    const planData = pendingAgentPlan?.planData;
    if (planData) {
      const agentInfo = (agents || []).find(
        (a) => a.agentAddress === pendingAgentPlan?.agentAddress
      );
      const agentBase = (() => {
        const uri = agentInfo?.endpointURI;
        if (!uri) return "http://localhost:3001";
        try {
          return new URL(uri).origin;
        } catch {
          return "http://localhost:3001";
        }
      })();
      try {
        const notifyResp = await fetch(`${agentBase}/agent/notify-approved`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId,
            planData,
            unconfirmedWIF: unconfirmedKey.wif,
          }),
        });
        if (notifyResp.ok) {
          const notifyData = await notifyResp.json();
          if (notifyData.executionSummary) {
            setExecutionResults({
              results: notifyData.results ?? [],
              summary: notifyData.executionSummary,
            });
          }
        }
      } catch (err) {
        console.warn("[approvePlan] notify-approved call failed:", err.message);
      }
    }

    setPendingAgentPlan((prev) => ({ ...prev, status: PlanStatus.APPROVED }));

    notifications.show({
      title: "Plan approved",
      message: "Key registered — agent executing plan",
      color: "green",
    });
  }

  /**
   * Owner rejects a pending plan.
   */
  async rejectPlan(appContext, planId) {
    const { privateKey, contractAddresses, setPendingAgentPlan } = appContext;
    const signer = this._getSigner(privateKey);
    const registry = this._registry(contractAddresses, signer);

    const tx = await registry.rejectPlan(planId);
    await tx.wait();

    setPendingAgentPlan((prev) => ({ ...prev, status: PlanStatus.REJECTED }));

    notifications.show({
      title: "Plan rejected",
      message: "No keys were committed",
      color: "red",
    });
  }

  /**
   * Execute an approved agent plan by routing through the Bridge.
   * Registers the confirming key (whose prevPublicKeyHash == the approver's key)
   * in KeyLogRegistry, proving the same owner is completing the operation,
   * then commits the plan as EXECUTED in AgentRegistry.
   *
   * @param {object} confirmingKey  Parsed QR key object for the confirming/execute key
   */
  async executePlan(appContext, planId, confirmingKey) {
    const { contractAddresses, setPendingAgentPlan, setLoading } = appContext;
    setLoading(true);

    try {
      // Signer for the tx must be the confirming key (msg.sender == confirmingPublicKeyHash)
      const signer = new ethers.Wallet(
        ethers.hexlify(fromWIF(confirmingKey.wif).privateKey),
        localProvider
      );

      const bridge = this._bridge(contractAddresses, signer);
      const nonce = await bridge.nonces(signer.address);

      const confirmingParams = {
        amount: 0n,
        publicKey: confirmingKey.keyData.publicKey,
        prerotatedKeyHash: confirmingKey.prerotatedKeyHash,
        twicePrerotatedKeyHash: confirmingKey.twicePrerotatedKeyHash,
        prevPublicKeyHash: confirmingKey.prevPublicKeyHash,
        outputAddress: confirmingKey.prerotatedKeyHash,
      };

      const sigFields = [
        "bytes32",
        "tuple(uint256,bytes,address,address,address,address)",
        "uint256",
      ];
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();

      const confirmingHash = ethers.keccak256(
        abiCoder.encode(sigFields, [
          planId,
          createParamsArrayFromObject(confirmingParams),
          nonce,
        ])
      );
      const confirmingSignature = await signer.signMessage(
        ethers.getBytes(confirmingHash)
      );

      const balance = await localProvider.getBalance(signer.address);
      let permits = [];
      let msgValue = 0n;

      if (balance > 0n) {
        const feeData = await localProvider.getFeeData();
        const gasPrice = feeData.gasPrice ?? ethers.parseUnits("5", "gwei");
        const gasReserve = 1000000n * gasPrice;
        const transferAmount = balance > gasReserve ? balance - gasReserve : 0n;

        if (transferAmount > 0n) {
          permits = [
            {
              token: ethers.ZeroAddress,
              amount: transferAmount,
              deadline: 0,
              v: 0,
              r: ethers.zeroPadBytes("0x", 32),
              s: ethers.zeroPadBytes("0x", 32),
              recipients: [
                {
                  recipientAddress: confirmingKey.prerotatedKeyHash,
                  amount: transferAmount,
                  wrap: false,
                  unwrap: false,
                  mint: false,
                  burn: false,
                },
              ],
            },
          ];
          msgValue = transferAmount;
        }
      }

      const ctx = {
        planId,
        permits,
        fee: {
          token: ethers.ZeroAddress,
          fee: 0n,
          expires: 0n,
          signature: "0x",
        },
        confirming: createParamsArrayFromObject(confirmingParams),
        confirmingSignature,
      };

      const tx = await bridge.executePlanWithKeyRotation(ctx, {
        value: msgValue,
      });
      await tx.wait();

      setPendingAgentPlan((prev) => ({
        ...prev,
        status: PlanStatus.EXECUTED,
        assignedKeys: [confirmingKey.publicKeyHash],
      }));

      notifications.show({
        title: "Plan executed",
        message: "Confirming key registered — plan executed",
        color: "teal",
      });
    } catch (err) {
      console.error("executePlan error:", err);
      notifications.show({
        title: "Execution failed",
        message: err.message ?? "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }

  /**
   * Cancel an approved agent plan — scans the confirming key (advancing the
   * key log chain as normal) but marks the plan REJECTED instead of EXECUTED.
   * Use this when the user wants to reject the agent's actions after seeing
   * the execution summary.
   *
   * @param {object} confirmingKey  Parsed QR key object for the confirming/cancel key
   */
  async cancelPlan(appContext, planId, confirmingKey) {
    const {
      contractAddresses,
      setPendingAgentPlan,
      setLoading,
      agents,
      pendingAgentPlan,
    } = appContext;
    setLoading(true);

    try {
      const signer = new ethers.Wallet(
        ethers.hexlify(fromWIF(confirmingKey.wif).privateKey),
        localProvider
      );

      const bridge = this._bridge(contractAddresses, signer);
      const nonce = await bridge.nonces(signer.address);

      const confirmingParams = {
        amount: 0n,
        publicKey: confirmingKey.keyData.publicKey,
        prerotatedKeyHash: confirmingKey.prerotatedKeyHash,
        twicePrerotatedKeyHash: confirmingKey.twicePrerotatedKeyHash,
        prevPublicKeyHash: confirmingKey.prevPublicKeyHash,
        outputAddress: confirmingKey.prerotatedKeyHash,
      };

      const sigFields = [
        "bytes32",
        "tuple(uint256,bytes,address,address,address,address)",
        "uint256",
      ];
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();

      const confirmingHash = ethers.keccak256(
        abiCoder.encode(sigFields, [
          planId,
          createParamsArrayFromObject(confirmingParams),
          nonce,
        ])
      );
      const confirmingSignature = await signer.signMessage(
        ethers.getBytes(confirmingHash)
      );

      const balance = await localProvider.getBalance(signer.address);
      let permits = [];
      let msgValue = 0n;

      if (balance > 0n) {
        const feeData = await localProvider.getFeeData();
        const gasPrice = feeData.gasPrice ?? ethers.parseUnits("5", "gwei");
        const gasReserve = 1000000n * gasPrice;
        const transferAmount = balance > gasReserve ? balance - gasReserve : 0n;

        if (transferAmount > 0n) {
          permits = [
            {
              token: ethers.ZeroAddress,
              amount: transferAmount,
              deadline: 0,
              v: 0,
              r: ethers.zeroPadBytes("0x", 32),
              s: ethers.zeroPadBytes("0x", 32),
              recipients: [
                {
                  recipientAddress: confirmingKey.prerotatedKeyHash,
                  amount: transferAmount,
                  wrap: false,
                  unwrap: false,
                  mint: false,
                  burn: false,
                },
              ],
            },
          ];
          msgValue = transferAmount;
        }
      }

      const ctx = {
        planId,
        permits,
        fee: {
          token: ethers.ZeroAddress,
          fee: 0n,
          expires: 0n,
          signature: "0x",
        },
        confirming: createParamsArrayFromObject(confirmingParams),
        confirmingSignature,
      };

      const tx = await bridge.cancelPlanWithKeyRotation(ctx, {
        value: msgValue,
      });
      await tx.wait();

      // Ask the agent to revoke any staged on-chain state (e.g. token approvals)
      const agentInfo = (agents || []).find(
        (a) => a.agentAddress === pendingAgentPlan?.agentAddress
      );
      const agentBase = (() => {
        const uri = agentInfo?.endpointURI;
        if (!uri) return "http://localhost:3001";
        try {
          return new URL(uri).origin;
        } catch {
          return "http://localhost:3001";
        }
      })();
      try {
        await fetch(`${agentBase}/agent/notify-rollback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId }),
        });
      } catch (err) {
        console.warn("[cancelPlan] notify-rollback call failed:", err.message);
      }

      setPendingAgentPlan((prev) => ({
        ...prev,
        status: PlanStatus.REJECTED,
      }));

      notifications.show({
        title: "Plan cancelled",
        message: "Confirming key registered — plan rejected",
        color: "orange",
      });
    } catch (err) {
      console.error("cancelPlan error:", err);
      notifications.show({
        title: "Cancellation failed",
        message: err.message ?? "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }

  // ── Plan request from external agent ────────────────────────────────────

  /**
   * Ask the external agent server to generate a plan, then submit it on-chain.
   * The raw JSON is never surfaced in the UI — the user only sees the
   * structured guardian report in AgentPlanReview.
   *
   * @param {string} agentAddress  Registered agent address to use
   * @param {object} context       Optional context object forwarded to the agent
   * @returns {Promise<string>}    on-chain planId (bytes32 hex)
   */
  async requestPlanFromAgent(appContext, agentAddress, context = {}) {
    const { agents } = appContext;
    const agentInfo = agents.find((a) => a.agentAddress === agentAddress);
    const base = (() => {
      const uri = agentInfo?.endpointURI;
      if (!uri) return "http://localhost:3001";
      try {
        return new URL(uri).origin; // strips any path, gives scheme://host:port
      } catch {
        return "http://localhost:3001";
      }
    })();

    const resp = await fetch(`${base}/agent/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, agentAddress }),
    });
    if (!resp.ok) throw new Error(`Agent server returned ${resp.status}`);
    const { planData } = await resp.json();

    // Submit on-chain — user never sees planData directly
    return this.submitPlan(appContext, agentAddress, planData);
  }

  /**
   * Ask the agent server to call OpenAI and generate a plan based on the
   * wallet's live on-chain balances.  The LLM decides what to do and why.
   * Requires OPENAI_API_KEY on the server.
   */
  async requestAIPlanFromAgent(appContext, agentAddress, context = {}) {
    const { privateKey, agents } = appContext;
    const signer = this._getSigner(privateKey);
    const agentInfo = agents.find((a) => a.agentAddress === agentAddress);
    const base = (() => {
      const uri = agentInfo?.endpointURI;
      if (!uri) return "http://localhost:3001";
      try {
        return new URL(uri).origin;
      } catch {
        return "http://localhost:3001";
      }
    })();

    const resp = await fetch(`${base}/agent/plan/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context,
        agentAddress,
        walletAddress: signer.address,
      }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || `Agent server returned ${resp.status}`);
    }
    const { planData } = await resp.json();
    return this.submitPlan(appContext, agentAddress, planData);
  }

  /**
   * Run a fully autonomous three-agent AI chain:
   *   Scout  (port 3002) — reads chain state, asks LLM what to do
   *   Architect (port 3003) — asks LLM to build the exact step plan
   *   Executor (server.js) — executes on-chain; AI handles failures
   *
   * The private key is sent to the local dev server so the executor can sign
   * transactions.  All steps run without human input.  The completed plan is
   * submitted to the on-chain AgentRegistry and returned here as pending
   * confirmation — the user's confirming key scan is the only human action.
   */
  async runAutonomousAgentChain(appContext, agentAddress, context = {}) {
    const { privateKey, agents } = appContext;
    const signer = this._getSigner(privateKey);
    const privateKeyHex = ethers.hexlify(privateKey.privateKey);

    const agentInfo = agents.find((a) => a.agentAddress === agentAddress);
    const base = (() => {
      const uri = agentInfo?.endpointURI;
      if (!uri) return "http://localhost:3001";
      try {
        return new URL(uri).origin;
      } catch {
        return "http://localhost:3001";
      }
    })();

    // Auto-fund if the wallet has no native balance
    try {
      const balance = await localProvider.getBalance(signer.address);
      if (balance === 0n) {
        await fetch("http://localhost:3001/dev/fund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: signer.address }),
        });
      }
    } catch {}

    const resp = await fetch(`${base}/agent/run-autonomous`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privateKeyHex, agentAddress, context }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || `Agent server returned ${resp.status}`);
    }
    const { planData } = await resp.json();
    return this.submitPlan(appContext, agentAddress, planData);
  }

  /**
   * Ask the agent server for a yield-optimisation plan (Coinbase AgentKit-style),
   * then submit it on-chain.  Identical flow to requestPlanFromAgent but hits
   * the /agent/plan/yield endpoint.
   */
  async requestYieldPlanFromAgent(appContext, agentAddress, context = {}) {
    const { agents } = appContext;
    const agentInfo = agents.find((a) => a.agentAddress === agentAddress);
    const base = (() => {
      const uri = agentInfo?.endpointURI;
      if (!uri) return "http://localhost:3001";
      try {
        return new URL(uri).origin;
      } catch {
        return "http://localhost:3001";
      }
    })();

    const resp = await fetch(`${base}/agent/plan/yield`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, agentAddress }),
    });
    if (!resp.ok) throw new Error(`Agent server returned ${resp.status}`);
    const { planData } = await resp.json();

    return this.submitPlan(appContext, agentAddress, planData);
  }

  // ── Guardian helpers ──────────────────────────────────────────────────────

  /**
   * Request guardian analysis from the agent server.
   * Sets guardianVerdict in context immediately after the HTTP response,
   * then best-effort writes the advice on-chain.
   * Safe to call from both submitPlan (fire-and-forget) and the review modal.
   */
  async requestGuardianAnalysis(appContext, planId, planData, agentAddress) {
    const {
      privateKey,
      contractAddresses,
      agents,
      setPendingAgentPlan,
      setGuardianVerdict,
    } = appContext;

    const agentInfo = (agents || []).find(
      (a) => a.agentAddress === agentAddress
    );
    const base = (() => {
      const uri = agentInfo?.endpointURI;
      if (!uri) return "http://localhost:3001";
      try {
        return new URL(uri).origin;
      } catch {
        return "http://localhost:3001";
      }
    })();

    try {
      const resp = await fetch(`${base}/agent/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, planData }),
      });
      if (!resp.ok) return;
      const analysis = await resp.json();

      // Update context immediately so any open modal can pick it up
      setGuardianVerdict(analysis);
      const adviceJson = JSON.stringify(analysis);
      setPendingAgentPlan((prev) =>
        prev ? { ...prev, guardianAdvice: adviceJson } : prev
      );

      // Best-effort on-chain write — don't block on failures
      try {
        const signer = this._getSigner(privateKey);
        const registry = this._registry(contractAddresses, signer);

        if (analysis.blocked) {
          await registry.rejectPlan(planId);
          setPendingAgentPlan((prev) =>
            prev ? { ...prev, status: PlanStatus.REJECTED } : prev
          );
          notifications.show({
            title: "Plan blocked by guardian",
            message: analysis.summary,
            color: "red",
            autoClose: 8000,
          });
        } else {
          await registry.submitGuardianAdvice(planId, adviceJson);
        }
      } catch (onChainErr) {
        console.warn(
          "Guardian on-chain write failed (advice shown in UI only):",
          onChainErr.message
        );
      }
    } catch (err) {
      console.warn("Guardian analysis failed:", err.message);
    }
  }

  // ── Fetch all plans ───────────────────────────────────────────────────────

  async fetchPlans(appContext) {
    const { privateKey, contractAddresses, setAgentPlans } = appContext;
    if (!contractAddresses?.agentRegistryAddress || !privateKey) return [];

    try {
      const signer = this._getSigner(privateKey);
      const registry = this._registry(contractAddresses, signer);
      const planIds = await registry.getPlans();

      const plans = await Promise.all(
        planIds.map(async (id) => {
          const p = await registry.getPlan(id);
          return {
            planId: id,
            agentAddress: p.agentAddress,
            planData: p.planData,
            guardianAdvice: p.guardianAdvice,
            status: Number(p.status),
            assignedKeys: [...p.assignedKeys],
            createdAt: Number(p.createdAt),
            resolvedAt: Number(p.resolvedAt),
          };
        })
      );

      setAgentPlans(plans);
      return plans;
    } catch (err) {
      console.error("fetchPlans error:", err);
      return [];
    }
  }
}

export const yadaAgents = new YadaAgents();
