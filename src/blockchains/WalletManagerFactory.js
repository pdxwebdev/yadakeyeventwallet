
import YadaBSC from "./YadaBSC";
import YadaCoin from "./YadaCoin";

export const walletManagerFactory = (blockchainId, appContext, webcamRef) => {
  switch (blockchainId) {
    case "bsc":
      return new YadaBSC(appContext, webcamRef);
    case "eth":
      // return new YadaETH(appContext);
      throw new Error("Ethereum WalletManager not yet implemented");
    case "yda":
      return new YadaCoin(appContext, webcamRef);
    default:
      throw new Error(`Unsupported blockchain: ${blockchainId}`);
  }
};