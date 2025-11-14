import {
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  TextInput,
  Title,
  Loader,
  Text,
} from "@mantine/core";
import { useAppContext } from "../../context/AppContext";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import { useEffect, useState, useCallback } from "react";
import { styles } from "../../shared/styles";
import { addresses, localProvider } from "../../shared/constants";

const WYDA = addresses.yadaERC20Address;
const USDT = "0x55d398326f99059fF775485246999027B3197955"; // USDT on BSC
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"; // WBNB
const NATIVE = "0x0000000000000000000000000000000000000000"; // Represents BNB

// === GET QUOTE (WYDA↔USDT, WYDA↔BNB, BNB↔WYDA) ===
const getQuote = async (router, fromToken, toToken, amountIn) => {
  if (!router || !amountIn || parseFloat(amountIn) === 0) return null;

  try {
    const amountInWei = ethers.parseUnits(amountIn, 18);

    // Build path: always go through WBNB when one side is native
    let path;
    if (fromToken === NATIVE) {
      path = [WBNB, toToken]; // BNB → Token
    } else if (toToken === NATIVE) {
      path = [fromToken, WBNB]; // Token → BNB
    } else {
      path = [fromToken, toToken]; // Token → Token
    }

    const amounts = await router.getAmountsOut(amountInWei, path);
    return ethers.formatUnits(amounts[amounts.length - 1], 18);
  } catch (e) {
    console.warn("Quote failed:", e);
    return null;
  }
};

export const SwapForm = ({ appContext, walletManager }) => {
  const { pancakeRouter, parsedData, webcamRef, selectedBlockchain } =
    appContext;

  const tokenOptions = [
    { value: WYDA, label: "WYDA" },
    { value: USDT, label: "USDT" },
    { value: NATIVE, label: "BNB" },
  ];

  const refreshAfterTx = async () => {
    await walletManager.fetchBalance(appContext);
    await walletManager.buildTransactionHistory(appContext);
  };

  const [fromToken, setFromToken] = useState(WYDA);
  const [toToken, setToToken] = useState(USDT);
  const [amountIn, setAmountIn] = useState("");
  const [amountOut, setAmountOut] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [loading, setLoading] = useState(false);

  // === DEBOUNCED QUOTE ===
  const quote = useCallback(async () => {
    if (!fromToken || !toToken || !amountIn || parseFloat(amountIn) === 0) {
      setAmountOut("");
      return;
    }
    setQuoting(true);
    const out = await getQuote(pancakeRouter, fromToken, toToken, amountIn);
    setAmountOut(out || "");
    setQuoting(false);
  }, [pancakeRouter, fromToken, toToken, amountIn]);

  useEffect(() => {
    const timer = setTimeout(quote, 400);
    return () => clearTimeout(timer);
  }, [quote]);

  // ------------------------------------------------------------------
  //  EXECUTE SWAP – works with ethers v6, signer + provider
  // ------------------------------------------------------------------
  const executeSwap = async () => {
    if (!pancakeRouter || !amountIn || !toToken || !amountOut) return;
    const { privateKey } = appContext;

    setLoading(true);
    try {
      // --------------------------------------------------------------
      // 1. GET SIGNER (adjust the line that matches your walletManager)
      // --------------------------------------------------------------
      const signer = new ethers.Wallet(
        ethers.hexlify(privateKey.privateKey),
        localProvider
      );

      if (!signer) throw new Error("Wallet not connected – no signer.");

      // --------------------------------------------------------------
      // 2. READ-ONLY router (provider) – for getAmountsOut, allowance…
      // --------------------------------------------------------------
      const routerReadOnly = pancakeRouter; // already on a provider
      const routerWithSigner = pancakeRouter.connect(signer); // write-enabled

      const amountInWei = ethers.parseUnits(amountIn, 18);
      const amountOutWei = ethers.parseUnits(amountOut, 18);
      const amountOutMinWei = (amountOutWei * 995n) / 1000n; // 0.5 % slippage
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const to = parsedData?.publicKeyHash;

      // --------------------------------------------------------------
      // 3. APPROVE helper – uses **provider** for allowance check
      // --------------------------------------------------------------
      const approveIfNeeded = async (token) => {
        if (token === NATIVE) return; // BNB never needs approve

        // ERC-20 contract with **provider** (read-only)
        const erc20Read = new ethers.Contract(
          token,
          [
            "function allowance(address owner, address spender) view returns (uint256)",
          ],
          routerReadOnly.runner // provider
        );

        const owner = await signer.getAddress();
        const allowance = await erc20Read.allowance(
          owner,
          routerWithSigner.target
        );

        if (allowance >= amountInWei) return; // already enough

        // ERC-20 contract with **signer** (write)
        const erc20Write = new ethers.Contract(
          token,
          ["function approve(address spender, uint256 amount) returns (bool)"],
          signer
        );

        const approveTx = await erc20Write.approve(
          routerWithSigner.target,
          amountInWei
        );
        await approveTx.wait();
      };

      // --------------------------------------------------------------
      // 4. SWAP – pick the correct PancakeRouter method
      // --------------------------------------------------------------
      let tx;

      if (fromToken === NATIVE && toToken !== NATIVE) {
        // BNB → ERC-20
        tx = await routerWithSigner.swapExactETHForTokens(
          amountOutMinWei,
          [WBNB, toToken],
          to,
          deadline,
          { value: amountInWei }
        );
      } else if (fromToken !== NATIVE && toToken === NATIVE) {
        // ERC-20 → BNB
        await approveIfNeeded(fromToken);
        tx = await routerWithSigner.swapExactTokensForETH(
          amountInWei,
          amountOutMinWei,
          [fromToken, WBNB],
          to,
          deadline
        );
      } else {
        // ERC-20 → ERC-20
        await approveIfNeeded(fromToken);
        tx = await routerWithSigner.swapExactTokensForTokens(
          amountInWei,
          amountOutMinWei,
          [fromToken, toToken],
          to,
          deadline
        );
      }

      // --------------------------------------------------------------
      // 5. OPTIONAL webcam signing (keep your existing flow)
      // --------------------------------------------------------------
      // await walletManager.signTransaction({ parsedData }, webcamRef, tx);

      console.log("Swap tx:", tx.hash);
      await tx.wait();
      await refreshAfterTx();

      notifications.show({ title: "Swap successful!", color: "green" });
    } catch (e) {
      console.error("Swap error:", e);
      notifications.show({
        title: "Swap failed",
        message: e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  // === GUARD: BSC + Router ===
  if (selectedBlockchain.id !== "bsc" || !pancakeRouter) {
    return (
      <Text color="dimmed" align="center" mt="md">
        Swaps are only available on BSC with a connected wallet.
      </Text>
    );
  }

  const canSwap =
    amountIn &&
    parseFloat(amountIn) > 0 &&
    toToken &&
    amountOut &&
    parseFloat(amountOut) > 0 &&
    fromToken !== toToken;

  return (
    <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
      <Title order={4}>
        Swap {tokenOptions.find((i) => i.value === fromToken).label} /{" "}
        {tokenOptions.find((i) => i.value === toToken).label} via PancakeSwap
      </Title>

      <Group mt="md" grow>
        <Select
          label="From"
          data={tokenOptions}
          value={fromToken}
          onChange={(value) => {
            setFromToken(value);
            // Auto-switch "To" to a different token
            const otherTokens = tokenOptions
              .filter((t) => t.value !== value)
              .map((t) => t.value);
            if (!otherTokens.includes(toToken)) {
              setToToken(otherTokens[0]);
            }
          }}
        />
        <NumberInput
          label="Amount"
          value={amountIn}
          onChange={(v) => setAmountIn(v?.toString() ?? "")}
          placeholder="0.0"
          min={0}
          decimalScale={6}
        />
      </Group>

      <Group mt="md" grow>
        <Select
          label="To"
          data={tokenOptions.filter((o) => o.value !== fromToken)}
          value={toToken}
          onChange={setToToken}
          disabled={!fromToken}
        />
        <div style={{ position: "relative", width: "100%" }}>
          <TextInput
            label="You receive (est.)"
            value={amountOut}
            disabled
            placeholder={quoting ? "…" : "Enter amount"}
          />
          {quoting && (
            <Loader
              size="xs"
              style={{ position: "absolute", right: 12, top: 38 }}
            />
          )}
        </div>
      </Group>

      <Button
        mt="md"
        fullWidth
        color="blue"
        onClick={executeSwap}
        loading={loading}
        disabled={!canSwap}
      >
        {loading
          ? "Submitting…"
          : `Swap ${tokenOptions.find((i) => i.value === fromToken).label}  for
        ${tokenOptions.find((i) => i.value === toToken).label}`}
      </Button>
    </Card>
  );
};
