// Flasher.js
import React from "react";
import "esp-web-tools/dist/web/install-button"; // Load the web component
import { Text } from "@mantine/core";

export default function Flasher() {
  return (
    <div>
      <esp-web-install-button manifest="https://raw.githubusercontent.com/pdxwebdev/yada-wallet/refs/heads/master/YADA/manifest.json"></esp-web-install-button>
    </div>
  );
}
