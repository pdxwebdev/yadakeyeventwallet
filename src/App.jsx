import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import "./App.css";
import Sandbox from "./pages/Sandbox";
import Home from "./pages/Home";
import Wallet from "./pages/Wallet";
import WifToHdConversion from "./pages/WifToHDConversion";

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
      </Routes>
    </Router>
  );
}

export default App;
