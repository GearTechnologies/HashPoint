// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title HSPAdapter
 * @notice Wraps HashPoint settlement events into HSP-compatible message format.
 * HSP (HashKey Settlement Protocol) handles payment request/confirmation/receipt
 * lifecycle. This adapter emits HSP-structured events so that HSP infrastructure
 * can index and relay payment status.
 */
contract HSPAdapter is AccessControl {
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");

    // ─── Enums ──────────────────────────────────────────────────────────────────

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

    // ─── Structs ────────────────────────────────────────────────────────────────

    struct HSPMessage {
        bytes32 messageId;
        HSPMessageType msgType;
        address sender;
        address recipient;
        uint256 amount;
        address token;
        bytes32 paymentRef;
        uint256 timestamp;
        HSPStatus status;
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

    // ─── State ──────────────────────────────────────────────────────────────────

    mapping(bytes32 => HSPMessage) private _messages;
    mapping(bytes32 => HSPReceipt) private _receipts;

    // ─── Events ─────────────────────────────────────────────────────────────────

    event HSPMessageEmitted(
        bytes32 indexed messageId,
        HSPMessageType msgType,
        bytes payload
    );

    // ─── Constructor ────────────────────────────────────────────────────────────

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── Core ───────────────────────────────────────────────────────────────────

    /**
     * @notice Called by HashPointEscrow on every successful settlement.
     * Emits all three HSP message types atomically.
     */
    function onPaymentSettled(
        address merchant,
        address customer,
        address token,
        uint256 amount,
        bytes32 merchantRef,
        bytes32 nonce
    ) external onlyRole(ESCROW_ROLE) {
        bytes32 messageId = keccak256(
            abi.encodePacked(merchant, customer, nonce, block.number)
        );

        // 1. PAYMENT_REQUEST
        HSPMessage memory requestMsg = HSPMessage({
            messageId: messageId,
            msgType: HSPMessageType.PAYMENT_REQUEST,
            sender: customer,
            recipient: merchant,
            amount: amount,
            token: token,
            paymentRef: merchantRef,
            timestamp: block.timestamp,
            status: HSPStatus.PENDING
        });
        _messages[messageId] = requestMsg;
        emit HSPMessageEmitted(
            messageId,
            HSPMessageType.PAYMENT_REQUEST,
            _encodeMessage(requestMsg)
        );

        // 2. PAYMENT_CONFIRMATION
        HSPMessage memory confirmMsg = requestMsg;
        confirmMsg.msgType = HSPMessageType.PAYMENT_CONFIRMATION;
        confirmMsg.status = HSPStatus.CONFIRMED;
        emit HSPMessageEmitted(
            messageId,
            HSPMessageType.PAYMENT_CONFIRMATION,
            _encodeMessage(confirmMsg)
        );

        // 3. PAYMENT_RECEIPT
        HSPReceipt memory receipt = HSPReceipt({
            messageId: messageId,
            merchant: merchant,
            customer: customer,
            token: token,
            amount: amount,
            merchantRef: merchantRef,
            settledAt: block.timestamp,
            status: HSPStatus.CONFIRMED
        });
        _receipts[messageId] = receipt;

        // Update stored message to confirmed state
        _messages[messageId].status = HSPStatus.CONFIRMED;

        HSPMessage memory receiptMsg = confirmMsg;
        receiptMsg.msgType = HSPMessageType.PAYMENT_RECEIPT;
        emit HSPMessageEmitted(
            messageId,
            HSPMessageType.PAYMENT_RECEIPT,
            _encodeReceipt(receipt)
        );
    }

    // ─── Views ──────────────────────────────────────────────────────────────────

    /**
     * @notice Get the status of an HSP message.
     */
    function getMessageStatus(bytes32 messageId) external view returns (HSPStatus) {
        return _messages[messageId].status;
    }

    /**
     * @notice Get full HSP receipt for a message.
     */
    function getReceipt(bytes32 messageId) external view returns (HSPReceipt memory) {
        return _receipts[messageId];
    }

    /**
     * @notice Get full HSP message.
     */
    function getMessage(bytes32 messageId) external view returns (HSPMessage memory) {
        return _messages[messageId];
    }

    // ─── Internal ───────────────────────────────────────────────────────────────

    function _encodeMessage(HSPMessage memory msg_) internal pure returns (bytes memory) {
        return abi.encode(
            msg_.messageId,
            msg_.msgType,
            msg_.sender,
            msg_.recipient,
            msg_.amount,
            msg_.token,
            msg_.paymentRef,
            msg_.timestamp,
            msg_.status
        );
    }

    function _encodeReceipt(HSPReceipt memory receipt) internal pure returns (bytes memory) {
        return abi.encode(
            receipt.messageId,
            receipt.merchant,
            receipt.customer,
            receipt.token,
            receipt.amount,
            receipt.merchantRef,
            receipt.settledAt,
            receipt.status
        );
    }
}
