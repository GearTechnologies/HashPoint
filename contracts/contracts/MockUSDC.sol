// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Test ERC-20 token mimicking USDC (6 decimals).
 * Only used for HashKey testnet deployments — do NOT deploy to mainnet.
 * The owner can mint freely; anyone can self-mint up to FAUCET_LIMIT per call
 * via `faucet()` to simplify testing.
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant _DECIMALS = 6;
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** 6; // 1 000 USDC
    uint256 public constant FAUCET_LIMIT = 100_000 * 10 ** 6; // 100 000 USDC max per address
    mapping(address => uint256) public faucetClaimed;

    event FaucetClaimed(address indexed recipient, uint256 amount);

    constructor(address initialOwner) ERC20("USD Coin (Test)", "USDC") Ownable(initialOwner) {
        // Mint 10 million USDC to the deployer for testing
        _mint(initialOwner, 10_000_000 * 10 ** _DECIMALS);
    }

    /// @notice Owner can mint arbitrary amounts.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Burn tokens from caller's balance.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @notice Public faucet — any address can claim FAUCET_AMOUNT USDC once
     * until their cumulative claims reach FAUCET_LIMIT.
     */
    function faucet() external {
        uint256 claimed = faucetClaimed[msg.sender];
        require(claimed + FAUCET_AMOUNT <= FAUCET_LIMIT, "Faucet limit reached");
        faucetClaimed[msg.sender] = claimed + FAUCET_AMOUNT;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Returns 6 to match the real USDC token.
    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }
}
