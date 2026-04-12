// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MerchantRegistry
 * @notice Merchant onboarding, configuration, and reputation.
 */
contract MerchantRegistry is Ownable {
    // ─── Structs ────────────────────────────────────────────────────────────────

    struct Merchant {
        string name;
        string category;
        address settlementToken;      // preferred ERC-20 token (address(0) = native HSK)
        bool active;
        uint256 registeredAt;
        uint256 totalPayments;
        uint256 totalVolume;          // cumulative in smallest token unit
        uint256 reputationScore;      // starts at 100, increments/decrements
        uint256 defaultSessionDuration; // seconds
    }

    // ─── State ──────────────────────────────────────────────────────────────────

    mapping(address => Merchant) private _merchants;
    address[] private _merchantList;

    // Escrow contract is allowed to call recordPayment / recordDispute
    address public escrow;

    // ─── Events ─────────────────────────────────────────────────────────────────

    event MerchantRegistered(
        address indexed merchant,
        string name,
        string category,
        address settlementToken
    );
    event MerchantUpdated(address indexed merchant);
    event MerchantDeactivated(address indexed merchant);
    event PaymentRecorded(address indexed merchant, uint256 amount);
    event DisputeRecorded(address indexed merchant);

    // ─── Errors ─────────────────────────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error Unauthorized();

    // ─── Constructor ────────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Modifiers ──────────────────────────────────────────────────────────────

    modifier onlyEscrow() {
        if (msg.sender != escrow && msg.sender != owner()) revert Unauthorized();
        _;
    }

    // ─── Registration ───────────────────────────────────────────────────────────

    /**
     * @notice Register as a merchant.
     */
    function registerMerchant(
        string calldata name,
        string calldata category,
        address settlementToken,
        uint256 defaultSessionDuration
    ) external {
        if (_merchants[msg.sender].registeredAt != 0) revert AlreadyRegistered();
        require(bytes(name).length > 0, "Name required");
        require(defaultSessionDuration <= 86400, "Max 24h session");

        _merchants[msg.sender] = Merchant({
            name: name,
            category: category,
            settlementToken: settlementToken,
            active: true,
            registeredAt: block.timestamp,
            totalPayments: 0,
            totalVolume: 0,
            reputationScore: 100,
            defaultSessionDuration: defaultSessionDuration
        });
        _merchantList.push(msg.sender);

        emit MerchantRegistered(msg.sender, name, category, settlementToken);
    }

    /**
     * @notice Update merchant configuration.
     */
    function updateMerchant(
        string calldata name,
        string calldata category,
        address settlementToken,
        uint256 defaultSessionDuration
    ) external {
        if (_merchants[msg.sender].registeredAt == 0) revert NotRegistered();
        require(defaultSessionDuration <= 86400, "Max 24h session");

        Merchant storage m = _merchants[msg.sender];
        if (bytes(name).length > 0) m.name = name;
        if (bytes(category).length > 0) m.category = category;
        m.settlementToken = settlementToken;
        m.defaultSessionDuration = defaultSessionDuration;

        emit MerchantUpdated(msg.sender);
    }

    /**
     * @notice Admin can deactivate a merchant.
     */
    function deactivateMerchant(address merchant) external onlyOwner {
        _merchants[merchant].active = false;
        emit MerchantDeactivated(merchant);
    }

    // ─── Stats (called by escrow) ────────────────────────────────────────────────

    /**
     * @notice Record a successful payment.
     */
    function recordPayment(
        address merchant,
        address, /* token */
        uint256 amount
    ) external onlyEscrow {
        Merchant storage m = _merchants[merchant];
        m.totalPayments++;
        m.totalVolume += amount;
        if (m.reputationScore < 1000) m.reputationScore++;
        emit PaymentRecorded(merchant, amount);
    }

    /**
     * @notice Record a dispute, decrements reputation.
     */
    function recordDispute(address merchant) external onlyEscrow {
        Merchant storage m = _merchants[merchant];
        if (m.reputationScore > 0) m.reputationScore--;
        emit DisputeRecorded(merchant);
    }

    // ─── Views ──────────────────────────────────────────────────────────────────

    function getMerchantInfo(address merchant) external view returns (Merchant memory) {
        return _merchants[merchant];
    }

    function isMerchant(address merchant) external view returns (bool) {
        return _merchants[merchant].active && _merchants[merchant].registeredAt != 0;
    }

    function getMerchantCount() external view returns (uint256) {
        return _merchantList.length;
    }

    function getMerchantAt(uint256 index) external view returns (address) {
        return _merchantList[index];
    }

    // ─── Admin ──────────────────────────────────────────────────────────────────

    function setEscrow(address _escrow) external onlyOwner {
        require(_escrow != address(0), "Invalid escrow");
        escrow = _escrow;
    }
}
