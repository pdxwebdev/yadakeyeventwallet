import "./index.css";
import App from "./App.jsx";
import ReactDOM from "react-dom/client";
import { createTheme, MantineProvider } from '@mantine/core';

const theme = createTheme({
  /** Put your mantine theme override here */
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
    <MantineProvider theme={theme}>
      <App />
    </MantineProvider>
);
