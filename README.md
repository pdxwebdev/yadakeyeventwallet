# Setup

Fork this repo first.

- `git clone git@github.com:yourusername/yadakeyeventwallet.git`
- `cd yadakeyeventwallet`
- `npm install`
- `npm run dev`

This will give YadaCoin functionality.

# To test BSC functionality

- `npm run refresh` - Only needs to run once unless you make changes to the smart contracts
- `npm run node` - This runs hardhat, your EVM blockchain emulator
- `node server.js` - This serves the smart contract deploy addresses to the react app

So at the end of this you should have 3 different terminals running these three processes:

- `npm run dev`
- `npm run node`
- `node server.js`
