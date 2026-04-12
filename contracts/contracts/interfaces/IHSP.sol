// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IHSP
 * @notice Interface for HSP (HashKey Settlement Protocol) adapter.
 */
interface IHSP {
    enum HSPMessageType {
        PAYMENT_REQUEST,
        PAYMENT_CONFIRMATION,
        PAYMENT_RECEIPT
    }

    enum HSPStatus {
        PENDING,
        CONFIRMED,
        FAILED
    }

    struct HSPReceipt {
        bytes32 messageId;
        address merchant;
        address customer;
        address token;
        uint256 amount;
        bytes32 merchantRef;
        uint256 settledAt;
        HSPStatus status;
    }

    event HSPMessageEmitted(
        bytes32 indexed messageId,
        HSPMessageType msgType,
        bytes payload
    );

    function onPaymentSettled(
        address merchant,
        address customer,
        address token,
        uint256 amount,
        bytes32 merchantRef,
        bytes32 nonce
    ) external;

    function getMessageStatus(bytes32 messageId) external view returns (HSPStatus);

    function getReceipt(bytes32 messageId) external view returns (HSPReceipt memory);
}
