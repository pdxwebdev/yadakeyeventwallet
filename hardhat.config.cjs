require('@nomicfoundation/hardhat-ethers');
require('@openzeppelin/hardhat-upgrades');

const config = {
  solidity: {
    version: "0.8.24",
    defaultNetwork: "hardhat",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      gasPrice: 20000000000,
      accounts: {
        mnemonic: 'test test test test test test test test test test test junk',
        count: 10,
      },
      localhost: {
        url: "http://127.0.0.1:8545"
      },
    }
  }
};

module.exports = config;