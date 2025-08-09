import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Loader, Table, Pagination, Button, Group } from "@mantine/core"; // Added Button
import WrappedTokenArtifact from "../utils/abis/WrappedToken.json";
import { localProvider } from "../shared/constants";
import { useAppContext } from "../context/AppContext";

const WRAPPED_TOKEN_ABI = WrappedTokenArtifact.abi;

const tokens = {
  [contractAddresses.wrappedTokenWMOCKAddress]: "YWYDA",
  [contractAddresses.wrappedTokenYMOCKAddress]: "PEPE",
  [contractAddresses.yadaERC20Address]: "YDA",
  [contractAddresses.mockPepeAddress]: "PEPE",
};

function TokenHolders() {
  const { loading, setLoading } = useAppContext();
  const [tokenHolders, setTokenHolders] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState("");
  const itemsPerPage = 10;

  // Fetch token holders
  const fetchTokenHolders = async () => {
    setLoading(true);
    try {
      const wrappedTokens = [
        contractAddresses.wrappedTokenWMOCKAddress,
        contractAddresses.wrappedTokenYMOCKAddress,
        contractAddresses.mockPepeAddress,
        contractAddresses.yadaERC20Address,
      ];
      const holdersSet = new Set();

      // Query Transfer events for both tokens
      for (const tokenAddress of wrappedTokens) {
        const token = new ethers.Contract(
          tokenAddress,
          WRAPPED_TOKEN_ABI,
          localProvider
        );
        const filter = token.filters.Transfer(null, null);
        const events = await token.queryFilter(filter, 0, "latest");

        for (const event of events) {
          const { from, to } = event.args;
          if (from !== ethers.ZeroAddress) holdersSet.add(from);
          if (to !== ethers.ZeroAddress) holdersSet.add(to);
        }
      }

      // Check balances for each address
      const holdersWithBalances = [];
      for (const address of holdersSet) {
        for (const tokenAddress of wrappedTokens) {
          const token = new ethers.Contract(
            tokenAddress,
            WRAPPED_TOKEN_ABI,
            localProvider
          );
          const balance = await token.balanceOf(address);
          if (balance > 0) {
            holdersWithBalances.push({
              address,
              token: tokenAddress,
              balance: ethers.formatEther(balance),
            });
          }
        }
      }

      setTokenHolders(holdersWithBalances);
      setTotalPages(Math.ceil(holdersWithBalances.length / itemsPerPage));
      setStatus(
        holdersWithBalances.length > 0
          ? "Token holders loaded"
          : "No token holders found"
      );
    } catch (error) {
      setStatus("Error fetching token holders: " + error.message);
      console.error("Fetch token holders error:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTokenHolders();
  }, []);

  // Pagination handler
  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  // Get paginated holders
  const paginatedHolders = tokenHolders.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div>
      <Group justify="space-between" mb="md">
        <h2>Token Holders</h2>
        <Button onClick={fetchTokenHolders} loading={loading} color="blue">
          Refresh
        </Button>
      </Group>
      <p>{status}</p>
      {loading ? (
        <Loader />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Token</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {paginatedHolders.map((holder, index) => (
                <tr key={index}>
                  <td>{holder.address}</td>
                  <td>{tokens[holder.token]}</td>
                  <td>{holder.balance}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {totalPages > 1 && (
            <Pagination
              total={totalPages}
              page={currentPage}
              onChange={handlePageChange}
              style={{ marginTop: "20px" }}
            />
          )}
        </>
      )}
    </div>
  );
}

export default TokenHolders;
