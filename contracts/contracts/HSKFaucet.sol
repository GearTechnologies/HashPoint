// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title HSKFaucet
 * @notice A simple native-HSK drip faucet for HashKey Chain testnet.
 *
 * - Anyone can call `claim()` to receive DRIP_AMOUNT of native HSK.
 * - Each address has a 24-hour cooldown between claims.
 * - The owner funds the faucet by sending HSK directly to this contract.
 * - The owner can withdraw at any time.
 *
 * Deploy once per testnet environment and fund with ~50 HSK.
 */
contract HSKFaucet is Ownable, ReentrancyGuard {
    /// @notice Amount of HSK (in wei) dispensed per claim.
    uint256 public dripAmount = 0.5 ether; // 0.5 HSK

    /// @notice Cooldown between claims per address (seconds).
    uint256 public cooldown = 24 hours;

    /// @notice Tracks the timestamp of each address's last claim.
    mapping(address => uint256) public lastClaim;

    event Claimed(address indexed recipient, uint256 amount);
    event Funded(address indexed funder, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event DripAmountUpdated(uint256 newAmount);
    event CooldownUpdated(uint256 newCooldown);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Accept HSK deposits (anyone can fund the faucet).
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /**
     * @notice Claim DRIP_AMOUNT HSK. Subject to 24-hour cooldown per address.
     */
    function claim() external nonReentrant {
        require(address(this).balance >= dripAmount, "Faucet empty");
        uint256 last = lastClaim[msg.sender];
        require(block.timestamp >= last + cooldown, "Cooldown active");

        lastClaim[msg.sender] = block.timestamp;

        (bool ok, ) = payable(msg.sender).call{value: dripAmount}("");
        require(ok, "Transfer failed");

        emit Claimed(msg.sender, dripAmount);
    }

    /// @notice Seconds until the caller can claim again (0 if ready).
    function timeUntilNextClaim(address user) external view returns (uint256) {
        uint256 last = lastClaim[user];
        if (last == 0) return 0;
        uint256 next = last + cooldown;
        if (block.timestamp >= next) return 0;
        return next - block.timestamp;
    }

    /// @notice Owner can update the drip amount.
    function setDripAmount(uint256 amount) external onlyOwner {
        require(amount > 0 && amount <= 10 ether, "Invalid amount");
        dripAmount = amount;
        emit DripAmountUpdated(amount);
    }

    /// @notice Owner can update the cooldown.
    function setCooldown(uint256 seconds_) external onlyOwner {
        require(seconds_ <= 7 days, "Cooldown too long");
        cooldown = seconds_;
        emit CooldownUpdated(seconds_);
    }

    /// @notice Owner can withdraw all HSK from the faucet.
    function withdraw() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "Nothing to withdraw");
        (bool ok, ) = payable(owner()).call{value: bal}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(owner(), bal);
    }

    /// @notice Convenience: current faucet balance in wei.
    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}
