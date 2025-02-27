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
