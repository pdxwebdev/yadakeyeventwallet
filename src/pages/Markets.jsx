// src/pages/Markets.jsx
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import BridgeArtifact from "../utils/abis/Bridge.json";
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";

const BRIDGE_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const localProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/");

function Markets() {
  const [tokenPairs, setTokenPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchTokenPairs();
  }, []);

  const fetchTokenPairs = async () => {
    try {
      setLoading(true);
      setError("");

      const bridge = new ethers.Contract(
        BRIDGE_ADDRESS,
        BridgeArtifact.abi,
        localProvider
      );

      // Known original tokens from your setup
      const knownOriginalTokens = [
        "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707", // $MOCK
        "0x0165878A594ca255338adfa4d48449f69242Eb8F", // $MOCK2
      ];

      const pairs = await Promise.all(
        knownOriginalTokens.map(async (original) => {
          const wrapped = await bridge.originalToWrapped(original);
          if (wrapped !== ethers.ZeroAddress) {
            const wrappedContract = new ethers.Contract(
              wrapped,
              WrappedTokenArtifact.abi,
              localProvider
            );
            const name = await wrappedContract.name();
            const symbol = await wrappedContract.symbol();
            const isCrossChain = await bridge.isCrossChain(wrapped);
            return { original, wrapped, name, symbol, isCrossChain };
          }
          return null;
        })
      );

      const filteredPairs = pairs.filter((pair) => pair !== null);
      setTokenPairs(filteredPairs);
      setLoading(false);
    } catch (err) {
      setError(`Error fetching token pairs: ${err.message}`);
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Markets</h1>

      {loading ? (
        <p>Loading markets...</p>
      ) : error ? (
        <p style={{ color: "red" }}>{error}</p>
      ) : tokenPairs.length === 0 ? (
        <p>No token pairs found.</p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "20px",
          }}
        >
          <thead>
            <tr>
              <th style={{ border: "1px solid #ddd", padding: "8px" }}>
                Token
              </th>
              <th style={{ border: "1px solid #ddd", padding: "8px" }}>
                Original Address
              </th>
              <th style={{ border: "1px solid #ddd", padding: "8px" }}>
                Wrapped Address
              </th>
              <th style={{ border: "1px solid #ddd", padding: "8px" }}>
                Cross-Chain
              </th>
            </tr>
          </thead>
          <tbody>
            {tokenPairs.map((pair) => (
              <tr key={pair.wrapped}>
                <td style={{ border: "1px solid #ddd", padding: "8px" }}>
                  {pair.name} ({pair.symbol})
                </td>
                <td style={{ border: "1px solid #ddd", padding: "8px" }}>
                  {pair.original}
                </td>
                <td style={{ border: "1px solid #ddd", padding: "8px" }}>
                  {pair.wrapped}
                </td>
                <td style={{ border: "1px solid #ddd", padding: "8px" }}>
                  {pair.isCrossChain ? "Yes" : "No"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        onClick={fetchTokenPairs}
        style={{ marginTop: "20px", padding: "8px 16px", cursor: "pointer" }}
      >
        Refresh Markets
      </button>
    </div>
  );
}

export default Markets;
