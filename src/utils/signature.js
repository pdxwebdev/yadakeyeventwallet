export const createParamsArrayFromObject = (paramsData) => {
  // Validate required fields
  const requiredFields = [
    "amount",
    "publicKey",
    "prerotatedKeyHash",
    "twicePrerotatedKeyHash",
    "prevPublicKeyHash",
    "outputAddress",
  ];
  for (const field of requiredFields) {
    if (paramsData[field] === undefined) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Ensure amount is bigint
  const amountBigInt =
    typeof paramsData.amount === "number"
      ? BigInt(paramsData.amount)
      : paramsData.amount;

  return [
    amountBigInt, // uint256 amount
    paramsData.publicKey, // bytes publicKey
    paramsData.prerotatedKeyHash, // address prerotatedKeyHash
    paramsData.twicePrerotatedKeyHash, // address twicePrerotatedKeyHash
    paramsData.prevPublicKeyHash, // address prevPublicKeyHash
    paramsData.outputAddress, // address outputAddress
  ];
};

export const signatureFields = [
  "address",
  "tuple(address,string,string,address)[]",
  "tuple(uint256,bytes,address,address,address,address)",
  "uint256",
];
