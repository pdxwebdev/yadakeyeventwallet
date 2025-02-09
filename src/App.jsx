import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import "./App.css";
import Sandbox from "./pages/Sandbox";
import Home from "./pages/Home";

// Main App component with the router
function App() {
  return (
    <Router>
      <div>
        <nav style={{ marginBottom: "20px" }}>
          <Link to="/" style={{ marginRight: "10px" }}>Home</Link>
          <Link to="/passwords" style={{ marginRight: "10px" }}>Passwords</Link>
          <Link to="/wallet" style={{ marginRight: "10px" }}>Wallet</Link>
          <Link to="/sandbox" style={{ marginRight: "10px" }}>Sandbox</Link>
        </nav>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sandbox" element={<Sandbox />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
