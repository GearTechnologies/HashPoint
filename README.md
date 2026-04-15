# HashPoint — Offline-First Payments on HashKey Chain

> **Production-Grade Offline-First Crypto Point-of-Sale on HashKey Chain**

HashPoint enables merchants in low-connectivity environments to **accept ERC-20 / native HSK payments without an active internet connection**. Customers sign EIP-712 typed-data payment intents offline; the merchant queues them locally and batch-settles on [HashKey Chain](https://www.hashfans.io/docs) when connectivity returns.

Built for the **HashKey Chain On-Chain Horizon Hackathon — PayFi track**.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Repository Structure](#repository-structure)
4. [Smart Contracts](#smart-contracts)
   - [NonceRegistry](#nonceregistry)
   - [MerchantRegistry](#merchantregistry)
   - [HSPAdapter](#hspadapter)
   - [HashPointEscrow](#hashpointescrow)
   - [MockUSDC (Testnet)](#mockusdc-testnet)
5. [Testnet Deployments — Chain ID 133](#testnet-deployments--chain-id-133)
6. [Environment Variables](#environment-variables)
7. [Getting Started](#getting-started)
8. [Deployment](#deployment)
9. [SDK Usage](#sdk-usage)
   - [NonceManager](#noncemanager)
   - [PaymentIntent / EIP-712 Signing](#paymentintent--eip-712-signing)
   - [IntentQueue](#intentqueue)
   - [QRCodeGenerator](#qrcodegenerator)
   - [BatchSettler](#batchsettler)
   - [ConnectivityMonitor](#connectivitymonitor)
10. [Backend Relay — API Reference](#backend-relay--api-reference)
11. [Merchant App](#merchant-app)
12. [End-to-End Payment Flow](#end-to-end-payment-flow)
13. [How HSP is Used](#how-hsp-is-used)
14. [Security Model](#security-model)
15. [HashKey Chain Network Info](#hashkey-chain-network-info)
16. [License](#license)

---

## Problem Statement

Billions of people in emerging markets lack reliable internet access, yet smartphone penetration is high. Traditional crypto payment systems require constant connectivity, making them impractical for street vendors, market stalls, and rural merchants.

HashPoint solves this with:

- **Offline-first design** — customers sign EIP-712 payment intents with zero network calls
- **UTXO-style nonces** — merchants pre-commit a Merkle tree of nonces before going offline, preventing double-spend without any RPC
- **Batch settlement** — when connectivity returns, all pending intents settle in a single on-chain transaction
- **HSP integration** — every settlement emits full HSP-compatible events for interoperability with HashKey ecosystem wallets and dashboards

---

## Architecture Overview

```
+--------------------------------------------------------------------------+
|                          HashPoint System                                |
|                                                                          |
|  +---------------------+   QR (base64url)  +-------------------------+  |
|  |   Customer Wallet   | ----------------> |     Merchant PWA        |  |
|  |  (signs EIP-712     |                   |  (Next.js, offline-      |  |
|  |   offline intent)   | <---------------- |   capable PWA)          |  |
|  +---------------------+  Payment Receipt  |                         |  |
|                                            |  +-----------------+    |  |
|                                            |  |   SDK (TS)      |    |  |
|                                            |  |  NonceManager   |    |  |
|                                            |  |  IntentQueue    |    |  |
|                                            |  |  BatchSettler   |    |  |
|                                            |  +--------+--------+    |  |
|                                            +-----------+-------------+  |
|                                                        | (when online)   |
|                                          +-------------v------------+   |
|                                          |   Backend Relay Service  |   |
|                                          |  POST /api/relay/submit  |   |
|                                          |  POST /api/relay/batch   |   |
|                                          |  GET  /api/status/:id    |   |
|                                          |  EventIndexer (Postgres) |   |
|                                          +-------------+------------+   |
|                                                        |                 |
|                                          +-------------v------------+   |
|                                          |    HashKey Chain (EVM)   |   |
|                                          |                          |   |
|                                          |  NonceRegistry           |   |
|                                          |  MerchantRegistry        |   |
|                                          |  HSPAdapter              |   |
|                                          |  HashPointEscrow         |   |
|                                          +--------------------------+   |
+--------------------------------------------------------------------------+
```

**Key design principles:**

| Principle | Implementation |
|---|---|
| Offline-first | EIP-712 signing requires zero RPC calls |
| Double-spend prevention | Merkle-tree nonce commitments pre-registered on-chain per session |
| Gas-efficient batch settlement | `settleBatch()` processes up to N intents in one tx |
| HSP compatibility | `HSPAdapter` emits all three HSP message types per payment |
| Non-custodial | Funds flow customer -> escrow -> merchant atomically in same tx |
| Fail-safe batches | Failed intents emit `PaymentFailed` and are skipped, not reverted |
| Emergency safety | 72-hour timelocked withdrawal + `Pausable` circuit breaker |

---

## Repository Structure

```
HashPoint/
├── .env                          # Root environment config
├── package.json                  # Root npm workspace
│
├── contracts/                    # Solidity contracts + Hardhat
│   ├── hardhat.config.ts
│   ├── contracts/
│   │   ├── HashPointEscrow.sol      # Core escrow and settlement
│   │   ├── NonceRegistry.sol        # Anti-double-spend nonce registry
│   │   ├── HSPAdapter.sol           # HSP protocol integration
│   │   ├── MerchantRegistry.sol     # Merchant onboarding + reputation
│   │   ├── MockUSDC.sol             # Test USDC token (testnet only)
│   │   └── interfaces/
│   │       ├── IHashPointEscrow.sol
│   │       └── IHSP.sol
│   ├── scripts/
│   │   └── deploy.ts                # Full deployment script (incl. MockUSDC)
│   ├── test/
│   │   └── HashPointEscrow.test.ts
│   └── deployments/
│       └── hashkeyTestnet.json      # Auto-generated after deployment
│
├── sdk/                          # TypeScript SDK (@hashpoint/sdk)
│   └── src/
│       ├── index.ts
│       ├── offline/
│       │   ├── PaymentIntent.ts     # EIP-712 domain + signing helpers
│       │   ├── NonceManager.ts      # Merkle nonce generation & proofs
│       │   ├── IntentQueue.ts       # Persistent queue of signed intents
│       │   └── QRCodeGenerator.ts  # QR encode/decode helpers
│       ├── settlement/
│       │   ├── BatchSettler.ts      # Watches queue, submits on connectivity
│       │   ├── ConnectivityMonitor.ts  # Network availability detection
│       │   └── HSPClient.ts         # HSP event client
│       └── crypto/
│           ├── Signer.ts            # EIP-712 signing utilities
│           └── IntentVerifier.ts    # Signature verification
│
├── backend/                      # Node.js relay service + indexer
│   └── src/
│       ├── index.ts               # Server entrypoint
│       ├── api/
│       │   └── router.ts          # Express REST API
│       ├── relay/
│       │   └── RelayService.ts    # Intent verification + queue + batch submit
│       └── indexer/
│           └── EventIndexer.ts    # PostgreSQL event indexer
│
└── merchant-app/                 # Next.js merchant PWA
    └── src/
        ├── pages/
        │   ├── index.tsx          # Welcome / connect wallet
        │   ├── dashboard.tsx      # Payment overview + live queue status
        │   ├── session.tsx        # Open / manage offline session
        │   ├── queue.tsx          # Pending / submitted / failed intents
        │   ├── settings.tsx       # Merchant config, relay URL, tokens
        │   └── payment/
        │       ├── new.tsx        # Create new payment request
        │       └── qr/[intentId].tsx  # Display QR for customer scan
        ├── components/
        │   ├── PaymentQR.tsx      # QR code display component
        │   ├── SessionStatus.tsx  # Nonce slots + expiry countdown
        │   ├── TransactionList.tsx  # Settled payments history
        │   └── OfflineBanner.tsx  # Persistent offline indicator
        └── hooks/
            ├── useSession.ts      # Active NonceManager session state
            ├── useConnectivity.ts # Wraps ConnectivityMonitor for React
            └── useSettlementQueue.ts  # Syncs IntentQueue <-> relay API
```

---

## Smart Contracts

### NonceRegistry

**`contracts/contracts/NonceRegistry.sol`**

Manages UTXO-style nonce commitments to prevent double-spending in offline scenarios. Merchants pre-commit a Merkle root of random nonces before going offline. Individual nonces are revealed and spent during settlement using a Merkle inclusion proof.

| Method | Description |
|---|---|
| `openSession(nonceRoot, durationSeconds, maxPayments)` | Commits a Merkle root of nonces for a new offline session. Returns `sessionId`. Max 24 h / 1 000 payments. |
| `spendNonce(merchant, sessionId, nonce, proof)` | Called by `HashPointEscrow`. Validates proof, checks expiry, marks nonce as spent. |
| `sessionNonceRoots(merchant, sessionId)` | View: committed Merkle root. |
| `spentNonces(merchant, sessionId, nonceHash)` | View: whether a nonce has been used. |
| `sessionExpiry(merchant, sessionId)` | View: Unix timestamp when session expires. |
| `sessionMaxPayments(merchant, sessionId)` | View: max allowed payments for the session. |

**Events:** `SessionOpened`, `NonceSpent`, `SessionClosed`

---

### MerchantRegistry

**`contracts/contracts/MerchantRegistry.sol`**

On-chain merchant directory with reputation scoring and payment history.

| Method | Description |
|---|---|
| `registerMerchant(name, category, settlementToken, defaultSessionDuration)` | Self-registration. `settlementToken = address(0)` = native HSK. |
| `updateMerchant(...)` | Update own profile. |
| `deactivateMerchant()` | Soft-delete own registration. |
| `setEscrow(escrow)` | Owner only — wired to `HashPointEscrow` at deployment. |
| `recordPayment(merchant, amount)` | Called by escrow: increments `totalPayments`, `totalVolume`, bumps `reputationScore`. |
| `recordDispute(merchant)` | Called by escrow: decrements `reputationScore`. |
| `getMerchant(merchant)` | View: full `Merchant` struct. |
| `isActiveMerchant(merchant)` | View: quick active status check. |
| `getMerchantCount()` | View: total registered merchants. |

**Merchant struct:** `name`, `category`, `settlementToken`, `active`, `registeredAt`, `totalPayments`, `totalVolume`, `reputationScore` (starts at 100), `defaultSessionDuration`.

**Events:** `MerchantRegistered`, `MerchantUpdated`, `MerchantDeactivated`, `PaymentRecorded`, `DisputeRecorded`

---

### HSPAdapter

**`contracts/contracts/HSPAdapter.sol`**

Wraps HashPoint settlements into HSP-compatible message format. Called by `HashPointEscrow` on every successful payment via the `ESCROW_ROLE` access-control guard.

On each payment, three sequential `HSPMessageEmitted` events are emitted:

| Step | `HSPMessageType` | `HSPStatus` | Purpose |
|---|---|---|---|
| 1 | `PAYMENT_REQUEST` | `PENDING` | Records the original payment request from the customer |
| 2 | `PAYMENT_CONFIRMATION` | `CONFIRMED` | Confirms funds moved on-chain |
| 3 | `PAYMENT_RECEIPT` | `CONFIRMED` | Final receipt with merchant + customer + amount + ref |

Each `messageId = keccak256(merchant, customer, nonce, block.number)`.

**Access control:** `DEFAULT_ADMIN_ROLE` (deployer), `ESCROW_ROLE` (HashPointEscrow). Only `ESCROW_ROLE` can call `onPaymentSettled`.

---

### HashPointEscrow

**`contracts/contracts/HashPointEscrow.sol`**

Core settlement contract. Inherits `EIP712`, `ReentrancyGuard`, `Ownable`, `Pausable`.

#### PaymentIntent struct (EIP-712 typed data)

```solidity
struct PaymentIntent {
    address merchant;
    address customer;
    address token;      // address(0) = native HSK
    uint256 amount;
    uint256 sessionId;
    bytes32 nonce;
    uint256 expiry;     // Unix timestamp
    bytes32 merchantRef;
    uint256 chainId;    // Must match block.chainid
}
```

EIP-712 domain:
```
name:              "HashPoint"
version:           "1"
chainId:           <network chainId>
verifyingContract: <HashPointEscrow address>
```

#### Key methods

| Method | Caller | Description |
|---|---|---|
| `settlePayment(intent, sig, merkleProof)` | Anyone (relay or merchant) | Settle a single intent. Verifies EIP-712 sig, chainId, nonce proof, transfers funds. |
| `settleBatch(intents[], sigs[], merkleProofs[])` | Anyone | Settle a batch. `msg.value` must equal total native HSK. Failed intents emit `PaymentFailed` and are skipped. |
| `requestWithdrawal(token, amount)` | Owner | Initiate 72-hour timelocked emergency withdrawal. |
| `executeWithdrawal()` | Owner | Execute after timelock expires. |
| `pause() / unpause()` | Owner | Circuit breaker for emergencies. |
| `setFeeRecipient(addr)` | Owner | Update fee recipient address. |
| `setFeeBps(bps)` | Owner | Update fee in basis points (max 1 000 = 10%). |

#### Fee model

Default: **10 bps (0.1%)**.

```
merchantReceives   = amount - (amount * feeBps / 10_000)
feeRecipient       = amount * feeBps / 10_000
```

**Events:** `PaymentSettled`, `BatchSettled`, `PaymentFailed`, `FeeRecipientUpdated`, `FeeBpsUpdated`, `WithdrawalRequested`, `WithdrawalExecuted`

---

### MockUSDC (Testnet)

**`contracts/contracts/MockUSDC.sol`**

A test ERC-20 token with **6 decimals** mimicking USDC. **Never deploy to mainnet.**

| Property | Value |
|---|---|
| Name | USD Coin (Test) |
| Symbol | USDC |
| Decimals | 6 |
| Initial supply | 10 000 000 USDC (minted to deployer) |
| Faucet per claim | 1 000 USDC |
| Faucet limit per address | 100 000 USDC cumulative |

```solidity
// Public — any address can claim 1 000 USDC (up to 100 000 cumulative)
function faucet() external;

// Owner only — mint arbitrary amounts
function mint(address to, uint256 amount) external onlyOwner;

// Burn caller's own balance
function burn(uint256 amount) external;
```

---

## Testnet Deployments — Chain ID 133

> Deployed **2025-04-15** from `0x9f2EdCE3a34e42eaf8f965d4E14aDDd12Cf865f4`
> RPC: `https://testnet.hsk.xyz`

| Contract | Address |
|---|---|
| **NonceRegistry** | `0xC5a2A6Dfc78DAcB4AAF474124Cb7f56360F23430` |
| **MerchantRegistry** | `0x461D7501ae9493b4678C60F97A903fc51069152A` |
| **HSPAdapter** | `0x71Fb66498976B7e09fB9FC176Fb1fb53959a4A54` |
| **HashPointEscrow** | `0x21ab93a1494b1B0E3eafdB24E3703F12F8AfeC20` |
| **MockUSDC** | `0x0a468e2506ff15a74c8D094CC09e48561969Aa12` |

Full deployment manifest: [`contracts/deployments/hashkeyTestnet.json`](contracts/deployments/hashkeyTestnet.json)

**Post-deployment wiring (executed automatically by deploy script):**

1. `HSPAdapter.grantRole(ESCROW_ROLE, HashPointEscrow)` done
2. `MerchantRegistry.setEscrow(HashPointEscrow)` done

---

## Environment Variables

```env
# Deployment
DEPLOYER_PRIVATE_KEY=<64-char hex, no 0x prefix>
HASHKEY_MAINNET_RPC=https://mainnet.hsk.xyz
HASHKEY_TESTNET_RPC=https://testnet.hsk.xyz
FEE_RECIPIENT_ADDRESS=<address that receives settlement fees>

# Backend Relay
RELAY_WALLET_PRIVATE_KEY=<64-char hex — wallet that pays gas for relayed txs>

# Database / Cache
DATABASE_URL=postgresql://user@localhost:5432/hashpoint
REDIS_URL=redis://localhost:6379

# Merchant App — testnet
NEXT_PUBLIC_ESCROW_ADDRESS=0x21ab93a1494b1B0E3eafdB24E3703F12F8AfeC20
NEXT_PUBLIC_NONCE_REGISTRY_ADDRESS=0xC5a2A6Dfc78DAcB4AAF474124Cb7f56360F23430
NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS=0x461D7501ae9493b4678C60F97A903fc51069152A
NEXT_PUBLIC_CHAIN_ID=133
NEXT_PUBLIC_RPC_URL=https://testnet.hsk.xyz
NEXT_PUBLIC_MERCHANT_NAME=My Shop
NEXT_PUBLIC_USDC_ADDRESS=0x0a468e2506ff15a74c8D094CC09e48561969Aa12
NEXT_PUBLIC_USDT_ADDRESS=
```

> **Security:** Never commit `.env` to source control.

---

## Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | >= 20 |
| npm | >= 10 |
| TypeScript | >= 5 |
| PostgreSQL | >= 14 (optional, for indexer) |

### Install Dependencies

```bash
cd contracts     && npm install
cd ../sdk        && npm install
cd ../backend    && npm install
cd ../merchant-app && npm install
```

### Compile Contracts

```bash
cd contracts
npx hardhat compile
# Generates typechain-types/ with full TypeScript bindings
```

### Run Tests

```bash
cd contracts
npx hardhat test
```

### Run Merchant App

```bash
cd merchant-app
npm run dev    # http://localhost:3000
```

### Run Backend Relay

```bash
cd backend
npm run dev    # http://localhost:3001
```

---

## Deployment

### Deploy to Testnet

```bash
cd contracts
npm run deploy:testnet
# Deploys NonceRegistry, MerchantRegistry, HSPAdapter, HashPointEscrow, MockUSDC
# Writes contracts/deployments/hashkeyTestnet.json
```

### Deploy to Mainnet

```bash
cd contracts
npm run deploy:mainnet
# Deploys NonceRegistry, MerchantRegistry, HSPAdapter, HashPointEscrow
# MockUSDC is skipped on mainnet
# Writes contracts/deployments/hashkeyMainnet.json
```

**After mainnet deployment:**

1. Copy addresses from `deployments/hashkeyMainnet.json` into `.env`.
2. Set `NEXT_PUBLIC_CHAIN_ID=177` and `NEXT_PUBLIC_RPC_URL=https://mainnet.hsk.xyz`.
3. Update `HASHPOINT_DOMAIN.chainId = 177` in `sdk/src/offline/PaymentIntent.ts`.
4. Set `HASHPOINT_DOMAIN.verifyingContract` to the live `HashPointEscrow` address.

---

## SDK Usage

### NonceManager

Generates random nonces offline, builds a Merkle tree, and provides settlement proofs. Must be called **before going offline**, while still connected.

```typescript
import { NonceManager } from "@hashpoint/sdk";

const manager = new NonceManager();

// Step 1: generate nonces and get root to commit on-chain
const { nonceRoot, nonces } = manager.prepareSession(100);
// -> call NonceRegistry.openSession(nonceRoot, 86400, 100) on-chain

// Step 2: get next nonce for each payment
const nonce = manager.getNextNonce();     // bytes32 hex
manager.markUsed(nonce!);                 // mark locally after signing

// Step 3: at settlement, get Merkle proof
const proof = manager.getMerkleProof(nonce!); // string[]

// Persistence
const saved  = manager.serialize();
const loaded = NonceManager.deserialize(saved);
```

---

### PaymentIntent / EIP-712 Signing

**Called on the customer device — zero network required.**

```typescript
import { createSignedPaymentIntent, PaymentIntentData } from "@hashpoint/sdk";
import { ethers } from "ethers";

const signer = new ethers.Wallet(customerPrivateKey);

const intentData: PaymentIntentData = {
  merchant:    "0x...",
  customer:    signer.address,
  token:       "0x0a468e2506ff15a74c8D094CC09e48561969Aa12", // MockUSDC testnet
  amount:      BigInt("5000000"),   // 5.00 USDC (6 decimals)
  sessionId:   BigInt(1),
  nonce:       nonce,               // bytes32 from NonceManager
  expiry:      Math.floor(Date.now() / 1000) + 3600,
  merchantRef: ethers.encodeBytes32String("INV-001"),
  chainId:     133,
};

const { intent, signature, qrPayload } = await createSignedPaymentIntent(
  signer,
  intentData,
  "0x21ab93a1494b1B0E3eafdB24E3703F12F8AfeC20"
);
// qrPayload is a compact base64url string ready to encode as QR
```

---

### IntentQueue

Persistent queue of signed intents awaiting on-chain settlement.

```typescript
import { IntentQueue } from "@hashpoint/sdk";

const queue = new IntentQueue();
queue.add({ intent, signature, merkleProof, queuedAt: Date.now() });

const pending = queue.getPending();
queue.markSubmitted(id, txHash);
queue.markConfirmed(id);
queue.markFailed(id, "reason");

// Persistence (localStorage / AsyncStorage)
const snapshot = queue.serialize();
const restored = IntentQueue.deserialize(snapshot);
```

---

### QRCodeGenerator

```typescript
import { encodeQRPayload, decodeQRPayload, QRCodeGenerator } from "@hashpoint/sdk";

// Encode (customer device)
const qrString = encodeQRPayload(intent, signature);

// Decode (merchant device scans QR)
const { intent, signature } = decodeQRPayload(qrString);

// Render PNG data URL
const dataUrl = await QRCodeGenerator.toDataURL(qrString);
```

Payload format (base64url JSON, version 1):
```json
{ "v":1, "m":"merchant", "c":"customer", "t":"token",
  "a":"amount", "s":"sessionId", "n":"nonce",
  "e":expiry, "r":"merchantRef", "sig":"0x..." }
```

---

### BatchSettler

Watches `IntentQueue` and submits batches when `ConnectivityMonitor` reports online.

```typescript
import { BatchSettler, ConnectivityMonitor, IntentQueue } from "@hashpoint/sdk";

const monitor = new ConnectivityMonitor("https://testnet.hsk.xyz");
monitor.start();

const settler = new BatchSettler(queue, monitor, provider, signer, escrowContract, {
  maxBatchSize: 20,
  maxRetries:   3,
  maxGasPrice:  ethers.parseUnits("5", "gwei"),
  retryDelayMs: 5_000,
});

settler.start();
// Submits on connectivity change or every 60 s

settler.getStatus();
// { pending: 3, submitted: 1, confirmed: 12, failed: 0 }
```

---

### ConnectivityMonitor

Detects network availability via `navigator.onLine` + periodic RPC ping.

```typescript
import { ConnectivityMonitor } from "@hashpoint/sdk";

const monitor = new ConnectivityMonitor("https://testnet.hsk.xyz");
monitor.start(30_000); // ping every 30 s

const unsub = monitor.onChange((online) => {
  console.log(online ? "Back online" : "Gone offline");
});

console.log(monitor.isOnline);
monitor.stop();
unsub(); // remove listener
```

---

## Backend Relay — API Reference

The Express relay accepts signed intents and submits batches to HashKey Chain. It also runs an `EventIndexer` writing `PaymentSettled` / `BatchSettled` events to PostgreSQL.

```bash
cd backend && npm start    # PORT default 3001
```

CORS enabled. All endpoints accept / return `application/json`.

---

### `POST /api/relay/submit`

Submit a single signed intent.

**Body:**
```json
{
  "intent": {
    "merchant": "0x...", "customer": "0x...",
    "token": "0x0a468e2506ff15a74c8D094CC09e48561969Aa12",
    "amount": "5000000", "sessionId": "1",
    "nonce": "0x...", "expiry": 1713196800,
    "merchantRef": "0x...", "chainId": 133
  },
  "signature": "0x...",
  "merkleProof": ["0x...", "0x..."]
}
```

**Response 200:** `{ "id": "uuid", "status": "queued" }`

**Errors:** `400` if intent expires in < 10 min or signature invalid. `429` rate limit.

---

### `POST /api/relay/batch`

Submit up to **50** intents in one call.

**Body:** `{ "intents": [{ "intent":{...}, "signature":"0x...", "merkleProof":["0x..."] }] }`

**Response 200:** `{ "ids": ["uuid1","uuid2"], "queued": 2 }`

---

### `GET /api/status/:id`

Poll relay status.

**Response:** `{ "id":"uuid", "status":"confirmed", "txHash":"0x...", "queuedAt":1713196700 }`

Status lifecycle: `queued` -> `submitted` -> `confirmed` | `failed`

---

### `GET /api/health`

Returns `{ "ok": true }`.

---

### Rate Limiting

100 requests per minute per merchant address (falls back to IP). Returns `429` when exceeded.

---

## Merchant App

```bash
cd merchant-app
npm run dev    # http://localhost:3000
npm run build  # production PWA build
```

**Pages:**

| Route | Description |
|---|---|
| `/` | Welcome screen / connect wallet |
| `/dashboard` | Payment overview, live queue status, recent transactions |
| `/session` | Open a new offline session (commits `nonceRoot` on-chain) |
| `/payment/new` | Create a new payment request (amount + token + ref) |
| `/payment/qr/[intentId]` | Display QR code for customer to scan and sign |
| `/queue` | View pending, submitted, and failed intents |
| `/settings` | Merchant profile, preferred token, relay URL |

**Components:**

| Component | Role |
|---|---|
| `PaymentQR` | Renders QR from `qrPayload` via `QRCodeGenerator.toDataURL()` |
| `SessionStatus` | Shows remaining nonce slots and session expiry countdown |
| `TransactionList` | Paginated settled payment history |
| `OfflineBanner` | Persistent banner when device is offline |

**Hooks:**

| Hook | Role |
|---|---|
| `useSession` | Manages active `NonceManager` session; persists to `localStorage` |
| `useConnectivity` | Wraps `ConnectivityMonitor` as React state |
| `useSettlementQueue` | Syncs `IntentQueue` <-> relay API when online |

---

## End-to-End Payment Flow

```
SETUP (requires internet, ~once per shift)
------------------------------------------
1. Merchant sdk: NonceManager.prepareSession(100) -> { nonceRoot, nonces }
2. Merchant on-chain: NonceRegistry.openSession(nonceRoot, 86400, 100) -> sessionId
3. NonceManager persisted to localStorage. Merchant can now go offline.

OFFLINE PAYMENT (zero internet required)
-----------------------------------------
4. Merchant opens /payment/new, inputs amount + token + ref.
5. App picks next nonce from NonceManager, builds PaymentIntentData.
6. Customer scans merchant QR on their wallet -> signs EIP-712 intent offline.
7. Customer shows signed QR to merchant.
8. Merchant device scans + decodes qrPayload -> stores in IntentQueue.

SETTLEMENT (when internet returns)
------------------------------------
 9. ConnectivityMonitor fires onChange(online=true).
10. BatchSettler collects pending intents (up to maxBatchSize=20).
11. For each intent, retrieves Merkle proof from NonceManager.
12. Calls HashPointEscrow.settleBatch(intents, sigs, proofs).

    On-chain per intent:
    a. Verify EIP-712 signature
    b. Check intent.chainId == block.chainid
    c. Check block.timestamp <= intent.expiry
    d. Verify Merkle proof via NonceRegistry
    e. Mark nonce as spent
    f. Transfer: customer -> escrow -> merchant (net) + feeRecipient (fee)
    g. HSPAdapter.onPaymentSettled -> emit 3 HSP events
    h. Emit PaymentSettled event
    i. MerchantRegistry.recordPayment -> update stats + reputation

13. BatchSettled event emitted with total count + amount.
14. IntentQueue marked confirmed. Merchant app shows receipts.
```

---

## How HSP is Used

HSP (HashKey Settlement Protocol) is the off-chain messaging layer. `HSPAdapter.sol` wraps every settlement into three HSP message types so HashKey ecosystem wallets and dashboards can track payment status without polling contract state.

| Step | `HSPMessageType` | `HSPStatus` | messageId |
|---|---|---|---|
| 1 | `PAYMENT_REQUEST` | `PENDING` | `keccak256(merchant‖customer‖nonce‖blockNumber)` |
| 2 | `PAYMENT_CONFIRMATION` | `CONFIRMED` | same |
| 3 | `PAYMENT_RECEIPT` | `CONFIRMED` | same |

Each event payload is ABI-encoded `HSPMessage` / `HSPReceipt`:
- `sender` = customer, `recipient` = merchant
- `amount` + `token` (ERC-20 address or `address(0)` for HSK)
- `paymentRef` = `merchantRef bytes32`
- `timestamp` = `block.timestamp`

HSP subscribers index `HSPMessageEmitted` events and push payment confirmations to wallets in real time.

---

## Security Model

| Threat | Mitigation |
|---|---|
| **Double-spend** | Merkle nonce pre-commitment; `spentNonces` registry on-chain |
| **Cross-chain replay** | `chainId` in signed intent verified against `block.chainid` |
| **Intent expiry exploit** | `block.timestamp > intent.expiry` reverts with `IntentExpired` |
| **Signature forgery** | EIP-712 `verifyingContract` domain prevents cross-contract replay |
| **Reentrancy** | `ReentrancyGuard` on `settlePayment` and `settleBatch` |
| **Batch front-running** | Nonce Merkle proof ties intent to specific merchant session |
| **Emergency stuck funds** | 72-hour timelocked `requestWithdrawal` / `executeWithdrawal` |
| **Merchant custody risk** | Customer signs with their own key; funds never custodied by merchant |
| **Relay spam / DoS** | Per-merchant rate limit (100 req/min); expiry check before queue |
| **Excessive fees** | `feeBps` hard-capped at 1 000 (10%) in constructor |
| **Protocol halt** | `Pausable` circuit breaker; owner can pause all settlements |
| **USDC faucet abuse** | `FAUCET_LIMIT` per address caps cumulative testnet claims |

---

## HashKey Chain Network Info

| | Testnet | Mainnet |
|---|---|---|
| **Chain ID** | `133` | `177` |
| **RPC** | `https://testnet.hsk.xyz` | `https://mainnet.hsk.xyz` |
| **Explorer** | `https://testnet-explorer.hsk.xyz` | `https://explorer.hsk.xyz` |
| **Native token** | HSK | HSK |
| **EVM version** | Cancun | Cancun |
| **Faucet** | hashfans.io/docs | — |

**Add HashKey Testnet to MetaMask:**

```
Network Name:     HashKey Chain Testnet
RPC URL:          https://testnet.hsk.xyz
Chain ID:         133
Currency Symbol:  HSK
Block Explorer:   https://testnet-explorer.hsk.xyz
```

**Get test USDC from the deployed faucet:**

```solidity
// Call faucet() on MockUSDC — receive 1 000 USDC per call (100 000 max cumulative)
// MockUSDC: 0x0a468e2506ff15a74c8D094CC09e48561969Aa12
MockUSDC(0x0a468e2506ff15a74c8D094CC09e48561969Aa12).faucet();
```

---

## License

MIT (c) HashPoint Contributors
