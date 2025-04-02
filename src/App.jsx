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
import Wallet from "./pages/Wallet";
import WifToHdConversion from "./pages/WifToHDConversion";
import Bridge from "./components/Bridge";
import AdminPanel from "./pages/AdminPanel";
import Markets from "./pages/Markets";

// Main App component with the router
function App() {
  return (
    <Router basename="/wallet">
      <nav style={{ marginBottom: "20px" }}>
        <Link to="/" style={{ marginRight: "10px" }}>
          Home
        </Link>
        <Link to="/passwords" style={{ marginRight: "10px" }}>
          Passwords
        </Link>
        <Link to="/wallet" style={{ marginRight: "10px" }}>
          Wallet
        </Link>
        <Link to="/sandbox" style={{ marginRight: "10px" }}>
          Sandbox
        </Link>
        <Link to="/whitepaper" style={{ marginRight: "10px" }}>
          Whitepaper
        </Link>
        <Link to="/bridge" style={{ marginRight: "10px" }}>
          Bridge
        </Link>
        <Link to="/markets" style={{ marginRight: "10px" }}>
          Markets
        </Link>
        <Link to="/admin" style={{ marginRight: "10px" }}>
          Admin
        </Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sandbox" element={<Sandbox />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/wif-to-hd" element={<WifToHdConversion />} />
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
        <Route path="/bridge" element={<Bridge />} />
        <Route path="/markets" element={<Markets />} />
        <Route path="/admin" element={<AdminPanel />} />
      </Routes>
    </Router>
  );
}

export default App;
