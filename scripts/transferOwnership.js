const { ethers } = require("hardhat");

async function transferOwnership() {
  const [currentDeployer] = await ethers.getSigners(); // 0xf39Fd6e51aad...
  const newDeployerAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const bridgeAddress = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"; // Your existing proxy

  const Bridge = await ethers.getContractFactory("Bridge", currentDeployer);
  const bridge = await Bridge.attach(bridgeAddress);

  console.log("Current owner:", await bridge.owner());
  await bridge.transferOwnership(newDeployerAddress);
  console.log("Ownership transferred to:", newDeployerAddress);
  console.log("New owner:", await bridge.owner());
}

transferOwnership()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });