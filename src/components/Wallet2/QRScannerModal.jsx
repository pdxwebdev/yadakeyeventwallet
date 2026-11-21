import { Modal } from "@mantine/core";
import Webcam from "react-webcam";

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
}) => (
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
  </Modal>
);

export default QRScannerModal;
