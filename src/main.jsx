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
import "@mantine/notifications/styles.css";
import "@mantine/core/styles/Table.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <MantineProvider
    forceColorScheme="dark" // Enforce dark theme
    theme={{
      primaryColor: "teal", // Changed to teal for buttons
      colors: {
        // Optional: Customize dark theme colors
        dark: [
          "#C1C2C5", // Lightest
          "#A6A7AB",
          "#909296",
          "#5C5F66",
          "#373A40",
          "#2C2E33",
          "#25262B",
          "#1A1B1E", // Darker
          "#141517",
          "#101113", // Darkest
        ],
      },
      components: {
        Anchor: {
          defaultProps: {
            color: "teal.4", // Default link color
          },
          styles: (theme) => ({
            root: {
              color: theme.colors.teal[4], // Unvisited links
              "&:visited": {
                color: theme.colors.teal[6], // Visited links
              },
              "&:hover": {
                color: theme.colors.teal[3], // Hover state
                textDecoration: "underline",
              },
            },
          }),
        },
      },
    }}
    withGlobalStyles
    withNormalizeCSS
  >
    <AppProvider>
      <App />
    </AppProvider>
  </MantineProvider>
);
