/**
 * AgentKeyScanner.jsx
 *
 * Two-modal workflow for the agent plan lifecycle:
 *
 *   mode="approve"  — The user scans their UNCONFIRMED key (the next key in
 *                     their chain, which they hand to the AI agent). Calls
 *                     approvePlan() which registers that key in KeyLogRegistry
 *                     and moves the plan to APPROVED. The AI signs plan
 *                     transactions with it while the plan is pending.
 *
 *   mode="execute"  — After the AI has finished, the user scans their
 *                     CONFIRMING key (prevPublicKeyHash == approver key).
 *                     Calls executePlan() which registers the confirming key,
 *                     proves the same owner is completing the operation, and
 *                     moves the plan to EXECUTED.
 *
 * One QR scan per step.
 */

import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Stack,
  Text,
  Button,
  Group,
  Progress,
  Badge,
  Alert,
  Loader,
  ScrollArea,
  Code,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconQrcode,
  IconCheck,
  IconAlertTriangle,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import Webcam from "react-webcam";
import { ethers } from "ethers";
import { fromWIF } from "../../utils/hdWallet";
import { capture } from "../../shared/capture";
import { useAppContext } from "../../context/AppContext";
import { yadaAgents } from "../../blockchains/YadaAgents";

// ── QR parser (same format as YadaBSC.processScannedQR) ──────────────────

function parseAgentKeyQR(qrData) {
  const [
    wifString,
    prerotatedKeyHash,
    twicePrerotatedKeyHash,
    prevPublicKeyHash,
    rotation,
  ] = qrData.split("|");

  if (
    !wifString ||
    !ethers.isAddress(prerotatedKeyHash) ||
    !ethers.isAddress(twicePrerotatedKeyHash)
  ) {
    throw new Error("Invalid QR format. Ensure your device is in BSC mode.");
  }

  const wallet = fromWIF(wifString);
  // wallet.privateKey is a Buffer; derive the 64-byte uncompressed public key
  // (X || Y, no 04 prefix) which is what KeyLogRegistry.getAddressFromPublicKey expects.
  const signingKey = new ethers.SigningKey(ethers.hexlify(wallet.privateKey));
  const publicKeyHash = ethers.computeAddress(signingKey.publicKey);
  // computePublicKey(..., false) → "0x04<X><Y>" (65 bytes); slice off the 04 prefix → 64 bytes
  const uncompressedKey64 = ethers
    .getBytes(ethers.SigningKey.computePublicKey(signingKey.publicKey, false))
    .slice(1);

  return {
    wif: wifString,
    publicKeyHash,
    prerotatedKeyHash,
    twicePrerotatedKeyHash,
    prevPublicKeyHash: prevPublicKeyHash || ethers.ZeroAddress,
    rotation: parseInt(rotation, 10),
    // KeyData struct for KeyLogRegistry.registerKeyLog.
    // outputAddress must equal prerotatedKeyHash so the contract's isPair=false
    // path accepts the entry as a CONFIRMING rotation event.
    // prevPublicKeyHash carries the predecessor address from the QR so the
    // contract can validate the chain link (predecessor must be on-chain with
    // this key as its prerotatedKeyHash).
    keyData: {
      publicKey: uncompressedKey64, // 64-byte Uint8Array (no 04 prefix)
      prerotatedKeyHash,
      twicePrerotatedKeyHash,
      prevPublicKeyHash: prevPublicKeyHash || ethers.ZeroAddress,
      outputAddress: prerotatedKeyHash, // must equal prerotatedKeyHash for confirming semantics
    },
  };
}

// ── Main component ────────────────────────────────────────────────────────

/** Count how many key_rotation steps are in a plan's JSON. */
function countKeyRotations(planData) {
  try {
    const parsed =
      typeof planData === "string" ? JSON.parse(planData) : planData;
    const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    return steps.filter((s) => s.action === "key_rotation").length;
  } catch {
    return 1; // safe fallback
  }
}

export default function AgentKeyScanner({
  opened,
  onClose,
  planId,
  webcamRef: externalWebcamRef,
  mode = "execute", // "approve" | "execute"
  onComplete,
}) {
  const appContext = useAppContext();
  const { setIsAgentKeyScanning, pendingAgentPlan, executionResults } =
    appContext;

  const internalWebcamRef = useRef(null);
  const webcamRef = externalWebcamRef || internalWebcamRef;

  // One scan per step: approve scans the unconfirmed key, execute scans the confirming key.
  const requiredScans = 1;

  const [phase, setPhase] = useState("idle"); // idle | scanning | done | error
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scannedKeys, setScannedKeys] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [executing, setExecuting] = useState(false);
  // Tracks which action the user chose before scanning (execute mode only)
  const [scanIntent, setScanIntent] = useState(null); // null | "execute" | "reject"

  // Polling loop ref so we can cancel it on unmount
  const pollingRef = useRef(null);

  // ── Reset when modal opens ───────────────────────────────────────────

  useEffect(() => {
    if (opened) {
      setCurrentIndex(0);
      setScannedKeys([]);
      setErrorMsg("");
      setExecuting(false);
      setScanIntent(null);
      setIsAgentKeyScanning(true);

      // Both modes start idle so the user scans their key.
      setPhase(requiredScans === 0 ? "done" : "idle");
    } else {
      setIsAgentKeyScanning(false);
      clearTimeout(pollingRef.current);
    }
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-confirm when scan finishes and intent was pre-selected ──────
  useEffect(() => {
    if (
      phase === "done" &&
      mode === "execute" &&
      scanIntent &&
      scannedKeys.length > 0 &&
      !executing
    ) {
      if (scanIntent === "execute") handleExecute();
      else if (scanIntent === "reject") handleCancelPlan();
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scan loop ────────────────────────────────────────────────────────

  const startScanning = (intent = null) => {
    if (intent) setScanIntent(intent);
    setPhase("scanning");
    scanNext(0, []);
  };

  const scanNext = (index, collected) => {
    if (index >= requiredScans) {
      setPhase("done");
      return;
    }

    notifications.show({
      title: `Scan key ${index + 1} of ${requiredScans}`,
      message: "Point the camera at the QR code on your hardware device.",
      color: "blue",
    });

    const attempt = async () => {
      try {
        const qrData = await capture(webcamRef);
        const parsed = parseAgentKeyQR(qrData);

        // Prevent duplicate keys in the same session
        if (collected.some((k) => k.publicKeyHash === parsed.publicKeyHash)) {
          notifications.show({
            title: "Duplicate key",
            message:
              "This key was already scanned. Please scan a different key.",
            color: "yellow",
          });
          pollingRef.current = setTimeout(attempt, 600);
          return;
        }

        const updated = [...collected, parsed];
        setScannedKeys(updated);
        setCurrentIndex(index + 1);

        notifications.show({
          title: `Key ${index + 1} captured`,
          message: `Address: ${parsed.publicKeyHash.slice(0, 10)}…`,
          color: "green",
        });

        scanNext(index + 1, updated);
      } catch {
        // No QR found yet — keep polling
        pollingRef.current = setTimeout(attempt, 500);
      }
    };

    attempt();
  };

  // ── Approve plan (mode="approve") ────────────────────────────────────

  const handleApprove = async () => {
    setExecuting(true);
    try {
      await yadaAgents.approvePlan(
        appContext,
        planId,
        scannedKeys[0] // scanned unconfirmed key
      );

      if (onComplete) onComplete();
      onClose();
    } catch (err) {
      console.error("[AgentKeyScanner] handleApprove failed:", err);
      setErrorMsg(err.reason || err.message || "Approval failed");
      setPhase("error");
    } finally {
      setExecuting(false);
    }
  };

  // ── Execute plan with scanned confirming key (mode="execute") ─────────

  const handleExecute = async () => {
    setExecuting(true);
    try {
      await yadaAgents.executePlan(
        appContext,
        planId,
        scannedKeys[0] // confirming key
      );

      if (onComplete) onComplete();
      onClose();
    } catch (err) {
      console.error("[AgentKeyScanner] handleExecute failed:", err);
      setErrorMsg(err.reason || err.message || "Execution failed");
      setPhase("error");
    } finally {
      setExecuting(false);
    }
  };

  // ── Cancel plan — registers confirming key but marks plan REJECTED ─────

  const handleCancelPlan = async () => {
    setExecuting(true);
    try {
      await yadaAgents.cancelPlan(
        appContext,
        planId,
        scannedKeys[0] // confirming key (chain still advances)
      );

      if (onComplete) onComplete();
      onClose();
    } catch (err) {
      console.error("[AgentKeyScanner] handleCancelPlan failed:", err);
      setErrorMsg(err.reason || err.message || "Cancellation failed");
      setPhase("error");
    } finally {
      setExecuting(false);
    }
  };

  const handleRetry = () => {
    clearTimeout(pollingRef.current);
    setPhase("idle");
    setCurrentIndex(0);
    setScannedKeys([]);
    setErrorMsg("");
  };

  const handleCancel = () => {
    clearTimeout(pollingRef.current);
    onClose();
  };

  // ── Render ───────────────────────────────────────────────────────────

  const progress = (currentIndex / requiredScans) * 100;

  return (
    <Modal
      opened={opened}
      onClose={handleCancel}
      title={
        <Group gap="xs">
          <IconQrcode size={18} />
          <Text fw={600}>
            {mode === "approve"
              ? "Scan Unconfirmed Key — Approve Plan"
              : scanIntent === "reject"
              ? "Scan Confirming Key — Roll Back Plan"
              : "Scan Confirming Key — Execute Plan"}
          </Text>
        </Group>
      }
      size="lg"
      closeOnClickOutside={false}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="md">
        {/* Progress bar */}
        <Progress
          value={progress}
          color={phase === "done" ? "teal" : "blue"}
          animated={phase === "scanning"}
          size="sm"
        />
        <Text size="sm" c="dimmed" ta="center">
          {currentIndex} / {requiredScans} keys scanned
        </Text>

        {/* Webcam — only shown while scanning (use internal ref if no external) */}
        {phase === "scanning" && !externalWebcamRef && (
          <Webcam
            audio={false}
            ref={internalWebcamRef}
            screenshotFormat="image/jpeg"
            width="100%"
            videoConstraints={{ facingMode: "environment" }}
            style={{ borderRadius: 8 }}
          />
        )}

        {phase === "scanning" && externalWebcamRef && (
          <Group gap="xs" justify="center">
            <Loader size="sm" />
            <Text size="sm">
              Camera active — scan your{" "}
              {mode === "approve" ? "unconfirmed" : "confirming"} key QR code
            </Text>
          </Group>
        )}

        {/* Scanned key summary */}
        {scannedKeys.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {mode === "approve"
                ? "Unconfirmed key captured:"
                : "Confirming key captured:"}
            </Text>
            {scannedKeys.map((k, i) => (
              <Group key={k.publicKeyHash} gap="xs">
                <Badge color="teal" size="xs">
                  #{i + 1}
                </Badge>
                <Code style={{ fontSize: 11 }}>{k.publicKeyHash}</Code>
              </Group>
            ))}
          </Stack>
        )}

        {/* Error state */}
        {phase === "error" && (
          <Alert
            color="red"
            icon={<IconAlertTriangle size={16} />}
            title="Error"
          >
            {errorMsg}
          </Alert>
        )}

        {/* Done state — confirm before action */}
        {phase === "done" && (
          <Stack gap="sm">
            <Alert
              color="teal"
              icon={<IconCheck size={16} />}
              title={
                mode === "approve"
                  ? "Unconfirmed key scanned"
                  : "Confirming key scanned"
              }
            >
              {mode === "approve"
                ? "Your unconfirmed key has been captured. Click Confirm Approval to register it on-chain — the AI agent will use this key to sign its pending transactions."
                : "Your confirming key has been captured. Review what the agent executed below, then choose to confirm or reject."}
            </Alert>

            {/* Execution results — only shown in execute mode */}
            {mode === "execute" && executionResults && (
              <Stack gap="xs">
                <Text size="sm" fw={600}>
                  Agent execution summary
                </Text>
                {executionResults.summary?.summary &&
                  (() => {
                    const s = executionResults.summary;
                    const alertColor =
                      s?.risk === "high" || s?.risk === "critical"
                        ? "red"
                        : s?.risk === "medium"
                        ? "yellow"
                        : "green";
                    const alertIcon =
                      s?.risk === "high" || s?.risk === "critical" ? (
                        <IconAlertTriangle size={16} />
                      ) : (
                        <IconCheck size={16} />
                      );
                    return (
                      <Stack gap={4}>
                        {(s.summaryLines || s.summary?.split("\n"))
                          ?.filter(Boolean)
                          .map((line, i) => (
                            <Alert
                              key={i}
                              color={i === 0 ? alertColor : "gray"}
                              icon={i === 0 ? alertIcon : undefined}
                              py="xs"
                            >
                              {line}
                            </Alert>
                          ))}
                      </Stack>
                    );
                  })()}

                {executionResults.results?.length > 0 && (
                  <Stack gap={4}>
                    {executionResults.results.map((r) => (
                      <Stack key={r.step} gap={2}>
                        <Group gap="xs">
                          <Badge
                            color={
                              r.status === "executed"
                                ? "teal"
                                : r.status === "protocol"
                                ? "gray"
                                : "red"
                            }
                            size="xs"
                          >
                            {r.status}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {r.step}. {r.action}
                            {r.description ? ` — ${r.description}` : ""}
                          </Text>
                        </Group>
                        {r.action === "approve" && r.params && (
                          <Stack gap={1} pl="sm">
                            <Group gap="xs">
                              <Text size="xs" c="dimmed" w={52}>
                                Token:
                              </Text>
                              <Code style={{ fontSize: 10 }}>
                                {r.params.token}
                              </Code>
                              {r.params.tokenLabel && (
                                <Badge size="xs" variant="outline">
                                  {r.params.tokenLabel}
                                </Badge>
                              )}
                            </Group>
                            <Group gap="xs">
                              <Text size="xs" c="dimmed" w={52}>
                                Spender:
                              </Text>
                              <Code style={{ fontSize: 10 }}>
                                {r.params.spender}
                              </Code>
                              {r.params.spenderLabel && (
                                <Badge size="xs" variant="outline">
                                  {r.params.spenderLabel}
                                </Badge>
                              )}
                            </Group>
                            <Group gap="xs">
                              <Text size="xs" c="dimmed" w={52}>
                                Amount:
                              </Text>
                              <Text size="xs">{r.params.amount} tokens</Text>
                            </Group>
                          </Stack>
                        )}
                      </Stack>
                    ))}
                  </Stack>
                )}

                {executionResults.summary?.issues?.length > 0 && (
                  <Stack gap={2}>
                    {executionResults.summary.issues.map((issue, i) => (
                      <Text key={i} size="xs" c="red">
                        ⚠ {issue}
                      </Text>
                    ))}
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>
        )}

        {/* Idle — start prompt */}
        {phase === "idle" && mode === "approve" && (
          <Text size="sm" c="dimmed">
            Scan your unconfirmed key QR code. This is the next key in your
            chain — the AI agent will use it to sign the plan&#39;s pending
            transactions.
          </Text>
        )}

        {phase === "idle" && mode === "execute" && (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              The AI agent has completed its work. Review what was signed below,
              then scan your confirming key to either confirm the agent&#39;s
              actions or roll back the plan status. The key log always advances
              regardless of your choice.
            </Text>

            {/* Transaction summary — shown before scanning so user can decide */}
            {executionResults && (
              <Stack gap="xs">
                <Text size="sm" fw={600}>
                  Transactions signed by agent
                </Text>
                {executionResults.summary?.summary &&
                  (() => {
                    const s = executionResults.summary;
                    const alertColor =
                      s?.risk === "high" || s?.risk === "critical"
                        ? "red"
                        : s?.risk === "medium"
                        ? "yellow"
                        : "green";
                    const alertIcon =
                      s?.risk === "high" || s?.risk === "critical" ? (
                        <IconAlertTriangle size={16} />
                      ) : (
                        <IconCheck size={16} />
                      );
                    return (
                      <Stack gap={4}>
                        {(s.summaryLines || s.summary?.split("\n"))
                          ?.filter(Boolean)
                          .map((line, i) => (
                            <Alert
                              key={i}
                              color={i === 0 ? alertColor : "gray"}
                              icon={i === 0 ? alertIcon : undefined}
                              py="xs"
                            >
                              {line}
                            </Alert>
                          ))}
                      </Stack>
                    );
                  })()}

                {executionResults.results?.length > 0 && (
                  <Stack gap={4}>
                    {executionResults.results.map((r) => (
                      <Stack key={r.step} gap={2}>
                        <Group gap="xs">
                          <Badge
                            color={
                              r.status === "executed"
                                ? "blue"
                                : r.status === "protocol"
                                ? "gray"
                                : "red"
                            }
                            variant="light"
                            size="xs"
                          >
                            {r.status === "executed" ? "staged" : r.status}
                          </Badge>
                          <Text size="xs" fw={500}>
                            {r.step}. {r.action}
                            {r.description ? ` — ${r.description}` : ""}
                          </Text>
                        </Group>
                        {r.action === "approve" && r.params && (
                          <Stack gap={1} pl="sm">
                            <Group gap="xs">
                              <Text size="xs" c="dimmed" w={52}>
                                Token:
                              </Text>
                              <Code style={{ fontSize: 10 }}>
                                {r.params.token}
                              </Code>
                              {r.params.tokenLabel && (
                                <Badge size="xs" variant="outline">
                                  {r.params.tokenLabel}
                                </Badge>
                              )}
                            </Group>
                            <Group gap="xs">
                              <Text size="xs" c="dimmed" w={52}>
                                Spender:
                              </Text>
                              <Code style={{ fontSize: 10 }}>
                                {r.params.spender}
                              </Code>
                              {r.params.spenderLabel && (
                                <Badge size="xs" variant="outline">
                                  {r.params.spenderLabel}
                                </Badge>
                              )}
                            </Group>
                            <Group gap="xs">
                              <Text size="xs" c="dimmed" w={52}>
                                Amount:
                              </Text>
                              <Text size="xs">{r.params.amount} tokens</Text>
                            </Group>
                          </Stack>
                        )}
                        {r.txHash && (
                          <Text
                            size="xs"
                            c="dimmed"
                            style={{ fontFamily: "monospace", paddingLeft: 8 }}
                          >
                            tx: {r.txHash}
                          </Text>
                        )}
                      </Stack>
                    ))}
                  </Stack>
                )}

                {executionResults.summary?.issues?.length > 0 && (
                  <Stack gap={2}>
                    {executionResults.summary.issues.map((issue, i) => (
                      <Text key={i} size="xs" c="red">
                        ⚠ {issue}
                      </Text>
                    ))}
                  </Stack>
                )}
              </Stack>
            )}

            {!executionResults && (
              <Text size="xs" c="dimmed">
                No transaction summary available — the agent may not have
                reported results.
              </Text>
            )}

            <Group mt="xs" gap="xs">
              <Button
                size="xs"
                color="teal"
                leftSection={<IconCheck size={13} />}
                onClick={() => startScanning("execute")}
              >
                Scan to Execute
              </Button>
              <Button
                size="xs"
                color="orange"
                variant="light"
                leftSection={<IconX size={13} />}
                onClick={() => startScanning("reject")}
              >
                Scan to Roll Back
              </Button>
            </Group>
          </Stack>
        )}

        {/* Actions */}
        <Group justify="flex-end" mt="xs">
          <Button
            variant="subtle"
            color="gray"
            onClick={handleCancel}
            disabled={executing}
          >
            Cancel
          </Button>

          {phase === "idle" && mode === "approve" && (
            <Button
              leftSection={<IconQrcode size={14} />}
              onClick={() => startScanning()}
            >
              Start Scanning
            </Button>
          )}

          {phase === "error" && (
            <Button
              leftSection={<IconRefresh size={14} />}
              onClick={handleRetry}
            >
              Retry
            </Button>
          )}

          {phase === "done" && (
            <Button
              color="teal"
              leftSection={<IconCheck size={14} />}
              loading={executing}
              onClick={mode === "approve" ? handleApprove : handleExecute}
            >
              {mode === "approve" ? "Confirm Approval" : "Execute Plan"}
            </Button>
          )}

          {phase === "done" && mode === "execute" && (
            <Button
              color="orange"
              variant="light"
              leftSection={<IconX size={14} />}
              loading={executing}
              onClick={handleCancelPlan}
            >
              Roll Back
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
