/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Group, Select, Text, Title } from "@mantine/core";
import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import { styles } from "../../shared/styles";
import {
  addresses,
  DEPLOY_ENV,
  localProvider,
  YADA_MARGIN_VAULT_ABI,
} from "../../shared/constants";
import AmountInput from "./AmountInput";

const HARDHAT_FAUCET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const formatPrice = (wei) => {
  if (wei == null) return "—";
  const n = Number(ethers.formatUnits(wei, 18));
  if (!Number.isFinite(n)) return ethers.formatUnits(wei, 18);
  return n.toFixed(6);
};

const formatUsdt = (wei) => {
  if (wei == null) return "0";
  return Number(ethers.formatUnits(wei, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
};

const formatSigned = (wei) => {
  if (wei == null) return "0";
  const n = Number(ethers.formatUnits(wei, 18));
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
};

export const MarginForm = ({ appContext, walletManager }) => {
  const { parsedData, privateKey, selectedBlockchain } = appContext;
  const vaultAddress = addresses.yadaMarginVaultAddress;
  const isLocal = DEPLOY_ENV !== "mainnet" && DEPLOY_ENV !== "testnet";

  const [side, setSide] = useState("short");
  const [collateral, setCollateral] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [leverage, setLeverage] = useState("5");
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mark, setMark] = useState(null);
  const [position, setPosition] = useState(null);
  const [pnl, setPnl] = useState(0n);
  const [equity, setEquity] = useState(0n);
  const [maintenance, setMaintenance] = useState(0n);
  const [liquidatable, setLiquidatable] = useState(false);
  const [insurance, setInsurance] = useState(0n);

  const getSigner = () => {
    if (!privateKey?.privateKey) return null;
    return new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
  };

  const getVault = useCallback(
    (runner = localProvider) => {
      if (!vaultAddress) return null;
      return new ethers.Contract(vaultAddress, YADA_MARGIN_VAULT_ABI, runner);
    },
    [vaultAddress]
  );

  const load = useCallback(async () => {
    const vault = getVault();
    const user = parsedData?.publicKeyHash;
    if (!vault) return;
    try {
      const [price, fund] = await Promise.all([
        vault.markPrice(),
        vault.insuranceFund(),
      ]);
      setMark(price);
      setInsurance(fund);
      if (!user) {
        setPosition(null);
        setPnl(0n);
        setEquity(0n);
        setMaintenance(0n);
        setLiquidatable(false);
        return;
      }
      const [nextPosition, nextPnl, nextEquity, nextMaint, nextLiq] =
        await Promise.all([
          vault.getPosition(user),
          vault.pnlOf(user),
          vault.equityOf(user),
          vault.maintenanceOf(user),
          vault.isLiquidatable(user),
        ]);
      setPosition(nextPosition);
      setPnl(nextPnl);
      setEquity(nextEquity);
      setMaintenance(nextMaint);
      setLiquidatable(nextLiq);
    } catch (e) {
      console.warn("Margin vault load failed:", e);
    }
  }, [getVault, parsedData?.publicKeyHash]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const refreshAfterTx = async () => {
    await walletManager.fetchBalance(appContext);
    await walletManager.buildTransactionHistory(appContext);
    await load();
  };

  const approveIfNeeded = async (signer, amountWei) => {
    const vault = getVault(signer);
    const token = await vault.collateralToken();
    const erc20 = new ethers.Contract(
      token,
      [
        "function allowance(address owner, address spender) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)",
      ],
      signer
    );
    const owner = await signer.getAddress();
    const allowance = await erc20.allowance(owner, vaultAddress);
    if (allowance >= amountWei) return;
    if (allowance > 0n) {
      await (await erc20.approve(vaultAddress, 0n)).wait();
    }
    await (await erc20.approve(vaultAddress, amountWei)).wait();
  };

  const mintTestUsdt = async () => {
    const user = parsedData?.publicKeyHash || (await getSigner()?.getAddress());
    const vault = getVault();
    if (!user || !vault) return;
    setMinting(true);
    try {
      const userBal = await localProvider.getBalance(user);
      if (userBal < ethers.parseEther("1")) {
        await localProvider.send("hardhat_setBalance", [
          user,
          ethers.toBeHex(ethers.parseEther("10")),
        ]);
      }
      const token = await vault.collateralToken();
      const data = new ethers.Interface([
        "function mint(address to, uint256 amount)",
      ]).encodeFunctionData("mint", [user, ethers.parseEther("1000")]);
      const hash = await localProvider.send("eth_sendTransaction", [
        { from: HARDHAT_FAUCET, to: token, data },
      ]);
      await localProvider.waitForTransaction(hash);
      await refreshAfterTx();
      notifications.show({ title: "Minted 1000 test USDT", color: "green" });
    } catch (e) {
      notifications.show({
        title: "Mint failed",
        message: e.shortMessage || e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setMinting(false);
    }
  };

  const openPosition = async () => {
    const signer = getSigner();
    const vault = getVault(signer);
    if (!signer || !vault || !collateral) return;
    setLoading(true);
    try {
      const amountWei = ethers.parseUnits(collateral, 18);
      await approveIfNeeded(signer, amountWei);
      const tx = await vault.openPosition(
        side === "short",
        amountWei,
        BigInt(leverage)
      );
      await tx.wait();
      await refreshAfterTx();
      notifications.show({
        title: side === "short" ? "Short opened" : "Long opened",
        color: "green",
      });
      setCollateral("");
    } catch (e) {
      notifications.show({
        title: "Open failed",
        message: e.shortMessage || e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  const addMoreCollateral = async () => {
    const signer = getSigner();
    const vault = getVault(signer);
    if (!signer || !vault || !addAmount) return;
    setAdding(true);
    try {
      const amountWei = ethers.parseUnits(addAmount, 18);
      await approveIfNeeded(signer, amountWei);
      const tx = await vault.addCollateral(amountWei);
      await tx.wait();
      await refreshAfterTx();
      notifications.show({ title: "Collateral added", color: "green" });
      setAddAmount("");
    } catch (e) {
      notifications.show({
        title: "Add failed",
        message: e.shortMessage || e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setAdding(false);
    }
  };

  const closePosition = async () => {
    const signer = getSigner();
    const vault = getVault(signer);
    if (!signer || !vault) return;
    setClosing(true);
    try {
      const tx = await vault.closePosition();
      await tx.wait();
      await refreshAfterTx();
      notifications.show({ title: "Position closed", color: "green" });
    } catch (e) {
      notifications.show({
        title: "Close failed",
        message: e.shortMessage || e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setClosing(false);
    }
  };

  if (selectedBlockchain.id !== "bsc") {
    return (
      <Text color="dimmed" align="center" mt="md">
        Margin is only available on BSC.
      </Text>
    );
  }

  if (!vaultAddress) {
    return (
      <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
        <Title order={4}>YDA isolated margin</Title>
        <Text size="sm" c="dimmed" mt="sm">
          Vault is not deployed yet. After
          {` npx hardhat run scripts/deployYadaMarginVault.js --network localhost`}
          , set addresses.yadaMarginVaultAddress.
        </Text>
      </Card>
    );
  }

  const isOpen = Boolean(position?.open);
  const canOpen =
    !isOpen && collateral && parseFloat(collateral) > 0 && leverage;
  const canAdd = isOpen && addAmount && parseFloat(addAmount) > 0;

  return (
    <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
      <Group justify="space-between" align="flex-start">
        <Title order={4}>YDA isolated margin</Title>
        <Badge color={isOpen ? (position.isShort ? "red" : "teal") : "gray"}>
          {isOpen ? (position.isShort ? "Short open" : "Long open") : "Flat"}
        </Badge>
      </Group>

      <Text size="sm" c="dimmed" mt="xs">
        USDT collateral, up to 10×, marked to Pancake WYDA/USDT. Isolated —
        only this vault position can be liquidated.
      </Text>

      <Group mt="md" grow>
        <div>
          <Text size="xs" c="dimmed">
            Mark
          </Text>
          <Text fw={600}>{formatPrice(mark)} USDT</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Insurance
          </Text>
          <Text fw={600}>{formatUsdt(insurance)} USDT</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Equity
          </Text>
          <Text fw={600}>{isOpen ? `${formatUsdt(equity)} USDT` : "—"}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            PnL
          </Text>
          <Text fw={600} c={pnl > 0n ? "teal" : pnl < 0n ? "red" : undefined}>
            {isOpen ? `${formatSigned(pnl)} USDT` : "—"}
          </Text>
        </div>
      </Group>

      {isOpen && (
        <Text size="sm" mt="sm">
          {formatUsdt(position.collateral)} USDT × {position.leverage.toString()}
          × @ {formatPrice(position.entryPrice)} · maint{" "}
          {formatUsdt(maintenance)} USDT
          {liquidatable ? " · liquidatable" : ""}
        </Text>
      )}

      {!isOpen && (
        <>
          <Group mt="md" justify="center">
            <Button
              size="xs"
              color="red"
              variant={side === "short" ? "filled" : "light"}
              onClick={() => setSide("short")}
              leftSection={<IconTrendingDown size={14} />}
            >
              Short
            </Button>
            <Button
              size="xs"
              color="teal"
              variant={side === "long" ? "filled" : "light"}
              onClick={() => setSide("long")}
              leftSection={<IconTrendingUp size={14} />}
            >
              Long
            </Button>
          </Group>

          <Group mt="md" grow align="flex-end">
            <AmountInput
              label="USDT collateral"
              value={collateral}
              onChange={(v) => setCollateral(v?.toString() ?? "")}
              placeholder="0.0"
              min={0}
              decimalScale={18}
            />
            <Select
              label="Leverage"
              data={["1", "2", "3", "5", "10"].map((v) => ({
                value: v,
                label: `${v}×`,
              }))}
              value={leverage}
              onChange={(v) => setLeverage(v || "5")}
            />
          </Group>

          <Button
            mt="md"
            fullWidth
            color={side === "short" ? "red" : "teal"}
            onClick={openPosition}
            loading={loading}
            disabled={!canOpen}
            leftSection={
              side === "short" ? (
                <IconTrendingDown size={16} />
              ) : (
                <IconTrendingUp size={16} />
              )
            }
          >
            {side === "short"
              ? `Open ${leverage}× short`
              : `Open ${leverage}× long`}
          </Button>
        </>
      )}

      {isOpen && (
        <>
          <AmountInput
            mt="md"
            label="Add USDT collateral"
            value={addAmount}
            onChange={(v) => setAddAmount(v?.toString() ?? "")}
            placeholder="0.0"
            min={0}
            decimalScale={18}
          />
          <Button
            mt="sm"
            fullWidth
            variant="light"
            onClick={addMoreCollateral}
            loading={adding}
            disabled={!canAdd}
          >
            Add collateral
          </Button>
          <Button
            mt="sm"
            fullWidth
            color="orange"
            onClick={closePosition}
            loading={closing}
          >
            Close position
          </Button>
        </>
      )}

      {isLocal && (
        <Button
          mt="md"
          fullWidth
          variant="light"
          onClick={mintTestUsdt}
          loading={minting}
        >
          Get 1000 test USDT
        </Button>
      )}
    </Card>
  );
};
