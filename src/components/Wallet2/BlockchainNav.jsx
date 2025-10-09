// src/components/BlockchainNav.js
import { useState, useEffect } from "react";
import { NavLink, ScrollArea } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { ethers } from "ethers";
import { notifications } from "@mantine/notifications";
import { BLOCKCHAINS, BRIDGE_ABI } from "../../shared/constants";
import BridgeArtifact from "../../utils/abis/Bridge.json";
import KeyLogRegistryArtifact from "../../utils/abis/KeyLogRegistry.json";
import MockERC20Artifact from "../../utils/abis/MockERC20.json";
import WrappedTokenArtifact from "../../utils/abis/WrappedToken.json";
import { useAppContext } from "../../context/AppContext";

const BlockchainNav = () => {
  const {
    selectedBlockchain,
    setSelectedBlockchain,
    setTokenPairs,
    setSelectedOriginal,
    setLog,
    setBalance,
    setTokenPairsFetched,
  } = useAppContext();
  const [tokenLists, setTokenLists] = useState({});

  // Fetch supported tokens for each blockchain
  useEffect(() => {
    const fetchTokens = async () => {
      const newTokenLists = {};
      for (const blockchain of BLOCKCHAINS) {
        try {
          if (!blockchain.bridgeAddress) return;
          const provider = new ethers.JsonRpcProvider(blockchain.providerUrl);
          const bridge = new ethers.Contract(
            blockchain.bridgeAddress,
            BRIDGE_ABI,
            provider
          );
          const supportedTokens = await bridge.getSupportedTokens();

          // Fetch token metadata (e.g., symbol)
          const tokenDetails = await Promise.all(
            supportedTokens.map(async (tokenAddress) => {
              const tokenContract = new ethers.Contract(
                tokenAddress,
                [
                  "function symbol() view returns (string)",
                  "function name() view returns (string)",
                ],
                provider
              );
              const symbol = await tokenContract.symbol();
              const name = await tokenContract.name();
              return {
                address: tokenAddress,
                symbol,
                name,
                isCrossChain: false,
              }; // Adjust isCrossChain as needed
            })
          );

          newTokenLists[blockchain.id] = tokenDetails;
        } catch (error) {
          console.error(`Error fetching tokens for ${blockchain.name}:`, error);
          notifications.show({
            title: "Error",
            message: `Failed to load tokens for ${blockchain.name}`,
            color: "red",
          });
        }
      }
      setTokenLists(newTokenLists);
      // Update tokenPairs in context for the selected blockchain
      if (newTokenLists[selectedBlockchain]) {
        setTokenPairs(newTokenLists[selectedBlockchain]);
      }
    };

    fetchTokens();
  }, [selectedBlockchain, setTokenPairs]);

  return (
    <ScrollArea style={{ height: "100vh" }}>
      {BLOCKCHAINS.map((blockchain) => (
        <NavLink
          key={blockchain.id}
          label={blockchain.name}
          active={selectedBlockchain === blockchain.id}
          onClick={() => {
            setSelectedBlockchain(blockchain.id);
            setTokenPairs(tokenLists[blockchain.id] || []);
            setSelectedOriginal("");
            setLog([]);
            setBalance(null);
            setTokenPairsFetched(false);
          }}
          rightSection={<IconChevronRight size={12} />}
        >
          {tokenLists[blockchain.id]?.map((token) => (
            <NavLink
              key={token.address}
              label={token.symbol}
              onClick={() => setSelectedOriginal(token.address)}
              active={selectedOriginal === token.address}
              style={{ paddingLeft: 30 }}
            />
          ))}
        </NavLink>
      ))}
    </ScrollArea>
  );
};

export default BlockchainNav;
