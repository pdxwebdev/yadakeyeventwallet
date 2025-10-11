import React, { useState } from "react";
import {
  Button,
  Group,
  TextInput,
  Switch,
  Stack,
  Card,
  Text,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { ethers } from "ethers";
import { useAppContext } from "../../context/AppContext";
import { walletManagerFactory } from "../../blockchains/WalletManagerFactory";

const TokenPairsForm = ({ appContext, webcamRef, styles }) => {
  const { selectedBlockchain } = appContext;

  const walletManager = walletManagerFactory(selectedBlockchain.id);
  const [tokenPairs, setTokenPairs] = useState([]);
  const [loading, setLoading] = useState(false);

  const form = useForm({
    initialValues: {
      tokenPairs: [
        {
          tokenAddress: "",
          tokenName: "",
          tokenSymbol: "",
          isWrapped: false,
          wrappedAddress: ethers.ZeroAddress,
        },
      ],
    },
    validate: {
      tokenPairs: {
        tokenAddress: (value) =>
          ethers.isAddress(value) ? null : "Invalid Ethereum address",
        tokenName: (value) => (value.trim() ? null : "Token name is required"),
        tokenSymbol: (value) =>
          value.trim() ? null : "Token symbol is required",
      },
    },
  });

  const addTokenPair = () => {
    form.insertListItem("tokenPairs", {
      tokenAddress: "",
      tokenName: "",
      tokenSymbol: "",
      isWrapped: false,
      wrappedAddress: ethers.ZeroAddress,
    });
  };

  const removeTokenPair = (index) => {
    form.removeListItem("tokenPairs", index);
  };

  const handleSubmit = async (values) => {
    const formattedTokenPairs = values.tokenPairs.map((pair) => [
      pair.tokenAddress,
      pair.tokenName,
      pair.tokenSymbol,
      ethers.ZeroAddress,
    ]);

    setTokenPairs(formattedTokenPairs);
    await walletManager.addTokenPairs(
      appContext,
      webcamRef,
      formattedTokenPairs
    );
  };

  return (
    <Card withBorder mt="md" radius="md" p="md" style={styles.card}>
      <Title order={4} mb="md">
        Add token pairs
      </Title>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack mb="md">
          {form.values.tokenPairs.map((pair, index) => (
            <Group key={index} mt="xs">
              <TextInput
                label="Token Address"
                placeholder="0x..."
                {...form.getInputProps(`tokenPairs.${index}.tokenAddress`)}
              />
              <TextInput
                label="Token Name"
                placeholder="Token Name"
                {...form.getInputProps(`tokenPairs.${index}.tokenName`)}
              />
              <TextInput
                label="Token Symbol"
                placeholder="Symbol"
                {...form.getInputProps(`tokenPairs.${index}.tokenSymbol`)}
              />
              <Button
                color="red"
                onClick={() => removeTokenPair(index)}
                disabled={form.values.tokenPairs.length === 1}
              >
                Remove
              </Button>
            </Group>
          ))}
          <Group>
            <Button onClick={addTokenPair}>Add Token Pair</Button>
            <Button type="submit" loading={loading}>
              Submit
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
};

export default TokenPairsForm;
