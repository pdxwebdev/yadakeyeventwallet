/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

import "./index.css";
import App from "./App.jsx";
import ReactDOM from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import { AppProvider } from "./context/AppContext";
import "@mantine/core/styles.css";
// import "@mantine/core/styles/ScrollArea.css";
// import "@mantine/core/styles/VisuallyHidden.css";
// import "@mantine/core/styles/Paper.css";
// import "@mantine/core/styles/Popover.css";
// import "@mantine/core/styles/CloseButton.css";
// import "@mantine/core/styles/Group.css";
// import "@mantine/core/styles/Loader.css";
// import "@mantine/core/styles/Overlay.css";
// import "@mantine/core/styles/ModalBase.css";
// import "@mantine/core/styles/Input.css";
// import "@mantine/core/styles/InlineInput.css";
// import "@mantine/core/styles/Flex.css";
// import "@mantine/core/styles/FloatingIndicator.css";

const theme = createTheme({
  /** Put your mantine theme override here */
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <MantineProvider theme={theme}>
    <AppProvider>
      <App />
    </AppProvider>
  </MantineProvider>
);
