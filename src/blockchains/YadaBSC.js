import YadaEthShared from "./YadaEthShared";
import {
  BLOCKCHAINS,
  DEPLOY_ENV,
  LP_ADDRESS,
  PANCAKESWAP_V2_FACTORY,
  USDT_ADDRESS,
  addresses,
  baseAddresses,
  bscProvider,
} from "../shared/constants";

const bscChain = BLOCKCHAINS.find((chain) => chain.id === "bsc");

export const bscConfig = {
  id: "bsc",
  name: bscChain?.name || "Binance Smart Chain (BSC)",
  chainId: bscChain?.chainId || 56,
  provider: bscProvider,
  addresses,
  nativeSymbol: "BNB",
  nativeName: "Binance Coin",
  staticDeployment: DEPLOY_ENV !== "localhost",
  foreignKeyLogRegistryAddresses: [baseAddresses.keyLogRegistryAddress],
  deployEnv:
    DEPLOY_ENV === "mainnet"
      ? "deploymain"
      : DEPLOY_ENV === "testnet"
      ? "deploytest"
      : "deploy",
  requireDeployerBalance: false,
  lpTokenAddress: LP_ADDRESS,
  lpFactoryAddress: PANCAKESWAP_V2_FACTORY,
  usdtAddress: USDT_ADDRESS,
};

class YadaBSC extends YadaEthShared {
  constructor(config = {}) {
    super({ ...bscConfig, ...config });
  }
}

export default YadaBSC;
