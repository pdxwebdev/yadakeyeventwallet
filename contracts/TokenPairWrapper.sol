// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./WrappedToken.sol";
import "hardhat/console.sol";

interface IBridge {
    function addTokenPair(address originalToken, address wrappedToken, bool isCrossChain) external;
    function registerKeyWithTransfer(bytes memory pubKey, address publicKeyHash, address prerotatedKeyHash, address twicePrerotatedKeyHash, address prevPublicKeyHash, address outputAddress, bool hasRelationship) external payable;
    function owner() external view returns (address);
}

interface IKeyLogRegistry {
    function setAuthorizedCaller(address caller) external;
    function authorizedCaller() external view returns (address);
}

contract TokenPairWrapper is Ownable {
    IBridge public bridge;
    IKeyLogRegistry public keyLogRegistry;

    constructor(address _bridge, address _keyLogRegistry) Ownable(msg.sender) {
        bridge = IBridge(_bridge);
        keyLogRegistry = IKeyLogRegistry(_keyLogRegistry);
        console.log("TokenPairWrapper initialized with Bridge:", _bridge);
        console.log("TokenPairWrapper owner:", msg.sender);
        console.log("Bridge owner from constructor:", bridge.owner());
    }

    function addTokenPairAtomic(
        address originalToken,
        string memory tokenName,
        string memory tokenSymbol,
        bool isCrossChain,
        bytes calldata currentPubKey,
        address currentSigner,
        address nextSigner,
        address nextNextSigner,
        address prevSigner,
        bytes calldata nextPubKey,
        address nextNextNextSigner
    ) external payable onlyOwner {
        console.log("addTokenPairAtomic called by:", msg.sender);
        console.log("Bridge address:", address(bridge));
        console.log("Bridge owner:", bridge.owner());

        // Step 1: Authorize Bridge in KeyLogRegistry
        address currentAuthorized = keyLogRegistry.authorizedCaller();
        console.log("Current KeyLogRegistry authorized caller:", currentAuthorized);
        if (currentAuthorized != address(bridge)) {
            keyLogRegistry.setAuthorizedCaller(address(bridge));
            console.log("Set KeyLogRegistry authorized caller to:", address(bridge));
        }

        // Step 2: Deploy Wrapped Token
        WrappedToken wrappedToken = new WrappedToken(tokenName, tokenSymbol, address(bridge));
        address wrappedTokenAddr = address(wrappedToken);
        console.log("Deployed WrappedToken at:", wrappedTokenAddr);
        require(wrappedTokenAddr != address(0), "WrappedToken deployment failed");

        // Step 3: Add Token Pair to Bridge
        console.log("Calling addTokenPair with:");
        console.log("originalToken:", originalToken);
        console.log("wrappedToken:", wrappedTokenAddr);
        console.log("isCrossChain:", isCrossChain);
        bridge.addTokenPair(originalToken, wrappedTokenAddr, isCrossChain);
        console.log("addTokenPair succeeded");

        // Step 4: Register Current Key with ETH Transfer
        uint256 ethPerCall = msg.value / 2;
        console.log("Registering current key with ETH:", ethPerCall);
        bridge.registerKeyWithTransfer{value: ethPerCall}(
            currentPubKey,
            currentSigner,
            nextSigner,
            nextNextSigner,
            prevSigner,
            nextSigner,
            false
        );

        // Step 5: Rotate to Next Key with ETH Transfer
        console.log("Rotating to next key with ETH:", ethPerCall);
        bridge.registerKeyWithTransfer{value: ethPerCall}(
            nextPubKey,
            nextSigner,
            nextNextSigner,
            nextNextNextSigner,
            currentSigner,
            nextNextSigner,
            false
        );
    }

    function withdraw() external onlyOwner {
        payable(msg.sender).transfer(address(this).balance);
    }
}