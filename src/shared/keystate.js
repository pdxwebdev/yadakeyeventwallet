import { ethers } from "ethers";
import { deriveSecurePath } from "../utils/hdWallet";
import { localProvider } from "./constants";

export const deriveNextKey = async (baseKey, kdp) => {
    const derivedKey = await deriveSecurePath(baseKey, kdp);
    const signer = new ethers.Wallet(
      ethers.hexlify(derivedKey.privateKey),
      localProvider
    );
    return { key: derivedKey, signer };
  };

export const getKeyState = async (baseKey, log, kdp) => {
  console.log("Current Index:", log.length);
  let currentKey = {
    key: baseKey,
    signer: new ethers.Wallet(
      ethers.hexlify(baseKey.privateKey),
      localProvider
    ),
  };
  let prevDerivedKey = null;

  if (log.length > 0) {
    const lastLog = log[log.length - 1];
    while (currentKey.signer.address !== lastLog.prerotatedKeyHash) {
      prevDerivedKey = currentKey;
      currentKey = await deriveNextKey(currentKey.key,
        kdp);
    }
  } else {
    prevDerivedKey = currentKey;
    currentKey = await deriveNextKey(currentKey.key,
        kdp);
  }

  const currentDerivedKey = currentKey;
  const nextDerivedKey = await deriveNextKey(currentDerivedKey.key,
        kdp);
  const nextNextDerivedKey = await deriveNextKey(nextDerivedKey.key,
        kdp);
  const nextNextNextDerivedKey = await deriveNextKey(
    nextNextDerivedKey.key,
        kdp
  );
  console.log({
    prevDerivedKey: prevDerivedKey.signer.address,
    currentDerivedKey: currentDerivedKey.signer.address,
    nextDerivedKey: nextDerivedKey.signer.address,
    nextNextDerivedKey: nextNextDerivedKey.signer.address,
    nextNextNextDerivedKey: nextNextNextDerivedKey.signer.address,
  });
  return {
    prevDerivedKey,
    currentDerivedKey,
    nextDerivedKey,
    nextNextDerivedKey,
    nextNextNextDerivedKey
  };
};