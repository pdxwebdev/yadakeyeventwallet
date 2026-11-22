// src/components/BlockchainNav.js
import { useState, useEffect, useContext } from "react";
import { NavLink, ScrollArea } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { ethers } from "ethers";
import { notifications } from "@mantine/notifications";
import {
  BLOCKCHAINS,
  BRIDGE_ABI,
  addressesForChain,
  nativeTokenForChain,
  providerForChain,
} from "../../shared/constants";
import { useAppContext } from "../../context/AppContext";
import { ThemeContext } from "../../main.jsx"; // Adjust path as needed

const ERC20_METADATA_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const BlockchainNav = () => {
  const {
    selectedBlockchain,
    setSelectedBlockchain,
    setTokenPairs,
    setSelectedOriginal,
    selectedOriginal,
    setSelectedToken,
    setLog,
    setBalance,
    setTokenPairsFetched,
  } = useAppContext();
  const [tokenLists, setTokenLists] = useState({});
  const { setPrimaryColor } = useContext(ThemeContext);

  useEffect(() => {
    const fetchTokens = async () => {
      const newTokenLists = {};
      for (const blockchain of BLOCKCHAINS) {
        if (!blockchain.isBridge || !["base", "bsc"].includes(blockchain.id)) {
          continue;
        }
        const chainAddresses = addressesForChain(blockchain.id);
        if (!chainAddresses?.bridgeAddress) continue;

        try {
          const provider = providerForChain(blockchain);
          const bridge = new ethers.Contract(
            chainAddresses.bridgeAddress,
            BRIDGE_ABI,
            provider
          );
          const supportedTokens = await bridge.getSupportedTokens();
          const nativeToken = nativeTokenForChain(blockchain.id);

          const tokenDetails = (
            await Promise.all(
              supportedTokens.map(async (original) => {
                try {
                  const pair = await bridge.tokenPairs(original);
                  if (pair.wrappedToken === ethers.ZeroAddress) return null;

                  if (
                    original.toLowerCase() === ethers.ZeroAddress.toLowerCase()
                  ) {
                    if (!nativeToken) return null;
                    return {
                      original,
                      wrapped: pair.wrappedToken,
                      name: nativeToken.name,
                      symbol: nativeToken.symbol,
                      decimals: 18,
                    };
                  }

                  const wrappedContract = new ethers.Contract(
                    pair.wrappedToken,
                    ERC20_METADATA_ABI,
                    provider
                  );
                  const [name, symbol] = await Promise.all([
                    wrappedContract.name(),
                    wrappedContract.symbol(),
                  ]);
                  return {
                    original,
                    wrapped: pair.wrappedToken,
                    name,
                    symbol,
                    decimals: 18,
                  };
                } catch (error) {
                  console.warn(
                    `Error fetching pair for original token ${original}:`,
                    error
                  );
                  return null;
                }
              })
            )
          ).filter(Boolean);

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
      if (newTokenLists[selectedBlockchain.id]) {
        setTokenPairs(newTokenLists[selectedBlockchain.id]);
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
          active={selectedBlockchain.id === blockchain.id}
          onClick={() => {
            if (selectedBlockchain.id === blockchain.id) return;
            setSelectedBlockchain(blockchain);
            setTokenPairs(tokenLists[blockchain.id] || []);
            setSelectedOriginal("");
            setLog([]);
            setBalance(null);
            setTokenPairsFetched(false);
            setPrimaryColor(blockchain.color);
          }}
          rightSection={<IconChevronRight size={12} />}
        >
          {tokenLists[blockchain.id]?.map((token) => (
            <NavLink
              key={token.original}
              label={token.symbol}
              onClick={() => {
                setSelectedOriginal(token.original);
                setSelectedToken(token.original);
              }}
              active={selectedOriginal === token.original}
              style={{ paddingLeft: 30 }}
            />
          ))}
        </NavLink>
      ))}
    </ScrollArea>
  );
};

export default BlockchainNav;
