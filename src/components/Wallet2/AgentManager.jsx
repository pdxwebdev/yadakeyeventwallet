/**
 * AgentManager.jsx
 *
 * Panel for registering, viewing and removing ERC-8004 AI agents.
 * Rendered inside the "Agents" section of Wallet2.
 */

import { useState } from "react";
import {
  Card,
  Title,
  Text,
  Button,
  TextInput,
  Switch,
  Group,
  Stack,
  Badge,
  ActionIcon,
  Divider,
  Accordion,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconPlus,
  IconTrash,
  IconRefresh,
  IconRobot,
  IconShieldCheck,
  IconClipboardList,
  IconSparkles,
  IconTrendingUp,
} from "@tabler/icons-react";
import { useAppContext } from "../../context/AppContext";
import {
  yadaAgents,
  PlanStatus,
  PlanStatusLabel,
} from "../../blockchains/YadaAgents";

const EMPTY_FORM = {
  agentAddress: "",
  name: "",
  endpointURI: "",
  capabilitiesURI: "",
  trusted: true,
};

const STATUS_COLOR = {
  [PlanStatus.PENDING]: "blue",
  [PlanStatus.APPROVED]: "teal",
  [PlanStatus.REJECTED]: "red",
  [PlanStatus.EXECUTED]: "violet",
};

export default function AgentManager({
  onPlanReceived,
  onScanRequired,
  onExecuteRequired,
}) {
  const appContext = useAppContext();
  const { agents, agentPlans, contractAddresses, privateKey } = appContext;

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [requestingPlan, setRequestingPlan] = useState({}); // agentAddress → bool

  const isReady = !!contractAddresses?.agentRegistryAddress && !!privateKey;

  // ── Agent registration ──────────────────────────────────────────────────

  const handleAddAgent = async () => {
    if (!form.agentAddress || !form.name) {
      notifications.show({
        title: "Validation",
        message: "Address and name are required",
        color: "yellow",
      });
      return;
    }
    setSubmitting(true);
    try {
      await yadaAgents.addAgent(appContext, form);
      setForm(EMPTY_FORM);
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err.reason || err.message,
        color: "red",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (agentAddress) => {
    try {
      await yadaAgents.removeAgent(appContext, agentAddress);
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err.reason || err.message,
        color: "red",
      });
    }
  };

  const handleToggleTrust = async (agentAddress, current) => {
    try {
      await yadaAgents.setAgentTrust(appContext, agentAddress, !current);
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err.reason || err.message,
        color: "red",
      });
    }
  };

  const handleRefresh = async () => {
    try {
      await Promise.all([
        yadaAgents.fetchAgents(appContext),
        yadaAgents.fetchPlans(appContext),
      ]);
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err.message,
        color: "red",
      });
    }
  };

  const handleRequestPlan = async (agentAddress) => {
    setRequestingPlan((prev) => ({ ...prev, [agentAddress]: true }));
    try {
      const planId = await yadaAgents.requestPlanFromAgent(
        appContext,
        agentAddress
      );
      await yadaAgents.fetchPlans(appContext);
      if (onPlanReceived) onPlanReceived(planId);
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err.reason || err.message,
        color: "red",
      });
    } finally {
      setRequestingPlan((prev) => ({ ...prev, [agentAddress]: false }));
    }
  };

  const handleRequestYieldPlan = async (agentAddress) => {
    setRequestingPlan((prev) => ({ ...prev, [`yield_${agentAddress}`]: true }));
    try {
      const planId = await yadaAgents.requestYieldPlanFromAgent(
        appContext,
        agentAddress
      );
      await yadaAgents.fetchPlans(appContext);
      if (onPlanReceived) onPlanReceived(planId);
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err.reason || err.message,
        color: "red",
      });
    } finally {
      setRequestingPlan((prev) => ({
        ...prev,
        [`yield_${agentAddress}`]: false,
      }));
    }
  };

  const handleRequestAIPlan = async (agentAddress) => {
    setRequestingPlan((prev) => ({ ...prev, [`ai_${agentAddress}`]: true }));
    try {
      const planId = await yadaAgents.requestAIPlanFromAgent(
        appContext,
        agentAddress
      );
      await yadaAgents.fetchPlans(appContext);
      if (onPlanReceived) onPlanReceived(planId);
    } catch (err) {
      notifications.show({
        title: "AI Agent Error",
        message: err.reason || err.message,
        color: "red",
      });
    } finally {
      setRequestingPlan((prev) => ({ ...prev, [`ai_${agentAddress}`]: false }));
    }
  };

  const handleRunAutonomousChain = async (agentAddress) => {
    setRequestingPlan((prev) => ({ ...prev, [`auto_${agentAddress}`]: true }));
    try {
      const planId = await yadaAgents.runAutonomousAgentChain(
        appContext,
        agentAddress
      );
      await yadaAgents.fetchPlans(appContext);
      if (onPlanReceived) onPlanReceived(planId);
    } catch (err) {
      notifications.show({
        title: "Autonomous Chain Error",
        message: err.reason || err.message,
        color: "red",
      });
    } finally {
      setRequestingPlan((prev) => ({
        ...prev,
        [`auto_${agentAddress}`]: false,
      }));
    }
  };

  const handleReviewPlan = async (planId) => {
    try {
      const plan = await yadaAgents.fetchPlan(appContext, planId);
      if (plan?.status === PlanStatus.APPROVED && onExecuteRequired) {
        // Plan already approved — open execute scanner directly
        onExecuteRequired(planId);
      } else if (plan?.status === PlanStatus.APPROVED && onScanRequired) {
        // Fallback: no execute handler wired, use legacy scan path
        onScanRequired(planId);
      } else {
        if (onPlanReceived) onPlanReceived(planId);
      }
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err.reason || err.message,
        color: "red",
      });
    }
  };

  // ── Plan submission ────────────────────────────────────────────────────

  const handleSubmitPlan = async (agentAddress) => {
    const planData = planInputs[agentAddress] || "";
    if (!planData.trim()) {
      notifications.show({
        title: "Validation",
        message: "Paste the agent's plan JSON first",
        color: "yellow",
      });
      return;
    }
    try {
      const planId = await yadaAgents.submitPlan(
        appContext,
        agentAddress,
        planData
      );
      notifications.show({
        title: "Plan submitted",
        message: `ID: ${planId?.slice(0, 10)}…`,
        color: "blue",
      });
      if (onPlanReceived) onPlanReceived(planId);
      // Clear the input
      setPlanInputs((prev) => ({ ...prev, [agentAddress]: "" }));
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err.reason || err.message,
        color: "red",
      });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (!isReady) {
    return (
      <Card withBorder p="md" radius="md">
        <Text c="dimmed" size="sm">
          Agent registry not deployed or wallet not connected.
        </Text>
      </Card>
    );
  }

  return (
    <Stack gap="md">
      {/* ── Add agent form ──────────────────────────────────────────── */}
      <Card withBorder p="md" radius="md">
        <Title order={5} mb="sm">
          Register ERC-8004 Agent
        </Title>
        <Stack gap="xs">
          <TextInput
            label="Agent contract address"
            placeholder="0x…"
            value={form.agentAddress}
            onChange={(e) =>
              setForm((f) => ({ ...f, agentAddress: e.target.value }))
            }
          />
          <TextInput
            label="Display name"
            placeholder="My DeFi AI Agent"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <TextInput
            label="Off-chain endpoint URI (optional)"
            placeholder="https://…"
            value={form.endpointURI}
            onChange={(e) =>
              setForm((f) => ({ ...f, endpointURI: e.target.value }))
            }
          />
          <TextInput
            label="Capabilities URI (optional)"
            placeholder="ipfs://… or https://…"
            value={form.capabilitiesURI}
            onChange={(e) =>
              setForm((f) => ({ ...f, capabilitiesURI: e.target.value }))
            }
          />
          <Switch
            label="Mark as trusted immediately"
            checked={form.trusted}
            onChange={(e) =>
              setForm((f) => ({ ...f, trusted: e.currentTarget.checked }))
            }
          />
          <Button
            leftSection={<IconPlus size={14} />}
            loading={submitting}
            onClick={handleAddAgent}
          >
            Add Agent
          </Button>
        </Stack>
      </Card>

      {/* ── Registered agents list ──────────────────────────────────── */}
      <Card withBorder p="md" radius="md">
        <Group justify="space-between" mb="sm">
          <Title order={5}>Registered Agents</Title>
          <Tooltip label="Refresh list">
            <ActionIcon variant="subtle" onClick={handleRefresh}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {agents.length === 0 ? (
          <Text c="dimmed" size="sm">
            No agents registered yet.
          </Text>
        ) : (
          <Accordion variant="separated">
            {agents.map((agent) => (
              <Accordion.Item
                key={agent.agentAddress}
                value={agent.agentAddress}
              >
                <Accordion.Control icon={<IconRobot size={16} />}>
                  <Group gap="xs">
                    <Text size="sm" fw={600}>
                      {agent.name}
                    </Text>
                    <Badge
                      size="xs"
                      color={agent.trusted ? "teal" : "gray"}
                      leftSection={
                        agent.trusted ? <IconShieldCheck size={10} /> : null
                      }
                    >
                      {agent.trusted ? "Trusted" : "Untrusted"}
                    </Badge>
                  </Group>
                </Accordion.Control>

                <Accordion.Panel>
                  <Stack gap="xs">
                    <Text size="xs" c="dimmed">
                      {agent.agentAddress}
                    </Text>
                    {agent.endpointURI && (
                      <Text size="xs" c="dimmed">
                        Endpoint: {agent.endpointURI}
                      </Text>
                    )}
                    {agent.capabilitiesURI && (
                      <Text size="xs" c="dimmed">
                        Capabilities: {agent.capabilitiesURI}
                      </Text>
                    )}

                    <Divider
                      my="xs"
                      label="Request a plan from this agent"
                      labelPosition="left"
                    />

                    <Group gap="xs">
                      <Button
                        size="xs"
                        leftSection={<IconRobot size={13} />}
                        loading={requestingPlan[agent.agentAddress]}
                        onClick={() => handleRequestPlan(agent.agentAddress)}
                      >
                        Request Plan from Agent
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="violet"
                        leftSection={<IconSparkles size={13} />}
                        loading={requestingPlan[`ai_${agent.agentAddress}`]}
                        onClick={() => handleRequestAIPlan(agent.agentAddress)}
                      >
                        AI Advisor (GPT-4o)
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="teal"
                        leftSection={<IconTrendingUp size={13} />}
                        loading={requestingPlan[`yield_${agent.agentAddress}`]}
                        onClick={() =>
                          handleRequestYieldPlan(agent.agentAddress)
                        }
                      >
                        Yield Optimizer (AgentKit)
                      </Button>
                      <Button
                        size="xs"
                        variant="filled"
                        color="grape"
                        leftSection={<IconSparkles size={13} />}
                        loading={requestingPlan[`auto_${agent.agentAddress}`]}
                        onClick={() =>
                          handleRunAutonomousChain(agent.agentAddress)
                        }
                      >
                        Run Autonomous Chain
                      </Button>
                    </Group>

                    <Divider my="xs" />

                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="light"
                        color={agent.trusted ? "yellow" : "teal"}
                        onClick={() =>
                          handleToggleTrust(agent.agentAddress, agent.trusted)
                        }
                      >
                        {agent.trusted ? "Revoke trust" : "Grant trust"}
                      </Button>
                      <ActionIcon
                        color="red"
                        variant="light"
                        onClick={() => handleRemove(agent.agentAddress)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Card>
      {/* ── Plans list ──────────────────────────────────────────── */}
      <Card withBorder p="md" radius="md">
        <Group justify="space-between" mb="sm">
          <Group gap="xs">
            <IconClipboardList size={16} />
            <Title order={5}>Agent Plans</Title>
          </Group>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={handleRefresh}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {agentPlans.length === 0 ? (
          <Text c="dimmed" size="sm">
            No plans on-chain yet.
          </Text>
        ) : (
          <Stack gap="xs">
            {agentPlans.map((plan) => {
              let title = null;
              try {
                title = JSON.parse(plan.planData)?.title;
              } catch {}
              return (
                <Group
                  key={plan.planId}
                  justify="space-between"
                  p="xs"
                  style={{
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: 6,
                  }}
                >
                  <Stack gap={2}>
                    <Group gap="xs">
                      <Badge
                        size="xs"
                        color={STATUS_COLOR[plan.status] || "gray"}
                      >
                        {PlanStatusLabel[plan.status] ?? plan.status}
                      </Badge>
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ fontFamily: "monospace" }}
                      >
                        {plan.planId.slice(0, 10)}…
                      </Text>
                    </Group>
                    {title && <Text size="xs">{title}</Text>}
                    <Text size="xs" c="dimmed">
                      Agent: {plan.agentAddress.slice(0, 10)}…
                    </Text>
                  </Stack>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => handleReviewPlan(plan.planId)}
                  >
                    Review
                  </Button>
                </Group>
              );
            })}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
