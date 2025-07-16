import { Modal, Text } from "@mantine/core";
import { QRCodeSVG } from "qrcode.react";
import { useMantineColorScheme } from "@mantine/core";

const QRDisplayModal = ({ isOpen, onClose, parsedData, log, styles }) => {
  const { colorScheme } = useMantineColorScheme();

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Wallet Address QR Code"
      size="sm"
      styles={{ modal: styles.qrModal, title: styles.title }}
    >
      {parsedData?.publicKeyHash ? (
        <>
          <QRCodeSVG
            value={
              parsedData.rotation !== log.length
                ? parsedData.prerotatedKeyHash
                : parsedData.publicKeyHash
            }
            size={200}
            bgColor={colorScheme === "dark" ? "#1A1B1E" : "#FFFFFF"}
            fgColor={colorScheme === "dark" ? "#FFFFFF" : "#000000"}
          />
          <Text>
            {parsedData.rotation !== log.length
              ? parsedData.prerotatedKeyHash
              : parsedData.publicKeyHash}
          </Text>
        </>
      ) : (
        <Text>No address available</Text>
      )}
    </Modal>
  );
};

export default QRDisplayModal;
