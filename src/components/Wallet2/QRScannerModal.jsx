import { Modal } from "@mantine/core";
import Webcam from "react-webcam";

const QRScannerModal = ({
  isOpen,
  onClose,
  webcamRef,
  parsedData,
  log,
  styles,
}) => (
  <Modal
    opened={isOpen}
    onClose={onClose}
    title={`Scan QR Code for rotation ${
      parsedData
        ? parsedData.rotation !== log.length
          ? parsedData.rotation + 1
          : parsedData.rotation
        : 0
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
