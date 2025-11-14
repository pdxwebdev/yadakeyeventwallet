/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import "./App.css";
import Sandbox from "./pages/Sandbox";
import Home from "./pages/Home";
import WifToHdConversion from "./pages/WifToHDConversion";
import Markets from "./components/Markets";
import { LoadingOverlay, Text } from "@mantine/core";
import { useAppContext } from "./context/AppContext";
import Wallet2 from "./pages/Wallet2";

// Main App component with the router
function App() {
  const { loading } = useAppContext();
  return (
    <>
      <LoadingOverlay
        visible={loading}
        zIndex={1000}
        overlayProps={{
          children: "Interacting with blockchain...",
          radius: "sm",
          blur: 2,
        }}
      />
      <Router basename="/wallet">
        <nav style={{ marginBottom: "20px" }}>
          {/* <Link to="/home" style={{ marginRight: "10px" }}>
            Home
          </Link>
          <Link to="/passwords" style={{ marginRight: "10px" }}>
            Passwords
          </Link>
          <Link to="/wallet" style={{ marginRight: "10px" }}>
            Wallet
          </Link> */}
          {/* <Link to="/" style={{ marginRight: "10px" }}>
            Wallet
          </Link> */}
          {/* <Link to="/sandbox" style={{ marginRight: "10px" }}>
            Sandbox
          </Link> */}
          {/* <Link to="/whitepaper" style={{ marginRight: "10px" }}>
            Whitepaper
          </Link>  */}
          {/* <Link to="/bridge" style={{ marginRight: "10px" }}>
            Bridge
          </Link> */}
          {/* <Link to="/bridge" style={{ marginRight: "10px" }}>
            Bridge
          </Link> */}
        </nav>
        <Routes>
          <Route path="/" element={<Wallet2 />} />
          <Route path="/sandbox" element={<Sandbox />} />
          <Route
            path="/whitepaper"
            element={
              <iframe
                width="100%"
                height="100%"
                border="0"
                style={{ height: "100%" }}
                src="https://yadacoin.io/yadacoinstatic/YEL-Whitepaper/YEL-Whitepaper.html"
              />
            }
          />
        </Routes>
      </Router>
    </>
  );
}

export default App;
