import {
  Badge,
  Button,
  Group,
  TextInput,
  ActionIcon,
  Stack,
  FileButton,
  Text,
  Divider,
  Table,
  Anchor,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ethers } from "ethers";
import axios from "axios";
import React from "react";
import { IconTrash, IconUpload } from "@tabler/icons-react";
import AmountInput from "./AmountInput";
import { getP2PKH } from "../../utils/hdWallet";
import { BRIDGE_ABI, localProvider } from "../../shared/constants";

const WRAP_ADDRESS = "16U1gAmHazqqEkbRE9KFPShAperjJreMRA";
const WRAP_START_HEIGHT = 620273;
const BASE_BRIDGE_START_BLOCK = 56248238;
const LOG_SPAN = 90000;
const baseLogProvider = new ethers.JsonRpcProvider(
  "https://base.rpc.blxrbdn.com",
  8453,
  { staticNetwork: true }
);
const FULFILLED_KEY = "yadaWrapFulfilled";

const loadFulfilled = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FULFILLED_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

const saveFulfilled = (ids) => {
  localStorage.setItem(FULFILLED_KEY, JSON.stringify([...ids]));
};

const TokenManagementForm = ({
  walletManager,
  appContext,
  webcamRef,
  tokenSymbol,
  wrappedTokenSymbol,
  styles,
}) => {
  const { selectedToken } = appContext;

  const [mintEntries, setMintEntries] = React.useState([
    { id: "1", address: "", amount: "", yadaTxnId: "" },
  ]);
  const [wrapRequests, setWrapRequests] = React.useState([]);
  const [wrapLoading, setWrapLoading] = React.useState(false);
  const [unwrapRequests, setUnwrapRequests] = React.useState([]);
  const [unwrapLoading, setUnwrapLoading] = React.useState(false);

  const [burnEntries, setBurnEntries] = React.useState([
    { id: "1", address: "", amount: "" },
  ]);

  // Mint operations
  const addMintEntry = () => {
    setMintEntries([
      ...mintEntries,
      { id: Date.now().toString(), address: "", amount: "", yadaTxnId: "" },
    ]);
  };

  const removeMintEntry = (id) => {
    if (mintEntries.length > 1) {
      setMintEntries(mintEntries.filter((e) => e.id !== id));
    }
  };

  const updateMintEntry = (id, field, value) => {
    setMintEntries(
      mintEntries.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const handleMintCsvImport = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);
      const newEntries = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(",");
        if (parts.length < 2) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid line ${i + 1}: expected "address,amount"`,
            color: "red",
          });
          return;
        }

        let address = parts[0].trim().replace(/^["']|["']$/g, "");
        let amount = parts[1].trim().replace(/^["']|["']$/g, "");

        if (!ethers.isAddress(address)) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid address on line ${i + 1}: ${address}`,
            color: "red",
          });
          return;
        }

        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid amount on line ${i + 1}: ${amount}`,
            color: "red",
          });
          return;
        }

        newEntries.push({
          id: Date.now().toString() + i,
          address,
          amount,
          yadaTxnId: "",
        });
      }

      if (newEntries.length === 0) {
        notifications.show({
          title: "CSV Error",
          message: "No valid entries found in CSV",
          color: "red",
        });
        return;
      }

      setMintEntries(newEntries);
      notifications.show({
        title: "Success",
        message: `Imported ${newEntries.length} recipients from CSV`,
        color: "green",
      });
    };

    reader.readAsText(file);
  };

  const loadWrapRequests = async () => {
    setWrapLoading(true);
    try {
      const res = await axios.get(
        `${import.meta.env.VITE_API_URL}/explorer-search?term=${WRAP_ADDRESS}`
      );
      const blocks = Array.isArray(res.data?.result) ? res.data.result : [];
      const fulfilled = loadFulfilled();
      const requests = [];
      for (const block of blocks) {
        if (Number(block.index) < WRAP_START_HEIGHT) continue;
        for (const txn of block.transactions || []) {
          let senderAddress = "";
          try {
            senderAddress = getP2PKH(Buffer.from(txn.public_key, "hex"));
          } catch {
            senderAddress = "";
          }
          if (senderAddress === WRAP_ADDRESS) continue;
          const paid = (txn.outputs || []).find(
            (output) =>
              output.to === WRAP_ADDRESS && Number(output.value) > 0
          );
          if (!paid) continue;
          if (!ethers.isAddress(txn.relationship || "")) continue;
          requests.push({
            id: txn.id,
            block: block.index,
            destination: txn.relationship,
            amount: String(paid.value),
            fulfilled: fulfilled.has(txn.id),
          });
        }
      }
      const bridgeAddress = appContext.contractAddresses?.bridgeAddress;
      if (bridgeAddress) {
        const bridge = new ethers.Contract(
          bridgeAddress,
          ["function isYadaWrapFulfilled(string) view returns (bool)"],
          localProvider
        );
        await Promise.all(
          requests.map(async (request) => {
            try {
              if (await bridge.isYadaWrapFulfilled(request.id)) {
                request.fulfilled = true;
                fulfilled.add(request.id);
              }
            } catch {
              // current bridge has no fulfillment record yet
            }
          })
        );
        saveFulfilled(fulfilled);
      }
      setWrapRequests(requests);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to load wrap requests",
        color: "red",
      });
    } finally {
      setWrapLoading(false);
    }
  };

  const loadUnwrapRequests = async () => {
    setUnwrapLoading(true);
    try {
      const bridgeAddress = appContext.contractAddresses?.bridgeAddress;
      if (!bridgeAddress) {
        setUnwrapRequests([]);
        return;
      }
      const network = await localProvider.getNetwork();
      const chainId = Number(network.chainId);
      const explorer =
        chainId === 56 ? "https://bscscan.com" : "https://basescan.org";
      const logProvider = chainId === 8453 ? baseLogProvider : localProvider;
      const latest = await logProvider.getBlockNumber();
      const start =
        chainId === 8453 ? BASE_BRIDGE_START_BLOCK : Math.max(0, latest - 200000);
      const bridge = new ethers.Contract(bridgeAddress, BRIDGE_ABI, logProvider);
      const filter = bridge.filters.BurnForYadaCoinWithdrawal();
      const logs = [];
      for (let from = start; from <= latest; from += LOG_SPAN) {
        const to = Math.min(from + LOG_SPAN - 1, latest);
        logs.push(...(await bridge.queryFilter(filter, from, to)));
      }
      setUnwrapRequests(
        logs
          .map((log) => ({
            id: `${log.transactionHash}-${log.index}`,
            txHash: log.transactionHash,
            explorer: `${explorer}/tx/${log.transactionHash}`,
            destination: log.args.bitcoinAddress,
            amount: ethers.formatUnits(log.args.amount, 18),
          }))
          .reverse()
      );
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to load unwrap requests",
        color: "red",
      });
    } finally {
      setUnwrapLoading(false);
    }
  };

  React.useEffect(() => {
    loadWrapRequests();
    loadUnwrapRequests();
  }, []);

  const handleMint = async () => {
    const validEntries = mintEntries.filter(
      (e) =>
        ethers.isAddress(e.address) &&
        e.amount &&
        !isNaN(parseFloat(e.amount)) &&
        parseFloat(e.amount) > 0
    );

    if (validEntries.length === 0) {
      notifications.show({
        title: "Error",
        message: "At least one valid recipient and amount is required",
        color: "red",
      });
      return;
    }

    try {
      await walletManager.mintTokens(
        appContext,
        webcamRef,
        selectedToken,
        validEntries
      );

      notifications.show({
        title: "Success",
        message: `Successfully minted to ${validEntries.length} recipient(s) in one transaction!`,
        color: "green",
      });

      const fulfilled = loadFulfilled();
      validEntries.forEach((entry) => {
        if (entry.yadaTxnId) fulfilled.add(entry.yadaTxnId);
      });
      saveFulfilled(fulfilled);
      setMintEntries([{ id: "1", address: "", amount: "", yadaTxnId: "" }]);
      await loadWrapRequests();
      await walletManager.fetchBalance(appContext);
      await walletManager.buildTransactionHistory(appContext);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to mint tokens",
        color: "red",
      });
    }
  };

  // Burn operations
  const addBurnEntry = () => {
    setBurnEntries([
      ...burnEntries,
      { id: Date.now().toString(), address: "", amount: "" },
    ]);
  };

  const removeBurnEntry = (id) => {
    if (burnEntries.length > 1) {
      setBurnEntries(burnEntries.filter((e) => e.id !== id));
    }
  };

  const updateBurnEntry = (id, field, value) => {
    setBurnEntries(
      burnEntries.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const handleBurnCsvImport = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/);
      const newEntries = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(",");
        if (parts.length < 2) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid line ${i + 1}: expected "address,amount"`,
            color: "red",
          });
          return;
        }

        let address = parts[0].trim().replace(/^["']|["']$/g, "");
        let amount = parts[1].trim().replace(/^["']|["']$/g, "");

        if (!ethers.isAddress(address)) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid address on line ${i + 1}: ${address}`,
            color: "red",
          });
          return;
        }

        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          notifications.show({
            title: "CSV Error",
            message: `Invalid amount on line ${i + 1}: ${amount}`,
            color: "red",
          });
          return;
        }

        newEntries.push({
          id: Date.now().toString() + i,
          address,
          amount,
        });
      }

      if (newEntries.length === 0) {
        notifications.show({
          title: "CSV Error",
          message: "No valid entries found in CSV",
          color: "red",
        });
        return;
      }

      setBurnEntries(newEntries);
      notifications.show({
        title: "Success",
        message: `Imported ${newEntries.length} accounts from CSV`,
        color: "green",
      });
    };

    reader.readAsText(file);
  };

  const handleBurn = async () => {
    const validEntries = burnEntries.filter(
      (e) =>
        ethers.isAddress(e.address) &&
        e.amount &&
        !isNaN(parseFloat(e.amount)) &&
        parseFloat(e.amount) > 0
    );

    if (validEntries.length === 0) {
      notifications.show({
        title: "Error",
        message: "At least one valid account and amount is required",
        color: "red",
      });
      return;
    }

    try {
      await walletManager.burnTokens(
        appContext,
        webcamRef,
        selectedToken,
        validEntries
      );

      notifications.show({
        title: "Success",
        message: `Successfully burned from ${validEntries.length} account(s) in one transaction!`,
        color: "green",
      });

      setBurnEntries([{ id: "1", address: "", amount: "" }]);
      await walletManager.fetchBalance(appContext);
      await walletManager.buildTransactionHistory(appContext);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to burn tokens",
        color: "red",
      });
    }
  };

  const isMintDisabled =
    !selectedToken ||
    mintEntries.every(
      (e) => !e.address || !e.amount || parseFloat(e.amount || "0") <= 0
    );

  const isBurnDisabled =
    !selectedToken ||
    burnEntries.every(
      (e) => !e.address || !e.amount || parseFloat(e.amount || "0") <= 0
    );

  return (
    <Stack gap="lg">
      {/* Mint Section */}
      <div>
        <Text size="sm" fw={500} mb="md">
          YadaCoin wrap requests
        </Text>
        <Group justify="space-between" mb="sm">
          <Text size="xs" c="dimmed">
            Deposits to {WRAP_ADDRESS} from block {WRAP_START_HEIGHT}. The explorer returns the latest blocks that touch this address.
          </Text>
          <Button variant="outline" onClick={loadWrapRequests} loading={wrapLoading}>
            Refresh
          </Button>
        </Group>
        <Table striped highlightOnHover mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Txn</Table.Th>
              <Table.Th>Destination</Table.Th>
              <Table.Th>Amount</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {wrapRequests.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text size="sm" c="dimmed">
                    {wrapLoading ? "Loading..." : "No wrap requests in range"}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              wrapRequests.map((request) => (
                <Table.Tr key={request.id}>
                  <Table.Td>
                    <Anchor
                      href={`${import.meta.env.VITE_API_URL}/explorer?term=${encodeURIComponent(request.id)}`}
                      target="_blank"
                      size="sm"
                    >
                      {request.id.slice(0, 12)}...
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{request.destination}</Text>
                  </Table.Td>
                  <Table.Td>{request.amount}</Table.Td>
                  <Table.Td>
                    <Badge color={request.fulfilled ? "green" : "yellow"}>
                      {request.fulfilled ? "Fulfilled" : "Pending"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      disabled={request.fulfilled}
                      onClick={() =>
                        setMintEntries([
                          {
                            id: request.id,
                            address: request.destination,
                            amount: request.amount,
                            yadaTxnId: request.id,
                          },
                        ])
                      }
                    >
                      Mint
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
        <Text size="sm" fw={500} mb="md">
          Pending unwrap requests
        </Text>
        <Group justify="space-between" mb="sm">
          <Text size="xs" c="dimmed">
            Bridge unwraps. The wrapped tokens are already burned. Send the amount to the YadaCoin address.
          </Text>
          <Button variant="outline" onClick={loadUnwrapRequests} loading={unwrapLoading}>
            Refresh
          </Button>
        </Group>
        <Table striped highlightOnHover mb="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Txn</Table.Th>
              <Table.Th>Destination</Table.Th>
              <Table.Th>Amount</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {unwrapRequests.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={3}>
                  <Text size="sm" c="dimmed">
                    {unwrapLoading ? "Loading..." : "No unwrap requests"}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              unwrapRequests.map((request) => (
                <Table.Tr key={request.id}>
                  <Table.Td>
                    <Anchor href={request.explorer} target="_blank" size="sm">
                      {request.txHash.slice(0, 12)}...
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{request.destination}</Text>
                  </Table.Td>
                  <Table.Td>{request.amount}</Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
        <Text size="sm" fw={500} mb="md">
          Mint Tokens
        </Text>
        <Stack gap="sm">
          {mintEntries.map((entry, index) => (
            <Group key={entry.id} align="flex-end">
              <TextInput
                label={index === 0 ? "Recipient Address" : ""}
                placeholder="Enter recipient address"
                value={entry.address}
                onChange={(e) =>
                  updateMintEntry(entry.id, "address", e.currentTarget.value)
                }
                error={entry.address !== "" && !ethers.isAddress(entry.address)}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              <AmountInput
                label={index === 0 ? `Amount (${wrappedTokenSymbol})` : ""}
                placeholder="Amount to mint"
                value={entry.amount}
                onChange={(value) =>
                  updateMintEntry(
                    entry.id,
                    "amount",
                    value === undefined ? "" : value.toString()
                  )
                }
                decimalScale={18}
                disabled={!selectedToken}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              {mintEntries.length > 1 && (
                <ActionIcon
                  color="red"
                  variant="subtle"
                  onClick={() => removeMintEntry(entry.id)}
                  mb="sm"
                >
                  <IconTrash size={20} />
                </ActionIcon>
              )}
            </Group>
          ))}

          <Group justify="space-between">
            <Group>
              <Button variant="outline" onClick={addMintEntry}>
                Add Recipient
              </Button>
              <FileButton onChange={handleMintCsvImport} accept=".csv,text/csv">
                {(props) => (
                  <Button
                    {...props}
                    leftSection={<IconUpload size={16} />}
                    variant="outline"
                  >
                    Import CSV
                  </Button>
                )}
              </FileButton>
            </Group>
            <Button onClick={handleMint} disabled={isMintDisabled}>
              Mint Tokens
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            CSV format: address,amount (one per line). Header row optional.
          </Text>
        </Stack>
      </div>

      <Divider />

      {/* Burn Section */}
      <div>
        <Text size="sm" fw={500} mb="md">
          Burn Tokens
        </Text>
        <Stack gap="sm">
          {burnEntries.map((entry, index) => (
            <Group key={entry.id} align="flex-end">
              <TextInput
                label={index === 0 ? "Account Address" : ""}
                placeholder="Enter account address"
                value={entry.address}
                onChange={(e) =>
                  updateBurnEntry(entry.id, "address", e.currentTarget.value)
                }
                error={entry.address !== "" && !ethers.isAddress(entry.address)}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              <AmountInput
                label={index === 0 ? `Amount (${wrappedTokenSymbol})` : ""}
                placeholder="Amount to burn"
                value={entry.amount}
                onChange={(value) =>
                  updateBurnEntry(
                    entry.id,
                    "amount",
                    value === undefined ? "" : value.toString()
                  )
                }
                decimalScale={18}
                disabled={!selectedToken}
                style={{ flex: 1 }}
                styles={styles.input}
              />
              {burnEntries.length > 1 && (
                <ActionIcon
                  color="red"
                  variant="subtle"
                  onClick={() => removeBurnEntry(entry.id)}
                  mb="sm"
                >
                  <IconTrash size={20} />
                </ActionIcon>
              )}
            </Group>
          ))}

          <Group justify="space-between">
            <Group>
              <Button variant="outline" onClick={addBurnEntry}>
                Add Account
              </Button>
              <FileButton onChange={handleBurnCsvImport} accept=".csv,text/csv">
                {(props) => (
                  <Button
                    {...props}
                    leftSection={<IconUpload size={16} />}
                    variant="outline"
                  >
                    Import CSV
                  </Button>
                )}
              </FileButton>
            </Group>
            <Button onClick={handleBurn} disabled={isBurnDisabled} color="red">
              Burn Tokens
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            CSV format: address,amount (one per line). Header row optional.
          </Text>
        </Stack>
      </div>
    </Stack>
  );
};

// Export legacy names for backward compatibility
const MintForm = TokenManagementForm;
const BurnForm = TokenManagementForm;

export { TokenManagementForm, MintForm, BurnForm };
