// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IHashPointEscrow
 * @notice Interface for the HashPoint escrow and settlement contract.
 */
interface IHashPointEscrow {
    struct PaymentIntent {
        address merchant;
        address customer;
        address token;
        uint256 amount;
        uint256 sessionId;
        bytes32 nonce;
        uint256 expiry;
        bytes32 merchantRef;
        uint256 chainId;
    }

    event PaymentSettled(
        address indexed merchant,
        address indexed customer,
        address token,
        uint256 amount,
        bytes32 merchantRef,
        uint256 sessionId,
        bytes32 nonce
    );

    event BatchSettled(
        address indexed merchant,
        uint256 count,
        uint256 totalAmount,
        address token
    );

    event PaymentFailed(bytes32 indexed intentHash, string reason);

    function settlePayment(
        PaymentIntent calldata intent,
        bytes calldata sig,
        bytes32[] calldata merkleProof
    ) external payable;

    function settleBatch(
        PaymentIntent[] calldata intents,
        bytes[] calldata sigs,
        bytes32[][] calldata merkleProofs
    ) external payable;

    function feeBps() external view returns (uint256);

    function feeRecipient() external view returns (address);
}
