/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Group,
  Text,
  Title,
  Badge,
} from "@mantine/core";
import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import { styles } from "../../shared/styles";
import {
  addresses,
  DEPLOY_ENV,
  localProvider,
  YADA_PRICE_MARKET_ABI,
} from "../../shared/constants";

const HARDHAT_FAUCET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
import AmountInput from "./AmountInput";

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

const formatTimeLeft = (endTime) => {
  const ms = Number(endTime) * 1000 - Date.now();
  if (ms <= 0) return "Ended";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
};

const winningLabel = (side) => {
  if (Number(side) === 1) return "Longs won";
  if (Number(side) === 2) return "Shorts won";
  if (Number(side) === 3) return "Refund";
  return "Open";
};

export const ShortForm = ({ appContext, walletManager }) => {
  const { parsedData, privateKey, selectedBlockchain } = appContext;
  const marketAddress = addresses.yadaPriceMarketAddress;

  const [side, setSide] = useState("short");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [settling, setSettling] = useState(false);
  const [spot, setSpot] = useState(null);
  const [roundId, setRoundId] = useState(0n);
  const [round, setRound] = useState(null);
  const [position, setPosition] = useState(null);
  const [payout, setPayout] = useState(0n);
  const [minting, setMinting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [chainNow, setChainNow] = useState(() => Math.floor(Date.now() / 1000));
  const isLocal = DEPLOY_ENV !== "mainnet" && DEPLOY_ENV !== "testnet";

  const getSigner = () => {
    if (!privateKey?.privateKey) return null;
    return new ethers.Wallet(
      ethers.hexlify(privateKey.privateKey),
      localProvider
    );
  };

  const getMarket = useCallback(
    (runner = localProvider) => {
      if (!marketAddress) return null;
      return new ethers.Contract(marketAddress, YADA_PRICE_MARKET_ABI, runner);
    },
    [marketAddress]
  );

  const load = useCallback(async () => {
    const market = getMarket();
    const user = parsedData?.publicKeyHash;
    if (!market) return;
    try {
      const [price, id, block] = await Promise.all([
        market.spotPrice(),
        market.currentRoundId(),
        localProvider.getBlock("latest"),
      ]);
      setSpot(price);
      setRoundId(id);
      if (block?.timestamp) setChainNow(Number(block.timestamp));
      if (id === 0n) {
        setRound(null);
        setPosition(null);
        setPayout(0n);
        return;
      }
      const nextRound = await market.getRound(id);
      setRound(nextRound);
      if (user) {
        const [nextPosition, nextPayout] = await Promise.all([
          market.getPosition(id, user),
          market.pendingPayout(id, user),
        ]);
        setPosition(nextPosition);
        setPayout(nextPayout);
      } else {
        setPosition(null);
        setPayout(0n);
      }
    } catch (e) {
      console.warn("Price market load failed:", e);
    }
  }, [getMarket, parsedData?.publicKeyHash]);

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
    const market = getMarket(signer);
    const stakeToken = await market.stakeToken();
    const erc20 = new ethers.Contract(
      stakeToken,
      [
        "function allowance(address owner, address spender) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)",
      ],
      signer
    );
    const owner = await signer.getAddress();
    const allowance = await erc20.allowance(owner, marketAddress);
    if (allowance >= amountWei) return;
    if (allowance > 0n) {
      await (await erc20.approve(marketAddress, 0n)).wait();
    }
    await (await erc20.approve(marketAddress, amountWei)).wait();
  };

  const mintTestUsdt = async () => {
    const user = parsedData?.publicKeyHash || (await getSigner()?.getAddress());
    const market = getMarket();
    if (!user || !market) return;
    setMinting(true);
    try {
      const userBal = await localProvider.getBalance(user);
      if (userBal < ethers.parseEther("1")) {
        await localProvider.send("hardhat_setBalance", [
          user,
          ethers.toBeHex(ethers.parseEther("10")),
        ]);
      }
      const stakeToken = await market.stakeToken();
      const data = new ethers.Interface([
        "function mint(address to, uint256 amount)",
      ]).encodeFunctionData("mint", [user, ethers.parseEther("1000")]);
      const hash = await localProvider.send("eth_sendTransaction", [
        { from: HARDHAT_FAUCET, to: stakeToken, data },
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

  const placeBet = async () => {
    const signer = getSigner();
    const market = getMarket(signer);
    if (!signer || !market || !amount) return;
    setLoading(true);
    try {
      const amountWei = ethers.parseUnits(amount, 18);
      await approveIfNeeded(signer, amountWei);
      const tx = await market.placeBet(side === "short", amountWei);
      await tx.wait();
      await refreshAfterTx();
      notifications.show({
        title: side === "short" ? "Short placed" : "Long placed",
        color: "green",
      });
      setAmount("");
    } catch (e) {
      notifications.show({
        title: "Bet failed",
        message: e.shortMessage || e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  const startNewRound = async () => {
    if (!marketAddress) return;
    setStarting(true);
    try {
      const data = new ethers.Interface([
        "function createRound(uint256 duration)",
      ]).encodeFunctionData("createRound", [7 * 24 * 60 * 60]);
      const hash = await localProvider.send("eth_sendTransaction", [
        { from: HARDHAT_FAUCET, to: marketAddress, data },
      ]);
      await localProvider.waitForTransaction(hash);
      await load();
      notifications.show({ title: "New round opened", color: "green" });
    } catch (e) {
      notifications.show({
        title: "Start round failed",
        message: e.shortMessage || e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setStarting(false);
    }
  };

  const settleRound = async () => {
    const signer = getSigner();
    const market = getMarket(signer);
    if (!signer || !market) return;
    setSettling(true);
    try {
      const tx = await market.settle();
      await tx.wait();
      await refreshAfterTx();
      notifications.show({ title: "Round settled", color: "green" });
    } catch (e) {
      notifications.show({
        title: "Settle failed",
        message: e.shortMessage || e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setSettling(false);
    }
  };

  const claimPayout = async () => {
    const signer = getSigner();
    const market = getMarket(signer);
    if (!signer || !market || !roundId) return;
    setClaiming(true);
    try {
      const tx = await market.claim(roundId);
      await tx.wait();
      await refreshAfterTx();
      notifications.show({ title: "Payout claimed", color: "green" });
    } catch (e) {
      notifications.show({
        title: "Claim failed",
        message: e.shortMessage || e.message || "Unknown error",
        color: "red",
      });
    } finally {
      setClaiming(false);
    }
  };

  if (selectedBlockchain.id !== "bsc") {
    return (
      <Text color="dimmed" align="center" mt="md">
        Shorts are only available on BSC.
      </Text>
    );
  }

  if (!marketAddress) {
    return (
      <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
        <Title order={4}>YDA prediction market</Title>
        <Text size="sm" c="dimmed" mt="sm">
          Price market is not deployed yet. After
          {` npx hardhat run scripts/deployYadaPriceMarket.js --network bscMainnet`}
          , set addresses.yadaPriceMarketAddress.
        </Text>
      </Card>
    );
  }

  const now = chainNow;
  const settled = Boolean(round?.settled ?? round?.[6]);
  const isOpen = round && !settled && Number(round.endTime) > now;
  const canSettle = round && !settled && Number(round.endTime) <= now;
  const canBet = isOpen && amount && parseFloat(amount) > 0;
  const userShort = position?.shortAmount ?? 0n;
  const userLong = position?.longAmount ?? 0n;

  return (
    <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
      <Group justify="space-between" align="flex-start">
        <Title order={4}>YDA prediction market</Title>
        {round ? (
          <Badge color={settled ? "gray" : isOpen ? "red" : "orange"}>
            {settled
              ? winningLabel(round.winningSide)
              : isOpen
              ? formatTimeLeft(round.endTime)
              : "Awaiting settle"}
          </Badge>
        ) : (
          <Badge color="gray">No round</Badge>
        )}
      </Group>

      <Text size="sm" c="dimmed" mt="xs">
        Stake USDT. Shorts win if WYDA/USDT settles below the strike.
      </Text>

      <Group mt="md" grow>
        <div>
          <Text size="xs" c="dimmed">
            Spot
          </Text>
          <Text fw={600}>{formatPrice(spot)} USDT</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Strike
          </Text>
          <Text fw={600}>
            {round ? `${formatPrice(round.strikePrice)} USDT` : "—"}
          </Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Short pot
          </Text>
          <Text fw={600}>
            {round ? `${formatUsdt(round.shortPot)} USDT` : "—"}
          </Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Long pot
          </Text>
          <Text fw={600}>
            {round ? `${formatUsdt(round.longPot)} USDT` : "—"}
          </Text>
        </div>
      </Group>

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

      <AmountInput
        mt="md"
        label="USDT stake"
        value={amount}
        onChange={(v) => setAmount(v?.toString() ?? "")}
        placeholder="0.0"
        min={0}
        decimalScale={18}
      />

      <Button
        mt="md"
        fullWidth
        color={side === "short" ? "red" : "teal"}
        onClick={placeBet}
        loading={loading}
        disabled={!canBet}
        leftSection={
          side === "short" ? (
            <IconTrendingDown size={16} />
          ) : (
            <IconTrendingUp size={16} />
          )
        }
      >
        {side === "short" ? "Short YDA" : "Long YDA"}
      </Button>

      {(userShort > 0n || userLong > 0n) && !position?.claimed && (
        <Text size="sm" mt="sm">
          Your position: {formatUsdt(userShort)} USDT short /{" "}
          {formatUsdt(userLong)} USDT long
        </Text>
      )}
      {position?.claimed && (
        <Text size="sm" mt="sm" c="dimmed">
          Claimed
        </Text>
      )}
      {isLocal && (
        <Button
          mt="sm"
          fullWidth
          variant="light"
          color="blue"
          onClick={startNewRound}
          loading={starting}
        >
          Start new round
        </Button>
      )}

      {canSettle && (
        <Button
          mt="sm"
          fullWidth
          variant="light"
          color="orange"
          onClick={settleRound}
          loading={settling}
        >
          Settle round
        </Button>
      )}

      {payout > 0n && (
        <Button
          mt="sm"
          fullWidth
          color="green"
          onClick={claimPayout}
          loading={claiming}
        >
          Claim {formatUsdt(payout)} USDT
        </Button>
      )}
    </Card>
  );
};
