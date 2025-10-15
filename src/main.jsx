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
import { createContext, useState } from "react";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/core/styles/Table.css";
import { BLOCKCHAINS } from "./shared/constants.js";

// Create a context for theme updates
export const ThemeContext = createContext({
  primaryColor: "teal",
  setPrimaryColor: () => {},
});

// Root component
function Root() {
  const [primaryColor, setPrimaryColor] = useState(BLOCKCHAINS[0].color); // Initial primary color

  // Create dynamic theme based on state
  const theme = createTheme({
    primaryColor, // Dynamically update primary color
    colors: {
      dark: [
        "#C1C2C5",
        "#A6A7AB",
        "#909296",
        "#5C5F66",
        "#373A40",
        "#2C2E33",
        "#25262B",
        "#1A1B1E",
        "#141517",
        "#101113",
      ],
    },
    components: {
      Anchor: {
        defaultProps: {
          color: `${primaryColor}.4`, // Sync with primaryColor
        },
        styles: (theme) => ({
          root: {
            color: theme.colors[primaryColor][4],
            "&:visited": {
              color: theme.colors[primaryColor][6],
            },
            "&:hover": {
              color: theme.colors[primaryColor][3],
              textDecoration: "underline",
            },
          },
        }),
      },
      // Optional: Override Button styles globally
      Button: {
        styles: (theme) => ({
          root: {
            backgroundColor: theme.colors[primaryColor][6], // Use primaryColor for buttons
            color: primaryColor === "yellow" ? theme.black : theme.white,
            "&:hover": {
              backgroundColor: theme.colors[primaryColor][7],
            },
          },
        }),
      },
    },
  });

  return (
    <ThemeContext.Provider value={{ primaryColor, setPrimaryColor }}>
      <MantineProvider
        forceColorScheme="dark"
        theme={theme}
        withGlobalStyles
        withNormalizeCSS
      >
        <AppProvider>
          <App />
        </AppProvider>
      </MantineProvider>
    </ThemeContext.Provider>
  );
}

// Render the app
const container = document.getElementById("root");
console.log(container);
console.log(container._reactRoot);
// Store the root globally so it persists across hot reloads
if (!container._reactRoot) {
  container._reactRoot = ReactDOM.createRoot(container);
}

const root = container._reactRoot;
root.render(<Root />);
