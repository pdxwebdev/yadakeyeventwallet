import YadaBSC from "./YadaBSC";
import YadaBase from "./YadaBase";
import YadaCoin from "./YadaCoin";
import { chainById, providerForChain } from "../shared/constants";

export const walletManagerFactory = (chainOrId) => {
  const chain = chainById(chainOrId);
  const chainId =
    typeof chainOrId === "string" ? chainOrId : chainOrId?.id;

  switch (chainId) {
    case "bsc":
      return new YadaBSC({ provider: providerForChain(chain) });
    case "base":
      return new YadaBase({ provider: providerForChain(chain) });
    case "eth":
      throw new Error(
        "Ethereum WalletManager not yet configured. Add an ETH chain config to YadaEthShared."
      );
    case "yda":
      return new YadaCoin();
    case "btc":
      return new YadaCoin();
    default:
      throw new Error(`Unsupported blockchain: ${chainId}`);
  }
};
