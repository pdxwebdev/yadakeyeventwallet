/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract PriceFeedAggregatorV3 is AggregatorV3Interface {
    uint8 public override decimals = 8;
    int256 public price;
    uint256 public timestamp;

    constructor(int256 _price) {
        price = _price;
        timestamp = block.timestamp;
    }

    function setPrice(int256 _price) external {
        price = _price;
        timestamp = block.timestamp;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, price, timestamp, timestamp, 1);
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, price, timestamp, timestamp, _roundId);
    }

    function description() external pure override returns (string memory) {
        return "Mock Price Feed";
    }

    function version() external pure override returns (uint256) {
        return 3;
    }
}