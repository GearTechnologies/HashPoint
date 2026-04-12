import { ethers } from "ethers";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

/**
 * NonceManager generates and manages offline session nonces.
 * Before going offline, merchant calls prepareSession() which:
 * 1. Generates N random nonces
 * 2. Builds a Merkle tree of nonce hashes
 * 3. Returns the root (to commit on-chain) + all nonces (stored locally)
 */
export class NonceManager {
  private nonces: Map<string, { nonce: string; used: boolean }> = new Map();
  private merkleTree: MerkleTree | null = null;

  /**
   * Prepare an offline session.
   * @param count Number of payment slots to pre-generate
   * @returns { nonceRoot, nonces } — root goes on-chain, nonces stored locally
   */
  prepareSession(count: number): { nonceRoot: string; nonces: string[] } {
    const nonces: string[] = [];
    for (let i = 0; i < count; i++) {
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      nonces.push(nonce);
    }

    const leaves = nonces.map((n) => keccak256(Buffer.from(n.slice(2), "hex")));
    this.merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const nonceRoot = "0x" + this.merkleTree.getRoot().toString("hex");

    nonces.forEach((n) => this.nonces.set(n, { nonce: n, used: false }));

    return { nonceRoot, nonces };
  }

  /**
   * Get the next unused nonce for a payment.
   */
  getNextNonce(): string | null {
    for (const [key, value] of this.nonces) {
      if (!value.used) return key;
    }
    return null;
  }

  /**
   * Mark nonce as used locally (before on-chain confirmation).
   */
  markUsed(nonce: string): void {
    const entry = this.nonces.get(nonce);
    if (entry) entry.used = true;
  }

  /**
   * Get Merkle proof for a nonce — needed during settlement.
   */
  getMerkleProof(nonce: string): string[] {
    if (!this.merkleTree) throw new Error("No active session");
    const leaf = keccak256(Buffer.from(nonce.slice(2), "hex"));
    return this.merkleTree.getHexProof(leaf);
  }

  getRemainingSlots(): number {
    let count = 0;
    for (const value of this.nonces.values()) {
      if (!value.used) count++;
    }
    return count;
  }

  /**
   * Serialize session to JSON for local storage persistence.
   */
  serialize(): string {
    return JSON.stringify({
      nonces: Array.from(this.nonces.entries()),
      treeRoot: this.merkleTree
        ? "0x" + this.merkleTree.getRoot().toString("hex")
        : null,
      // Serialize leaves in insertion order so the tree can be reconstructed
      leaves: this.merkleTree
        ? this.merkleTree.getLeaves().map((l) => l.toString("hex"))
        : [],
    });
  }

  static deserialize(data: string): NonceManager {
    const manager = new NonceManager();
    const parsed = JSON.parse(data);
    parsed.nonces.forEach(
      ([key, value]: [string, { nonce: string; used: boolean }]) => {
        manager.nonces.set(key, value);
      }
    );
    // Reconstruct the Merkle tree from the serialized leaves so that
    // getMerkleProof() continues to work after deserialization.
    if (parsed.leaves && parsed.leaves.length > 0) {
      const leaves = (parsed.leaves as string[]).map((hex) =>
        Buffer.from(hex, "hex")
      );
      manager.merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    }
    return manager;
  }
}
