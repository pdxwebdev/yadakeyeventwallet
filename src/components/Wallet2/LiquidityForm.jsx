import React, { useState } from "react";
import { Card, Title, Group, NumberInput, Button, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import { styles } from "../../shared/styles";
import {
  addresses,
  PANCAKE_ROUTER_ADDRESS,
  USDT_ADDRESS,
} from "../../shared/constants";

// === CONFIG: USDT & WYDA (Update these addresses if needed) ===
const WYDA_ADDRESS = addresses.yadaERC20Address; // Replace with actual WYDA address

export const LiquidityForm = ({ appContext, webcamRef, walletManager }) => {
  const router = appContext.getPancakeRouter?.();
  const { parsedData } = appContext;

  const [amountUSDT, setAmountUSDT] = useState("");
  const [amountWYDA, setAmountWYDA] = useState("");
  const [lpAmount, setLpAmount] = useState("");
  const [mode, setMode] = useState("add");
  const [loading, setLoading] = useState(false);

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  // Helper: Refresh balance/history
  const refreshAfterTx = async () => {
    await walletManager.fetchBalance(appContext);
    await walletManager.buildTransactionHistory(appContext);
  };

  // === ADD LIQUIDITY (USDT + WYDA) ===
  const addLiquidity = async () => {
    if (!router || !amountUSDT || !amountWYDA) return;
    setLoading(true);
    try {
      const amountUSDTWei = ethers.parseUnits(amountUSDT, 18);
      const amountWYDAWei = ethers.parseUnits(amountWYDA, 18);
      const minUSDT = (amountUSDTWei * 95n) / 100n;
      const minWYDA = (amountWYDAWei * 95n) / 100n;

      // Approve USDT
      const usdt = new ethers.Contract(
        USDT_ADDRESS,
        ["function approve(address,uint256) external"],
        router.runner
      );
      await (await usdt.approve(PANCAKE_ROUTER_ADDRESS, amountUSDTWei)).wait();

      // Approve WYDA
      const wyda = new ethers.Contract(
        WYDA_ADDRESS,
        ["function approve(address,uint256) external"],
        router.runner
      );
      await (await wyda.approve(PANCAKE_ROUTER_ADDRESS, amountWYDAWei)).wait();

      // Add liquidity
      const tx = await router.addLiquidity(
        USDT_ADDRESS,
        WYDA_ADDRESS,
        amountUSDTWei,
        amountWYDAWei,
        minUSDT,
        minWYDA,
        parsedData?.publicKeyHash,
        deadline
      );

      //await walletManager.signTransaction(appContext, webcamRef, tx);
      await refreshAfterTx();
      notifications.show({ title: "USDT/WYDA LP Added", color: "green" });
    } catch (e) {
      notifications.show({
        title: "Add Failed",
        message: e.message || "Check amounts or approvals",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  // === REMOVE LIQUIDITY ===
  const removeLiquidity = async () => {
    if (!router || !lpAmount) return;
    setLoading(true);
    try {
      const lpWei = ethers.parseUnits(lpAmount, 18);
      const minUSDT = 0n;
      const minWYDA = 0n;

      // Get pair address
      const factory = new ethers.Contract(
        "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
        ["function getPair(address,address) external view returns (address)"],
        router.runner
      );
      const pairAddr = await factory.getPair(USDT_ADDRESS, WYDA_ADDRESS);

      // Approve LP token
      const pair = new ethers.Contract(
        pairAddr,
        ["function approve(address,uint256) external"],
        router.runner
      );
      await (await pair.approve(PANCAKE_ROUTER_ADDRESS, lpWei)).wait();

      // Remove
      const tx = await router.removeLiquidity(
        USDT_ADDRESS,
        WYDA_ADDRESS,
        lpWei,
        minUSDT,
        minWYDA,
        parsedData?.publicKeyHash,
        deadline
      );

      //await walletManager.signTransaction(appContext, webcamRef, tx);
      await refreshAfterTx();
      notifications.show({ title: "USDT/WYDA LP Removed", color: "green" });
    } catch (e) {
      notifications.show({
        title: "Remove Failed",
        message: e.message || "Check LP balance",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
      <Title order={4}>USDT / WYDA Liquidity</Title>

      <Group mt="sm" justify="center">
        <Button
          size="xs"
          variant={mode === "add" ? "filled" : "light"}
          onClick={() => setMode("add")}
        >
          Add
        </Button>
        <Button
          size="xs"
          variant={mode === "remove" ? "filled" : "light"}
          onClick={() => setMode("remove")}
        >
          Remove
        </Button>
      </Group>

      {mode === "add" ? (
        <>
          <Group mt="md" grow align="flex-end">
            <div>
              <Text size="sm" weight={500}>
                USDT Amount
              </Text>
              <NumberInput
                value={amountUSDT}
                onChange={(v) => setAmountUSDT(v?.toString() ?? "")}
                placeholder="0.0"
                min={0}
                decimalScale={6}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <Text size="sm" weight={500}>
                WYDA Amount
              </Text>
              <NumberInput
                value={amountWYDA}
                onChange={(v) => setAmountWYDA(v?.toString() ?? "")}
                placeholder="0.0"
                min={0}
                decimalScale={6}
                style={{ width: "100%" }}
              />
            </div>
          </Group>

          <Button
            mt="md"
            fullWidth
            color="teal"
            onClick={addLiquidity}
            loading={loading}
            disabled={
              !amountUSDT ||
              !amountWYDA ||
              parseFloat(amountUSDT) === 0 ||
              parseFloat(amountWYDA) === 0
            }
          >
            Add USDT/WYDA Liquidity
          </Button>
        </>
      ) : (
        <>
          <NumberInput
            mt="md"
            label="LP Amount to Remove"
            value={lpAmount}
            onChange={(v) => setLpAmount(v?.toString() ?? "")}
            placeholder="0.0"
            min={0}
            decimalScale={6}
          />

          <Button
            mt="md"
            fullWidth
            color="orange"
            onClick={removeLiquidity}
            loading={loading}
            disabled={!lpAmount || parseFloat(lpAmount) === 0}
          >
            Remove USDT/WYDA Liquidity
          </Button>
        </>
      )}
    </Card>
  );
};
