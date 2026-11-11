// SPDX-License-Identifier: YadaCoin Open Source License (YOSL) v1.1
pragma solidity 0.8.24;

interface IERC20Transfer {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract YadaUsdcPool {
    IERC20Transfer public immutable usdc;
    IERC20Transfer public immutable wyda;
    uint256 public reserveUsdc;
    uint256 public reserveWyda;

    constructor(address usdc_, address wyda_) {
        usdc = IERC20Transfer(usdc_);
        wyda = IERC20Transfer(wyda_);
    }

    function addLiquidity(uint256 usdcAmount, uint256 wydaAmount) external {
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "usdc");
        require(wyda.transferFrom(msg.sender, address(this), wydaAmount), "wyda");
        reserveUsdc += usdcAmount;
        reserveWyda += wydaAmount;
    }

    function swapUsdcForWyda(uint256 amountIn, uint256 minOut) external returns (uint256 amountOut) {
        require(amountIn > 0 && reserveUsdc > 0 && reserveWyda > 0, "empty");
        amountOut = (reserveWyda * amountIn) / (reserveUsdc + amountIn);
        require(amountOut >= minOut && amountOut < reserveWyda, "slippage");
        require(usdc.transferFrom(msg.sender, address(this), amountIn), "usdc");
        require(wyda.transfer(msg.sender, amountOut), "wyda");
        reserveUsdc += amountIn;
        reserveWyda -= amountOut;
    }
}
