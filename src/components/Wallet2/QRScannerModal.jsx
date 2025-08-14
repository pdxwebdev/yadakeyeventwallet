import { Modal } from "@mantine/core";
import Webcam from "react-webcam";

const QRScannerModal = ({
  isOpen,
  onClose,
  webcamRef,
  parsedData,
  log,
  styles,
  isTransactionFlow,
  isDeployed,
  currentScanIndex, // New prop
}) => (
  <Modal
    opened={isOpen}
    onClose={onClose}
    title={`Scan QR Code for rotation ${
      isTransactionFlow
        ? log.length + 1
        : !isDeployed
        ? currentScanIndex
        : log.length
    }`}
    size="lg"
    styles={{ modal: styles.modal, title: styles.title }}
  >
    <Webcam
      audio={false}
      ref={webcamRef}
      screenshotFormat="image/jpeg"
      width="100%"
      videoConstraints={{ facingMode: "environment" }}
      style={styles.webcam}
    />
  </Modal>
);

export default QRScannerModal;
