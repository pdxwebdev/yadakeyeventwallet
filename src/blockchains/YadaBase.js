import YadaEthShared from "./YadaEthShared";
import {
  BLOCKCHAINS,
  addresses,
  baseAddresses,
  baseProvider,
} from "../shared/constants";

const baseChain = BLOCKCHAINS.find((chain) => chain.id === "base");

export const baseConfig = {
  id: "base",
  name: baseChain?.name || "Base (Coinbase)",
  chainId: baseChain?.chainId || 8453,
  provider: baseProvider,
  addresses: baseAddresses,
  nativeSymbol: "ETH",
  nativeName: "Ether",
  staticDeployment: true,
  foreignKeyLogRegistryAddresses: [addresses.keyLogRegistryAddress],
  deployEnv: "deploybase",
  requireDeployerBalance: true,
  lpTokenAddress: null,
  lpFactoryAddress: null,
  usdtAddress: baseAddresses.usdcAddress,
};

class YadaBase extends YadaEthShared {
  constructor(config = {}) {
    super({ ...baseConfig, ...config });
  }
}

export default YadaBase;
