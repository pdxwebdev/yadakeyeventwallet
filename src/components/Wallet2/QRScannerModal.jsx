/* eslint-disable react/prop-types */
import { Modal, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { SCAN_STATUS_EVENT } from "../../shared/capture";

const QRScannerModal = ({
  isOpen,
  onClose,
  webcamRef,
  log,
  styles,
  isTransactionFlow,
  isDeployed,
  currentScanIndex, // New prop
  scanPrompt,
}) => {
  const [status, setStatus] = useState("Starting camera…");
  const frameCount = useRef(0);

  useEffect(() => {
    if (!isOpen) return undefined;
    frameCount.current = 0;
    setStatus("Starting camera…");
    const handleStatus = (event) => {
      const detail = event.detail || {};
      if (detail.phase === "frame") {
        frameCount.current += 1;
        setStatus(
          `Checking frame ${frameCount.current} (${detail.width}×${detail.height})…`
        );
      } else if (detail.phase === "hit") {
        setStatus("QR code detected");
      } else if (detail.phase === "miss") {
        setStatus(
          detail.blank
            ? "Camera image is blank — hold the QR in view"
            : `No QR detected yet — frame ${frameCount.current} (${detail.width}×${detail.height})`
        );
      } else if (detail.phase === "error") {
        setStatus(detail.message || "Camera error");
      }
    };
    window.addEventListener(SCAN_STATUS_EVENT, handleStatus);
    return () => window.removeEventListener(SCAN_STATUS_EVENT, handleStatus);
  }, [isOpen]);

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title={
        scanPrompt ||
        `Scan QR Code for rotation ${
          isTransactionFlow
            ? log.length + 1
            : !isDeployed
            ? currentScanIndex
            : log.length
        }`
      }
      size="lg"
      styles={{ modal: styles.modal, title: styles.title }}
    >
      <Webcam
        audio={false}
        ref={webcamRef}
        screenshotFormat="image/png"
        width="100%"
        playsInline
        // Capture at the camera's native resolution. Without this react-webcam
        // sizes (and caches) its canvas from video.clientWidth, which can be 0
        // while the modal is still opening and then never recovers.
        forceScreenshotSourceSize
        videoConstraints={{
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }}
        style={styles.webcam}
      />
      <Text size="xs" c="dimmed" ta="center" mt="xs">
        Hold the whole QR in view. If it looks blurry, move the device farther
        away.
      </Text>
      <Text size="xs" c="dimmed" ta="center" mt={4}>
        {status}
      </Text>
    </Modal>
  );
};

export default QRScannerModal;
