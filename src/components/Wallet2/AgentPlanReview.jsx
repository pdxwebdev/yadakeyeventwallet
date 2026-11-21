/**
 * AgentPlanReview.jsx
 *
 * Modal that presents the plan returned by an external ERC-8004 agent
 * together with the guardian agent's advice.  The user can approve or
 * reject the plan.  On approval the AgentKeyScanner flow is opened.
 */

import { useEffect, useState } from "react";
import {
  Modal,
  Stack,
  Title,
  Text,
  Badge,
  Button,
  Group,
  Divider,
  ScrollArea,
  Loader,
  Alert,
  List,
} from "@mantine/core";
import {
  IconShieldCheck,
  IconShieldX,
  IconAlertTriangle,
  IconRobot,
  IconCheck,
  IconX,
  IconListCheck,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useAppContext } from "../../context/AppContext";
import {
  yadaAgents,
  PlanStatus,
  PlanStatusLabel,
} from "../../blockchains/YadaAgents";

// ── Severity badge for guardian verdict risk level ─────────────────────────

const RiskBadge = ({ risk }) => {
  const map = {
    low: { color: "teal", label: "Low risk" },
    medium: { color: "yellow", label: "Medium risk" },
    high: { color: "orange", label: "High risk" },
    critical: { color: "red", label: "Critical risk" },
  };
  const entry = map[(risk || "").toLowerCase()] || {
    color: "gray",
    label: risk || "Unknown",
  };
  return <Badge color={entry.color}>{entry.label}</Badge>;
};

// ── Parse plan data into human-readable view ──────────────────────────────

const PlanSummary = ({ planData }) => {
  let plan;
  try {
    plan = typeof planData === "string" ? JSON.parse(planData) : planData;
  } catch {
    return null;
  }
  if (!plan) return null;

  return (
    <Stack gap="xs">
      {plan.title && (
        <Text fw={600} size="sm">
          {plan.title}
        </Text>
      )}
      {plan.description && (
        <Text size="sm" c="dimmed">
          {plan.description}
        </Text>
      )}
      {plan.steps && plan.steps.length > 0 && (
        <>
          <Text size="xs" fw={500} tt="uppercase" c="dimmed">
            Steps
          </Text>
          <List size="sm" spacing={4} icon={<IconListCheck size={14} />}>
            {plan.steps.map((s, i) => (
              <List.Item key={i}>
                <Text span fw={500}>
                  {s.action}
                </Text>
                {" — "}
                {s.description}
              </List.Item>
            ))}
          </List>
        </>
      )}
    </Stack>
  );
};

// ── Main component ─────────────────────────────────────────────────────────

export default function AgentPlanReview({ opened, onClose, onApproved }) {
  const appContext = useAppContext();
  const {
    pendingAgentPlan,
    setPendingAgentPlan,
    guardianVerdict,
    setGuardianVerdict,
  } = appContext;

  const [waitingForGuardian, setWaitingForGuardian] = useState(false);
  const [acting, setActing] = useState(false);

  const plan = pendingAgentPlan;

  // ── Request guardian analysis when modal opens and advice is missing ──

  useEffect(() => {
    if (!opened || !plan) return;
    if (guardianVerdict) return; // already have fresh analysis this session
    if (plan.status !== PlanStatus.PENDING) return;

    setWaitingForGuardian(true);

    // Call the guardian server directly — it sets guardianVerdict in context
    // (which clears the spinner via the watcher below) and writes advice on-chain.
    // Falls back to polling on-chain if the HTTP call fails (e.g. server down).
    yadaAgents
      .requestGuardianAnalysis(
        appContext,
        plan.planId,
        plan.planData,
        plan.agentAddress
      )
      .catch(() =>
        yadaAgents
          .pollForGuardianAdvice(appContext, plan.planId, 60_000, 4_000)
          .then((advice) => {
            if (advice === null) {
              notifications.show({
                title: "Guardian timeout",
                message:
                  "No advice received within 1 minute. You may still approve manually.",
                color: "yellow",
              });
            }
          })
      )
      .finally(() => setWaitingForGuardian(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, plan?.planId]);

  // Clear spinner as soon as guardian verdict arrives in context
  useEffect(() => {
    if (guardianVerdict) setWaitingForGuardian(false);
  }, [guardianVerdict]);

  // ── Parse guardian advice ─────────────────────────────────────────────

  const advice = (() => {
    if (guardianVerdict) return guardianVerdict;
    if (!plan?.guardianAdvice) return null;
    try {
      return JSON.parse(plan.guardianAdvice);
    } catch {
      return { raw: plan.guardianAdvice };
    }
  })();

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleApprove = () => {
    // Signal parent to open the approval scanner which will scan the identity key,
    // register it in KeyLogRegistry, and call approvePlan on-chain.
    if (onApproved) onApproved(plan.planId);
    onClose();
  };

  const handleReject = async () => {
    setActing(true);
    try {
      await yadaAgents.rejectPlan(appContext, plan.planId);
      setGuardianVerdict(null);
      setPendingAgentPlan(null);
      onClose();
    } catch (err) {
      console.error("[AgentPlanReview] handleReject failed:", err);
      notifications.show({
        title: "Error",
        message: err.reason || err.message,
        color: "red",
      });
    } finally {
      setActing(false);
    }
  };

  if (!plan) return null;

  const isPending = plan.status === PlanStatus.PENDING;
  const statusColor =
    {
      [PlanStatus.PENDING]: "blue",
      [PlanStatus.APPROVED]: "teal",
      [PlanStatus.REJECTED]: "red",
      [PlanStatus.EXECUTED]: "violet",
    }[plan.status] || "gray";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconRobot size={18} />
          <Text fw={600}>Agent Plan Review</Text>
          <Badge color={statusColor}>{PlanStatusLabel[plan.status]}</Badge>
        </Group>
      }
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="md">
        {/* Plan ID */}
        <Text size="xs" c="dimmed">
          Plan ID: {plan.planId}
        </Text>

        {/* Agent address */}
        <Text size="sm">
          <Text span fw={500}>
            Agent:{" "}
          </Text>
          {plan.agentAddress}
        </Text>

        {/* Plan summary — human-readable, no raw JSON */}
        <PlanSummary planData={plan.planData} />

        <Divider label="Guardian Analysis" labelPosition="center" />

        {/* Guardian advice section */}
        {waitingForGuardian && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Waiting for guardian agent analysis…
            </Text>
          </Group>
        )}

        {!waitingForGuardian && !advice && (
          <Alert
            color="yellow"
            icon={<IconAlertTriangle size={16} />}
            title="No guardian advice yet"
          >
            The guardian has not submitted analysis for this plan. You may
            approve or reject without it, but proceed with caution.
          </Alert>
        )}

        {advice && (
          <Stack gap="xs">
            {/* Risk summary */}
            {advice.risk && (
              <Group gap="xs">
                <Text size="sm" fw={500}>
                  Risk level:
                </Text>
                <RiskBadge risk={advice.risk} />
              </Group>
            )}

            {/* Summary text */}
            {advice.summary &&
              (() => {
                const alertColor =
                  advice.risk === "critical" || advice.risk === "high"
                    ? "red"
                    : advice.risk === "medium"
                    ? "yellow"
                    : "teal";
                const alertIcon =
                  advice.risk === "low" ? (
                    <IconShieldCheck size={16} />
                  ) : (
                    <IconShieldX size={16} />
                  );
                return (
                  <Stack gap={4}>
                    {(advice.summaryLines || advice.summary.split("\n"))
                      .filter(Boolean)
                      .map((line, i) => (
                        <Alert
                          key={i}
                          color={i === 0 ? alertColor : "gray"}
                          icon={i === 0 ? alertIcon : undefined}
                          title={i === 0 ? "Guardian summary" : undefined}
                          py="xs"
                        >
                          {line}
                        </Alert>
                      ))}
                  </Stack>
                );
              })()}

            {/* Issues list */}
            {advice.issues && advice.issues.length > 0 && (
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Issues flagged:
                </Text>
                {advice.issues.map((issue, i) => (
                  <Text key={i} size="xs" c="red">
                    • {issue}
                  </Text>
                ))}
              </Stack>
            )}

            {/* Recommendations */}
            {advice.recommendations && advice.recommendations.length > 0 && (
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Recommendations:
                </Text>
                {advice.recommendations.map((rec, i) => (
                  <Text key={i} size="xs" c="dimmed">
                    • {rec}
                  </Text>
                ))}
              </Stack>
            )}
          </Stack>
        )}

        {/* Action buttons — only shown when plan is still pending */}
        {isPending && (
          <>
            <Divider />
            <Group justify="flex-end">
              <Button
                color="red"
                variant="light"
                leftSection={<IconX size={14} />}
                loading={acting}
                onClick={handleReject}
              >
                Reject Plan
              </Button>
              <Button
                color="teal"
                leftSection={<IconCheck size={14} />}
                onClick={handleApprove}
              >
                Approve &amp; Scan Keys
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
