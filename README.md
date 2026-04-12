# HashPoint

> **Production-Grade Offline-First Crypto Point-of-Sale on HashKey Chain**

HashPoint enables merchants in low-connectivity environments (emerging markets like West Africa, Southeast Asia) to **accept crypto payments without an active internet connection**. Signed payment intents are queued locally and batch-settled on HashKey Chain when connectivity is restored.

Built for the **HashKey Chain On-Chain Horizon Hackathon — PayFi track**.

---

## Problem Statement

Billions of people in emerging markets lack reliable internet access, yet smartphone penetration is high. Traditional crypto payment systems require constant connectivity, making them impractical for street vendors, market stalls, and rural merchants.

HashPoint solves this with:
- **Offline-first design**: Customers sign EIP-712 payment intents without any network call
- **UTXO-style nonces**: Merchants pre-commit a Merkle tree of nonces before going offline
- **Batch settlement**: When connectivity returns, all pending intents are settled in a single transaction
- **HSP integration**: All settlements emit HSP-compatible events for interoperability

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CUSTOMER DEVICE                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Signs PaymentIntent (EIP-712) — NO network required     │   │
│  │  QR code displayed for merchant to scan                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │ QR scan
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         MERCHANT DEVICE (PWA)                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  IntentQueue (IndexedDB)  →  BatchSettler                │   │
│  │  NonceManager (Merkle)    →  ConnectivityMonitor         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │ (when online)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         HASHKEY CHAIN                            │
│  ┌─────────────────┐  ┌────────────────────┐  ┌─────────────┐  │
│  │ NonceRegistry   │  │ HashPointEscrow    │  │ HSPAdapter  │  │
│  │ (Merkle proofs) │  │ (EIP-712 settle)   │  │ (HSP events)│  │
│  └─────────────────┘  └────────────────────┘  └─────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   MerchantRegistry                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         RELAY SERVICE (Node.js)                  │
│  POST /api/relay/submit  │  POST /api/relay/batch               │
│  GET  /api/relay/status  │  GET  /api/relay/receipt             │
│  EventIndexer (PostgreSQL)                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## How HSP is Used

HSP (HashKey Settlement Protocol) is the core payment messaging layer for HashPoint.

**`HSPAdapter.sol`** wraps every settlement into three HSP message types:

| Message Type | When Emitted | Purpose |
|---|---|---|
| `PAYMENT_REQUEST` | Settlement initiated | Payment intent received |
| `PAYMENT_CONFIRMATION` | Funds confirmed transferred | On-chain confirmation |
| `PAYMENT_RECEIPT` | Full receipt data stored | Indexed for wallets/UIs |

Each message contains:
- `messageId = keccak256(merchant, customer, nonce, blockNumber)`
- `sender` / `recipient` addresses
- `amount` + `token`
- `reference` (merchantRef bytes32)
- `timestamp` (block.timestamp)
- `status` (PENDING → CONFIRMED)

HSP events (`HSPMessageEmitted`) are emitted on every `settlePayment()` / `settleBatch()` call, enabling HSP infrastructure to index and relay payment status to customer wallets and merchant dashboards.

---

## Deployed Contracts (HashKey Chain Testnet)

> Deploy with `npx hardhat run scripts/deploy.ts --network hashkeyTestnet` and update these addresses.

| Contract | Address |
|---|---|
| NonceRegistry | _TBD after deployment_ |
| MerchantRegistry | _TBD after deployment_ |
| HSPAdapter | _TBD after deployment_ |
| HashPointEscrow | _TBD after deployment_ |

---

## Project Structure

```
hashpoint/
├── contracts/                  # Solidity smart contracts (HashKey Chain)
│   ├── contracts/
│   │   ├── HashPointEscrow.sol     # Main escrow + settlement
│   │   ├── NonceRegistry.sol       # Anti-double-spend nonce commitment
│   │   ├── HSPAdapter.sol          # HSP protocol integration
│   │   ├── MerchantRegistry.sol    # Merchant onboarding
│   │   └── interfaces/
│   ├── test/                       # Hardhat tests
│   └── scripts/deploy.ts
├── sdk/                        # TypeScript SDK
│   └── src/
│       ├── offline/            # PaymentIntent, NonceManager, IntentQueue, QRCode
│       ├── settlement/         # BatchSettler, ConnectivityMonitor, HSPClient
│       └── crypto/             # Signer, IntentVerifier
├── merchant-app/               # React/Next.js PWA
│   └── src/
│       ├── pages/              # dashboard, payment/new, payment/qr, session, queue, settings
│       ├── components/         # OfflineBanner, PaymentQR, SessionStatus, TransactionList
│       └── hooks/              # useConnectivity, useSettlementQueue, useSession
└── backend/                    # Node.js relay + indexer
    └── src/
        ├── relay/              # RelayService
        ├── indexer/            # EventIndexer (PostgreSQL)
        └── api/                # Express REST API
```

---

## Local Development

### Prerequisites

- Node.js 18+
- npm 9+
- (Optional) PostgreSQL for the indexer

### 1. Clone and install

```bash
git clone https://github.com/GearTechnologies/HashPoint
cd HashPoint
cp .env.example .env
# Fill in .env values

# Install contracts deps
cd contracts && npm install --legacy-peer-deps && cd ..

# Install SDK deps
cd sdk && npm install && cd ..

# Install merchant app deps
cd merchant-app && npm install && cd ..

# Install backend deps
cd backend && npm install && cd ..
```

### 2. Compile and test contracts

```bash
cd contracts
npx hardhat compile
npx hardhat test
```

### 3. Deploy to HashKey Chain testnet

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network hashkeyTestnet
```

Update `.env` with the deployed contract addresses.

### 4. Run merchant PWA

```bash
cd merchant-app
npm run dev
# Opens at http://localhost:3000
```

### 5. Run relay backend

```bash
cd backend
npm run dev
# API at http://localhost:3001
```

---

## Running Tests

```bash
# Smart contract tests (Hardhat)
cd contracts && npx hardhat test

# SDK tests
cd sdk && npm test
```

---

## Payment Flow

1. **Before going offline**: Merchant opens a session on `NonceRegistry` by committing a Merkle root of pre-generated nonces.

2. **Offline payment**: Customer opens merchant's PWA or scans a QR code, enters amount, and signs an EIP-712 `PaymentIntent` — no internet needed.

3. **Local queue**: The merchant's PWA stores the signed intent in IndexedDB.

4. **Settlement**: When connectivity returns, `BatchSettler` submits up to 50 intents in a single `settleBatch()` call. Failed intents are skipped and retried.

5. **HSP events**: Each settled payment triggers three HSP messages (REQUEST → CONFIRMATION → RECEIPT) via `HSPAdapter`.

---

## Security Features

- **EIP-712 typed data signing** — prevents replay attacks across chains
- **Merkle-based nonce commitments** — UTXO-style double-spend prevention
- **Session expiry** — max 24h offline windows
- **Protocol fee** — configurable (default 0.1%) collected to `feeRecipient`
- **Emergency withdrawal** — 72-hour timelock, owner only
- **Pausable** — for security incidents
- **Batch skip-on-failure** — one bad intent doesn't block the batch

---

## License

MIT
