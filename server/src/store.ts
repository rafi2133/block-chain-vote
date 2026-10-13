import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { getAddress, keccak256, toUtf8Bytes } from 'ethers';
import type { Metadata, PreparedDraft, VoterBinding } from '../../shared/types.js';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export class BindingConflict extends Error {}
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS snapshots (hash TEXT PRIMARY KEY, raw TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings (
        deployment_id TEXT NOT NULL, person_id TEXT NOT NULL, wallet TEXT NOT NULL,
        PRIMARY KEY(deployment_id, person_id), UNIQUE(deployment_id, wallet));
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, creator TEXT NOT NULL,
        hash TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, voters TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges (
        nonce TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, address TEXT NOT NULL,
        message TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, address TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        deployment_id TEXT NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
        block_number INTEGER NOT NULL, block_hash TEXT NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL,
        PRIMARY KEY(deployment_id, tx_hash, log_index));
      CREATE TABLE IF NOT EXISTS cursors (deployment_id TEXT PRIMARY KEY, block_number INTEGER NOT NULL, block_hash TEXT NOT NULL);
    `);
  }
  snapshot(metadata: Metadata) {
    const rawMetadata = JSON.stringify(metadata);
    const metadataHash = keccak256(toUtf8Bytes(rawMetadata));
    this.db.prepare('INSERT OR IGNORE INTO snapshots VALUES (?, ?)').run(metadataHash, rawMetadata);
    return { rawMetadata, metadataHash };
  }
  getSnapshot(hash: string): string | null {
    return (this.db.prepare('SELECT raw FROM snapshots WHERE hash=?').get(hash)?.raw as string) ?? null;
  }
  saveDraft(deploymentId: string, creator: string, metadata: Metadata, startsAt: number, endsAt: number, voters: VoterBinding[]): PreparedDraft {
    const normalized = voters.map(v => ({ personId: v.personId.trim(), address: getAddress(v.address) }));
    if (new Set(normalized.map(v => v.personId)).size !== normalized.length || new Set(normalized.map(v => v.address.toLowerCase())).size !== normalized.length) {
      throw new BindingConflict('Each voter ID and wallet must appear only once.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const v of normalized) {
        const wallet = v.address.toLowerCase();
        const byPerson = this.db.prepare('SELECT wallet FROM bindings WHERE deployment_id=? AND person_id=?').get(deploymentId, v.personId);
        const byWallet = this.db.prepare('SELECT person_id FROM bindings WHERE deployment_id=? AND wallet=?').get(deploymentId, wallet);
        if ((byPerson && byPerson.wallet !== wallet) || (byWallet && byWallet.person_id !== v.personId)) {
          throw new BindingConflict('A voter ID or wallet is already bound to a different identity.');
        }
        this.db.prepare('INSERT OR IGNORE INTO bindings VALUES (?, ?, ?)').run(deploymentId, v.personId, wallet);
      }
      const id = randomUUID();
      const snapshot = this.snapshot({ ...metadata, draftId: id, schemaVersion: 1 });
      this.db.prepare('INSERT INTO drafts VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, deploymentId, creator.toLowerCase(), snapshot.metadataHash, startsAt, endsAt, JSON.stringify(normalized));
      this.db.exec('COMMIT');
      return { id, ...snapshot, startsAt, endsAt, candidateCount: metadata.candidates.length, wallets: normalized.map(v => v.address) };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  preparedDraft(deploymentId: string, creator: string, hash: string): PreparedDraft | null {
    const row = this.db.prepare('SELECT * FROM drafts WHERE deployment_id=? AND creator=? AND hash=?').get(deploymentId, creator.toLowerCase(), hash);
    const rawMetadata = this.getSnapshot(hash);
    if (!row || !rawMetadata) return null;
    const voters = JSON.parse(row.voters as string) as VoterBinding[];
    return { id: row.id as string, rawMetadata, metadataHash: hash, candidateCount: JSON.parse(rawMetadata).candidates.length,
      startsAt: Number(row.starts_at), endsAt: Number(row.ends_at), wallets: voters.map(v => v.address) };
  }
  challenge(nonce: string, deploymentId: string, address: string, message: string, expiresAt: number) {
    this.db.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(Date.now());
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    this.db.prepare('INSERT INTO challenges VALUES (?, ?, ?, ?, ?)').run(nonce, deploymentId, address.toLowerCase(), message, expiresAt);
  }
  getChallenge(nonce: string) { return this.db.prepare('SELECT * FROM challenges WHERE nonce=?').get(nonce); }
  consumeChallenge(nonce: string, deploymentId: string, address: string, token: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('DELETE FROM challenges WHERE nonce=? AND deployment_id=? AND expires_at>?').run(nonce, deploymentId, Date.now());
      if (Number(result.changes) !== 1) throw new Error('Login challenge expired or already used.');
      this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(tokenHash(token), deploymentId, address.toLowerCase(), Date.now() + 8 * 3600_000);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  session(token: string, deploymentId: string): string | null {
    return (this.db.prepare('SELECT address FROM sessions WHERE token_hash=? AND deployment_id=? AND expires_at>?').get(tokenHash(token), deploymentId, Date.now())?.address as string) ?? null;
  }
  logout(token: string) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token)); }
  cursor(id: string) { return this.db.prepare('SELECT * FROM cursors WHERE deployment_id=?').get(id); }
  clearEvents(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM events WHERE deployment_id=?').run(id);
      this.db.prepare('DELETE FROM cursors WHERE deployment_id=?').run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  saveEvents(id: string, events: { txHash: string; logIndex: number; blockNumber: number; blockHash: string; name: string; args: string }[], blockNumber: number, blockHash: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare('INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const e of events) insert.run(id, e.txHash, e.logIndex, e.blockNumber, e.blockHash, e.name, e.args);
      this.db.prepare('INSERT OR REPLACE INTO cursors VALUES (?, ?, ?)').run(id, blockNumber, blockHash);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  activity(id: string) {
    return this.db.prepare('SELECT * FROM events WHERE deployment_id=? ORDER BY block_number DESC, log_index DESC LIMIT 12').all(id).map(row => ({
      txHash: row.tx_hash, logIndex: row.log_index, blockNumber: row.block_number, name: row.name, args: JSON.parse(row.args as string),
    }));
  }
  close() { this.db.close(); }
}
