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
import { addresses } from "../../shared/constants";

const WYDA = addresses.yadaERC20Address; // Replace with actual WYDA token address
const USDT = "0x55d398326f99059fF775485246999027B3197955"; // USDT address on BSC (example)

// === ON-CHAIN QUOTE via Router Contract ===
const getQuote = async (router, fromToken, toToken, amountIn) => {
  if (!router || !amountIn || parseFloat(amountIn) === 0) return null;

  try {
    const amountInWei = ethers.parseUnits(amountIn, 18);
    const path = [fromToken, toToken]; // Direct path: WYDA ↔ USDT

    const amounts = await router.getAmountsOut(amountInWei, path);
    return ethers.formatUnits(amounts[1], 18); // Output amount
  } catch (e) {
    console.warn("Quote failed:", e);
    return null;
  }
};

export const SwapForm = ({ appContext, walletManager }) => {
  const { pancakeRouter, parsedData, webcamRef, selectedBlockchain } =
    appContext;

  // Define token options for WYDA and USDT only
  const tokenOptions = [
    { value: WYDA, label: "WYDA" },
    { value: USDT, label: "USDT" },
  ];

  // Helper: Refresh balance/history
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

  // === 1. Quote on change ===
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
    const timer = setTimeout(quote, 400); // Debounce
    return () => clearTimeout(timer);
  }, [quote]);

  // === 2. Execute Swap ===
  const executeSwap = async () => {
    if (!pancakeRouter || !amountIn || !toToken || !amountOut) return;

    setLoading(true);
    try {
      const amountInWei = ethers.parseUnits(amountIn, 18);
      const amountOutWei = ethers.parseUnits(amountOut, 18);
      const amountOutMinWei = (amountOutWei * 995n) / 1000n; // 0.5% slippage
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const to = parsedData?.publicKeyHash;

      const token = new ethers.Contract(
        fromToken,
        ["function approve(address,uint256)"],
        pancakeRouter.runner
      );
      await (await token.approve(pancakeRouter.target, amountInWei)).wait();

      const tx = await pancakeRouter.swapExactTokensForTokens(
        amountInWei,
        amountOutMinWei,
        [fromToken, toToken],
        to,
        deadline
      );

      //await walletManager.signTransaction({ parsedData }, webcamRef, tx);
      await refreshAfterTx();
      notifications.show({ title: "Swap submitted", color: "green" });
    } catch (e) {
      notifications.show({
        title: "Swap failed",
        message: e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  // === 3. Guard: BSC + Router ===
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
      <Title order={4}>Swap WYDA ↔ USDT</Title>

      <Group mt="md" grow>
        <Select
          label="From"
          data={tokenOptions}
          value={fromToken}
          onChange={(value) => {
            setFromToken(value);
            // Automatically set the opposite token for "To"
            setToToken(value === WYDA ? USDT : WYDA);
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
        {loading ? "Submitting…" : "Swap"}
      </Button>
    </Card>
  );
};
