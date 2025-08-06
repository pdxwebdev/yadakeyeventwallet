/*
SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.
This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.
For commercial license inquiries, contact: info@yadacoin.io
Full license terms: see LICENSE.txt in this repository.
*/

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./WrappedToken.sol";
import "hardhat/console.sol";

interface IBridge {
    function addTokenPair(address originalToken, address wrappedToken, bool isCrossChain) external;
    function registerKeyPairWithTransfer(
        WrapParams calldata unconfirmed,
        WrapParams calldata confirming
    ) external payable;
    function owner() external view returns (address);
}

interface IKeyLogRegistry {
    function setAuthorizedCaller(address caller) external;
    function authorizedCaller() external view returns (address);
    function owner() external view returns (address);
}

struct PermitData {
    address token;
    uint256 amount;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
    address recipient;
}

struct WrapParams {
    uint256 amount;
    bytes signature;
    bytes publicKey;
    address prerotatedKeyHash;
    address twicePrerotatedKeyHash;
    address prevPublicKeyHash;
    address outputAddress;
    bool hasRelationship;
    address tokenSource;
    PermitData[] permits;
}

contract TokenPairWrapper is Ownable {
    IBridge public bridge;
    IKeyLogRegistry public keyLogRegistry;

    constructor(address _bridge, address _keyLogRegistry) Ownable(msg.sender) {
        bridge = IBridge(_bridge);
        keyLogRegistry = IKeyLogRegistry(_keyLogRegistry);
        console.log("TokenPairWrapper initialized with Bridge:", _bridge);
        console.log("TokenPairWrapper initialized with KeyLogRegistry:", _keyLogRegistry);
        console.log("TokenPairWrapper owner:", msg.sender);
        console.log("Bridge owner from constructor:", bridge.owner());
        console.log("KeyLogRegistry owner from constructor:", keyLogRegistry.owner());
    }

    struct TokenPair {
        address originalToken;
        string tokenName;
        string tokenSymbol;
        bool isCrossChain;
        address wrappedToken;
    }

    function addMultipleTokenPairsAtomic(
        TokenPair[] calldata tokenPairs,
        bytes calldata currentPubKey,
        address currentSigner,
        address nextSigner,
        address nextNextSigner,
        address prevSigner,
        bytes calldata nextPubKey,
        address nextNextNextSigner
    ) external payable onlyOwner {
        console.log("addMultipleTokenPairsAtomic called by:", msg.sender);
        console.log("Bridge address:", address(bridge));
        console.log("Bridge owner:", bridge.owner());
        console.log("KeyLogRegistry address:", address(keyLogRegistry));
        console.log("KeyLogRegistry owner:", keyLogRegistry.owner());

        // Step 1: Authorize Bridge in KeyLogRegistry
        address currentAuthorized = keyLogRegistry.authorizedCaller();
        console.log("Current KeyLogRegistry authorized caller:", currentAuthorized);
        if (currentAuthorized != address(bridge)) {
            keyLogRegistry.setAuthorizedCaller(address(bridge));
            console.log("Set KeyLogRegistry authorized caller to:", address(bridge));
            console.log("Verified KeyLogRegistry authorized caller:", keyLogRegistry.authorizedCaller());
        }

        // Step 2: Deploy WrappedToken and add token pairs
        address[] memory wrappedTokenAddresses = new address[](tokenPairs.length);
        for (uint256 i = 0; i < tokenPairs.length; i++) {
            TokenPair memory pair = tokenPairs[i];
            address wrappedTokenAddr;
            if (pair.wrappedToken == address(0)) {
                console.log("Deploying WrappedToken for originalToken:", pair.originalToken);
                WrappedToken wrappedToken = new WrappedToken(
                    pair.tokenName,
                    pair.tokenSymbol,
                    address(bridge),
                    address(keyLogRegistry)
                );
                wrappedTokenAddr = address(wrappedToken);
                console.log("Deployed WrappedToken at:", wrappedTokenAddr);
                require(wrappedTokenAddr != address(0), "WrappedToken deployment failed");
            } else {
                wrappedTokenAddr = pair.wrappedToken;
                console.log("Using pre-deployed WrappedToken at:", wrappedTokenAddr);
            }

            // Step 3: Add Token Pair to Bridge
            console.log("Calling addTokenPair with:");
            console.log("originalToken:", pair.originalToken);
            console.log("wrappedToken:", wrappedTokenAddr);
            console.log("isCrossChain:", pair.isCrossChain);
            bridge.addTokenPair(pair.originalToken, wrappedTokenAddr, pair.isCrossChain);
            console.log("addTokenPair succeeded for pair:", i);
            wrappedTokenAddresses[i] = wrappedTokenAddr;
        }

        // Step 4: Register key pair with transfer
        console.log("Registering key pair with ETH:", msg.value);
        WrapParams memory unconfirmed = WrapParams({
            amount: 0,
            signature: new bytes(0),
            publicKey: currentPubKey,
            prerotatedKeyHash: nextSigner,
            twicePrerotatedKeyHash: nextNextSigner,
            prevPublicKeyHash: prevSigner,
            outputAddress: nextSigner,
            hasRelationship: false,
            tokenSource: address(0),
            permits: new PermitData[](0)
        });
        WrapParams memory confirming = WrapParams({
            amount: 0,
            signature: new bytes(0),
            publicKey: nextPubKey,
            prerotatedKeyHash: nextNextSigner,
            twicePrerotatedKeyHash: nextNextNextSigner,
            prevPublicKeyHash: currentSigner,
            outputAddress: nextNextSigner,
            hasRelationship: false,
            tokenSource: address(0),
            permits: new PermitData[](0)
        });
        console.log("Registering key pair: currentSigner=%s, nextSigner=%s", currentSigner, nextSigner);
        bridge.registerKeyPairWithTransfer{value: msg.value}(unconfirmed, confirming);
        console.log("Key pair registration succeeded");

        console.log("All token pairs added successfully");
    }

    function withdraw() external onlyOwner {
        payable(msg.sender).transfer(address(this).balance);
    }
}