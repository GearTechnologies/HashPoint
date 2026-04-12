// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title NonceRegistry
 * @notice Manages UTXO-style nonce commitments to prevent double-spending
 * in offline payment scenarios. Merchants pre-commit a nonce root before
 * going offline; individual payment nonces are revealed and spent on settlement.
 */
contract NonceRegistry {
    // Merkle root of pre-committed nonces per merchant per session
    mapping(address => mapping(uint256 => bytes32)) public sessionNonceRoots;
    // Track spent nonces: merchant => sessionId => nonceHash => spent
    mapping(address => mapping(uint256 => mapping(bytes32 => bool))) public spentNonces;
    // Session metadata
    mapping(address => uint256) public currentSessionId;
    mapping(address => mapping(uint256 => uint256)) public sessionExpiry;
    mapping(address => mapping(uint256 => uint256)) public sessionMaxPayments;

    event SessionOpened(
        address indexed merchant,
        uint256 sessionId,
        bytes32 nonceRoot,
        uint256 expiry,
        uint256 maxPayments
    );
    event NonceSpent(address indexed merchant, uint256 sessionId, bytes32 nonceHash);
    event SessionClosed(address indexed merchant, uint256 sessionId);

    error SessionExpired();
    error NonceAlreadySpent();
    error InvalidNonceProof();
    error SessionNotActive();

    /**
     * @notice Merchant opens an offline session by committing a Merkle root
     * of pre-generated nonces. Called before going offline.
     * @param nonceRoot Merkle root of all valid nonces for this session
     * @param durationSeconds How long this session is valid (max 24 hours)
     * @param maxPayments Maximum number of payments in this session
     */
    function openSession(
        bytes32 nonceRoot,
        uint256 durationSeconds,
        uint256 maxPayments
    ) external returns (uint256 sessionId) {
        require(durationSeconds <= 86400, "Max 24h session");
        require(maxPayments <= 1000, "Max 1000 payments per session");

        sessionId = ++currentSessionId[msg.sender];
        sessionNonceRoots[msg.sender][sessionId] = nonceRoot;
        sessionExpiry[msg.sender][sessionId] = block.timestamp + durationSeconds;
        sessionMaxPayments[msg.sender][sessionId] = maxPayments;

        emit SessionOpened(
            msg.sender,
            sessionId,
            nonceRoot,
            block.timestamp + durationSeconds,
            maxPayments
        );
    }

    /**
     * @notice Verify and spend a nonce during settlement.
     * @param merchant The merchant address
     * @param sessionId The offline session ID
     * @param nonce The individual nonce being spent
     * @param merkleProof Proof that nonce is in the committed Merkle root
     */
    function spendNonce(
        address merchant,
        uint256 sessionId,
        bytes32 nonce,
        bytes32[] calldata merkleProof
    ) external returns (bool) {
        if (block.timestamp > sessionExpiry[merchant][sessionId]) revert SessionExpired();

        bytes32 nonceHash = keccak256(abi.encodePacked(nonce));
        if (spentNonces[merchant][sessionId][nonceHash]) revert NonceAlreadySpent();

        // Verify Merkle proof
        if (!_verifyMerkleProof(merkleProof, sessionNonceRoots[merchant][sessionId], nonceHash)) {
            revert InvalidNonceProof();
        }

        spentNonces[merchant][sessionId][nonceHash] = true;
        emit NonceSpent(merchant, sessionId, nonceHash);
        return true;
    }

    function _verifyMerkleProof(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == root;
    }

    function isSessionActive(address merchant, uint256 sessionId) external view returns (bool) {
        return block.timestamp <= sessionExpiry[merchant][sessionId];
    }
}
