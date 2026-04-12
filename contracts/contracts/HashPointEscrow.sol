// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {NonceRegistry} from "./NonceRegistry.sol";
import {HSPAdapter} from "./HSPAdapter.sol";
import {MerchantRegistry} from "./MerchantRegistry.sol";

/**
 * @title HashPointEscrow
 * @notice Core escrow and settlement contract for HashPoint offline payments.
 *
 * FLOW:
 * 1. Merchant calls openSession() on NonceRegistry to commit nonce Merkle root
 * 2. Customer signs a PaymentIntent offline (EIP-712 typed data)
 * 3. When connectivity returns, merchant (or relay) calls settlePayment() or settleBatch()
 * 4. Contract verifies signature, checks nonce, transfers funds, emits HSP event
 */
contract HashPointEscrow is EIP712, ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ─── Structs ────────────────────────────────────────────────────────────────

    struct PaymentIntent {
        address merchant;
        address customer;
        address token;        // address(0) for native HSK
        uint256 amount;
        uint256 sessionId;
        bytes32 nonce;
        uint256 expiry;
        bytes32 merchantRef;
        uint256 chainId;
    }

    // ─── State ──────────────────────────────────────────────────────────────────

    NonceRegistry public immutable nonceRegistry;
    MerchantRegistry public immutable merchantRegistry;
    HSPAdapter public immutable hspAdapter;

    address public feeRecipient;
    uint256 public feeBps; // basis points, default 10 = 0.1%

    // Emergency withdrawal timelock
    uint256 public constant WITHDRAWAL_TIMELOCK = 72 hours;
    uint256 public withdrawalRequestTime;
    address public withdrawalToken;
    uint256 public withdrawalAmount;

    bytes32 private constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(address merchant,address customer,address token,uint256 amount,"
        "uint256 sessionId,bytes32 nonce,uint256 expiry,bytes32 merchantRef,uint256 chainId)"
    );

    // ─── Events ─────────────────────────────────────────────────────────────────

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
    event FeeRecipientUpdated(address indexed newRecipient);
    event FeeBpsUpdated(uint256 newFeeBps);
    event WithdrawalRequested(address token, uint256 amount, uint256 unlockTime);
    event WithdrawalExecuted(address token, uint256 amount);

    // ─── Errors ─────────────────────────────────────────────────────────────────

    error IntentExpired();
    error InvalidSignature();
    error WrongChainId();
    error TimelockNotExpired();
    error NoPendingWithdrawal();
    error InvalidFeeBps();
    error NativeTransferFailed();
    error AmountMismatch();

    // ─── Constructor ────────────────────────────────────────────────────────────

    constructor(
        address _nonceRegistry,
        address _merchantRegistry,
        address _hspAdapter,
        address _feeRecipient,
        uint256 _feeBps
    ) EIP712("HashPoint", "1") Ownable(msg.sender) {
        require(_nonceRegistry != address(0), "Invalid nonceRegistry");
        require(_merchantRegistry != address(0), "Invalid merchantRegistry");
        require(_hspAdapter != address(0), "Invalid hspAdapter");
        require(_feeRecipient != address(0), "Invalid feeRecipient");
        require(_feeBps <= 1000, "Fee too high"); // max 10%

        nonceRegistry = NonceRegistry(_nonceRegistry);
        merchantRegistry = MerchantRegistry(_merchantRegistry);
        hspAdapter = HSPAdapter(_hspAdapter);
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
    }

    // ─── Settlement ─────────────────────────────────────────────────────────────

    /**
     * @notice Settle a single payment intent.
     * @param intent The payment intent struct
     * @param sig EIP-712 signature from the customer
     * @param merkleProof Merkle proof that nonce is valid for the session
     */
    function settlePayment(
        PaymentIntent calldata intent,
        bytes calldata sig,
        bytes32[] calldata merkleProof
    ) external payable nonReentrant whenNotPaused {
        _settleOne(intent, sig, merkleProof);
    }

    /**
     * @notice Settle a batch of payment intents.
     * Failed intents are skipped (not reverted) with a PaymentFailed event.
     * @param intents Array of payment intents
     * @param sigs Corresponding EIP-712 signatures
     * @param merkleProofs Corresponding Merkle proofs
     */
    function settleBatch(
        PaymentIntent[] calldata intents,
        bytes[] calldata sigs,
        bytes32[][] calldata merkleProofs
    ) external payable nonReentrant whenNotPaused {
        require(
            intents.length == sigs.length && intents.length == merkleProofs.length,
            "Length mismatch"
        );

        // Validate that msg.value exactly equals the total native amount across all intents.
        // This prevents excess ETH from becoming locked in the contract.
        uint256 expectedNative;
        for (uint256 i = 0; i < intents.length; i++) {
            if (intents[i].token == address(0)) {
                expectedNative += intents[i].amount;
            }
        }
        require(msg.value == expectedNative, "msg.value must equal total native token amount across all intents");

        // Track per-merchant totals for BatchSettled events
        uint256 successCount;
        uint256 totalNative;
        // We assume single-merchant batches for the BatchSettled aggregate event;
        // multi-merchant batches still emit individual PaymentSettled events.
        address batchMerchant = intents.length > 0 ? intents[0].merchant : address(0);
        address batchToken = intents.length > 0 ? intents[0].token : address(0);
        uint256 batchTotal;

        for (uint256 i = 0; i < intents.length; i++) {
            bytes32 intentHash = _hashIntent(intents[i]);
            uint256 nativeValue = intents[i].token == address(0) ? intents[i].amount : 0;
            try this.settlePaymentInternal{value: nativeValue}(intents[i], sigs[i], merkleProofs[i]) {
                if (intents[i].token == address(0)) {
                    totalNative += intents[i].amount;
                }
                if (intents[i].merchant == batchMerchant && intents[i].token == batchToken) {
                    batchTotal += intents[i].amount;
                }
                successCount++;
            } catch Error(string memory reason) {
                emit PaymentFailed(intentHash, reason);
            } catch (bytes memory) {
                emit PaymentFailed(intentHash, "Unknown error");
            }
        }

        if (successCount > 0 && batchMerchant != address(0)) {
            emit BatchSettled(batchMerchant, successCount, batchTotal, batchToken);
        }

        // Refund any ETH from failed native intents back to the caller
        uint256 unspent = expectedNative - totalNative;
        if (unspent > 0) {
            _transferNative(msg.sender, unspent);
        }
    }

    /**
     * @notice Internal settlement callable only via this contract (for try/catch in batch).
     */
    function settlePaymentInternal(
        PaymentIntent calldata intent,
        bytes calldata sig,
        bytes32[] calldata merkleProof
    ) external payable {
        require(msg.sender == address(this), "Only self");
        _settleOne(intent, sig, merkleProof);
    }

    // ─── Internal ───────────────────────────────────────────────────────────────

    function _settleOne(
        PaymentIntent calldata intent,
        bytes calldata sig,
        bytes32[] calldata merkleProof
    ) internal {
        // Chain ID check
        if (intent.chainId != block.chainid) revert WrongChainId();

        // Expiry check
        if (block.timestamp > intent.expiry) revert IntentExpired();

        // Signature verification — use tryRecover to handle malformed signatures gracefully
        bytes32 structHash = _hashIntent(intent);
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(structHash, sig);
        if (err != ECDSA.RecoverError.NoError || signer == address(0) || signer != intent.customer) revert InvalidSignature();

        // Nonce spend (also verifies session active + nonce validity)
        nonceRegistry.spendNonce(intent.merchant, intent.sessionId, intent.nonce, merkleProof);

        // Compute fee
        uint256 fee = (intent.amount * feeBps) / 10000;
        uint256 merchantAmount = intent.amount - fee;

        // Transfer funds
        if (intent.token == address(0)) {
            // Native HSK
            if (msg.value < intent.amount) revert AmountMismatch();
            _transferNative(intent.merchant, merchantAmount);
            if (fee > 0) _transferNative(feeRecipient, fee);
        } else {
            IERC20(intent.token).safeTransferFrom(intent.customer, intent.merchant, merchantAmount);
            if (fee > 0) {
                IERC20(intent.token).safeTransferFrom(intent.customer, feeRecipient, fee);
            }
        }

        // Notify HSP adapter
        hspAdapter.onPaymentSettled(
            intent.merchant,
            intent.customer,
            intent.token,
            intent.amount,
            intent.merchantRef,
            intent.nonce
        );

        // Update merchant stats
        merchantRegistry.recordPayment(intent.merchant, intent.token, intent.amount);

        emit PaymentSettled(
            intent.merchant,
            intent.customer,
            intent.token,
            intent.amount,
            intent.merchantRef,
            intent.sessionId,
            intent.nonce
        );
    }

    function _hashIntent(PaymentIntent calldata intent) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_INTENT_TYPEHASH,
                    intent.merchant,
                    intent.customer,
                    intent.token,
                    intent.amount,
                    intent.sessionId,
                    intent.nonce,
                    intent.expiry,
                    intent.merchantRef,
                    intent.chainId
                )
            )
        );
    }

    function _transferNative(address to, uint256 amount) internal {
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }

    // ─── Admin ──────────────────────────────────────────────────────────────────

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "Invalid address");
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(_feeRecipient);
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        if (_feeBps > 1000) revert InvalidFeeBps(); // max 10%
        feeBps = _feeBps;
        emit FeeBpsUpdated(_feeBps);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Emergency Withdrawal (72h timelock) ────────────────────────────────────

    /**
     * @notice Request an emergency withdrawal. Starts a 72-hour timelock.
     * @param token Token address (address(0) for native HSK)
     * @param amount Amount to withdraw
     */
    function requestEmergencyWithdrawal(address token, uint256 amount) external onlyOwner {
        withdrawalToken = token;
        withdrawalAmount = amount;
        withdrawalRequestTime = block.timestamp;
        emit WithdrawalRequested(token, amount, block.timestamp + WITHDRAWAL_TIMELOCK);
    }

    /**
     * @notice Execute the previously requested emergency withdrawal after timelock expires.
     */
    function executeEmergencyWithdrawal() external onlyOwner nonReentrant {
        if (withdrawalRequestTime == 0) revert NoPendingWithdrawal();
        if (block.timestamp < withdrawalRequestTime + WITHDRAWAL_TIMELOCK) revert TimelockNotExpired();

        address token = withdrawalToken;
        uint256 amount = withdrawalAmount;

        // Reset state before transfer
        withdrawalToken = address(0);
        withdrawalAmount = 0;
        withdrawalRequestTime = 0;

        if (token == address(0)) {
            _transferNative(owner(), amount);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }

        emit WithdrawalExecuted(token, amount);
    }

    receive() external payable {}
}
