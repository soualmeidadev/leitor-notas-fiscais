import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const json = (value) => value == null ? null : JSON.stringify(value);
const parse = (value, fallback = null) => {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

export class ProcessedEmailService {
  constructor(databasePath, { legacyJsonPath = null } = {}) {
    this.filePath = databasePath;
    this.legacyJsonPath = legacyJsonPath;
    this.db = null;
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    this.db = new Database(this.filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS emails (
        message_id TEXT PRIMARY KEY, thread_id TEXT, processed_at TEXT NOT NULL,
        status TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT,
        subject TEXT, sender TEXT, email_date TEXT, notification_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_emails_retry ON emails(status, next_retry_at);
      CREATE TABLE IF NOT EXISTS attachments (
        sha256 TEXT PRIMARY KEY, message_id TEXT NOT NULL, filename TEXT NOT NULL,
        path TEXT, mime_type TEXT, fiscal_json TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(message_id) REFERENCES emails(message_id)
      );
      CREATE TABLE IF NOT EXISTS email_attachments (
        message_id TEXT NOT NULL, sha256 TEXT NOT NULL,
        PRIMARY KEY(message_id, sha256),
        FOREIGN KEY(message_id) REFERENCES emails(message_id),
        FOREIGN KEY(sha256) REFERENCES attachments(sha256)
      );
      CREATE TABLE IF NOT EXISTS telegram_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('NOTICE','DOCUMENT')), attachment_sha TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT, last_error TEXT, created_at TEXT NOT NULL, sent_at TEXT,
        UNIQUE(message_id, kind, attachment_sha)
      );
      CREATE INDEX IF NOT EXISTS idx_telegram_pending ON telegram_queue(status, next_retry_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_unique_item
        ON telegram_queue(message_id, kind, COALESCE(attachment_sha, ''));
      CREATE TABLE IF NOT EXISTS leases (
        name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
    `);
    await this.migrateLegacyJson();
  }

  async migrateLegacyJson() {
    if (!this.legacyJsonPath || this.db.prepare("SELECT COUNT(*) count FROM emails").get().count) return;
    let records;
    try { records = JSON.parse(await fs.readFile(this.legacyJsonPath, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (!Array.isArray(records)) throw new Error("Histórico JSON legado deve conter uma lista");
    const migrate = this.db.transaction(() => records.forEach((record) => this.addSync(record, false)));
    migrate();
    await fs.rename(this.legacyJsonPath, `${this.legacyJsonPath}.migrated`).catch(() => {});
  }

  close() { this.db?.close(); this.db = null; }

  acquireLease(name, owner, ttlMs) {
    const now = Date.now();
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM leases WHERE name = ? AND expires_at <= ?").run(name, now);
      return this.db.prepare("INSERT OR IGNORE INTO leases(name, owner, expires_at) VALUES (?, ?, ?)")
        .run(name, owner, now + ttlMs).changes === 1;
    });
    return transaction();
  }

  releaseLease(name, owner) { this.db.prepare("DELETE FROM leases WHERE name = ? AND owner = ?").run(name, owner); }

  hasMessage(messageId) {
    const row = this.db.prepare("SELECT status, next_retry_at FROM emails WHERE message_id = ?").get(messageId);
    if (!row) return false;
    if (row.status !== "ERROR" && row.status !== "RETRY_PENDING") return true;
    return row.next_retry_at && new Date(row.next_retry_at).getTime() > Date.now();
  }

  getDueRetryMessageIds() {
    return this.db.prepare(`SELECT message_id FROM emails
      WHERE status IN ('ERROR','RETRY_PENDING') AND (next_retry_at IS NULL OR next_retry_at <= ?)`)
      .all(new Date().toISOString()).map((row) => row.message_id);
  }

  getAttempts(messageId) { return this.db.prepare("SELECT attempts FROM emails WHERE message_id = ?").get(messageId)?.attempts ?? 0; }
  hasHash(sha256) { return Boolean(this.db.prepare("SELECT 1 FROM attachments WHERE sha256 = ?").get(sha256)); }

  findAttachmentByHash(sha256) {
    const row = this.db.prepare("SELECT * FROM attachments WHERE sha256 = ?").get(sha256);
    return row && this.mapAttachment(row);
  }

  wasHashSentToTelegram(sha256) {
    return Boolean(this.db.prepare("SELECT 1 FROM telegram_queue WHERE attachment_sha = ? AND kind = 'DOCUMENT' AND status = 'SENT'").get(sha256));
  }

  async add(record) { this.db.transaction(() => this.addSync(record, true))(); }

  addSync(record, replace) {
    const conflict = replace ? `ON CONFLICT(message_id) DO UPDATE SET
      thread_id=excluded.thread_id, processed_at=excluded.processed_at, status=excluded.status,
      score=excluded.score, reason=excluded.reason, attempts=excluded.attempts,
      next_retry_at=excluded.next_retry_at, subject=excluded.subject, sender=excluded.sender,
      email_date=excluded.email_date, notification_json=excluded.notification_json` : "ON CONFLICT(message_id) DO NOTHING";
    this.db.prepare(`INSERT INTO emails
      (message_id, thread_id, processed_at, status, score, reason, attempts, next_retry_at, subject, sender, email_date, notification_json)
      VALUES (@messageId,@threadId,@processedAt,@status,@score,@reason,@attempts,@nextRetryAt,@subject,@sender,@emailDate,@notification)
      ${conflict}`)
      .run({ messageId: record.messageId, threadId: record.threadId ?? null,
        processedAt: record.processedAt ?? new Date().toISOString(), status: record.status,
        score: record.score ?? 0, reason: record.reason ?? null, attempts: record.attempts ?? 0,
        nextRetryAt: record.nextRetryAt ?? null, subject: record.subject ?? null,
        sender: record.sender ?? null, emailDate: record.emailDate ?? null,
        notification: json(record.notification) });
    for (const attachment of record.attachments ?? []) {
      this.db.prepare(`INSERT INTO attachments
        (sha256,message_id,filename,path,mime_type,fiscal_json,created_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(sha256) DO UPDATE SET filename=excluded.filename,
          path=COALESCE(excluded.path,attachments.path), mime_type=excluded.mime_type,
          fiscal_json=COALESCE(excluded.fiscal_json,attachments.fiscal_json)`)
        .run(attachment.sha256, record.messageId, attachment.filename, attachment.path ?? null,
          attachment.mimeType ?? null, json(attachment.fiscalXml), record.processedAt ?? new Date().toISOString());
      this.db.prepare("INSERT OR IGNORE INTO email_attachments(message_id,sha256) VALUES (?,?)")
        .run(record.messageId, attachment.sha256);
    }
    if (record.notification?.status === "SENT") {
      const hashes = record.notification.attachmentHashes
        ?? (record.attachments ?? []).map((attachment) => attachment.sha256);
      const sentAt = record.notification.sentAt ?? record.processedAt ?? new Date().toISOString();
      for (const sha of hashes) this.db.prepare(`INSERT OR IGNORE INTO telegram_queue
        (message_id,kind,attachment_sha,status,created_at,sent_at) VALUES (?,'DOCUMENT',?,'SENT',?,?)`)
        .run(record.messageId, sha, sentAt, sentAt);
    }
  }

  async recordError(record, { maxAttempts, baseDelayMs }) {
    const attempts = this.getAttempts(record.messageId) + 1;
    const terminal = attempts >= maxAttempts;
    const delay = Math.min(baseDelayMs * (2 ** Math.max(0, attempts - 1)), 24 * 60 * 60 * 1000);
    await this.add({ ...record, status: terminal ? "DEAD_LETTER" : "RETRY_PENDING", attempts,
      nextRetryAt: terminal ? null : new Date(Date.now() + delay).toISOString() });
    return { attempts, terminal };
  }

  enqueueTelegram(messageId, attachmentHashes) {
    const now = new Date().toISOString();
    const insert = this.db.prepare(`INSERT OR IGNORE INTO telegram_queue
      (message_id,kind,attachment_sha,status,created_at) VALUES (?,?,?,'PENDING',?)`);
    const tx = this.db.transaction(() => {
      insert.run(messageId, "NOTICE", null, now);
      for (const sha of attachmentHashes) insert.run(messageId, "DOCUMENT", sha, now);
    });
    tx();
  }

  getPendingTelegram(limit = 50) {
    return this.db.prepare(`SELECT q.*, e.subject, e.sender, e.email_date,
      a.filename, a.path, a.mime_type, a.fiscal_json
      FROM telegram_queue q JOIN emails e ON e.message_id=q.message_id
      LEFT JOIN attachments a ON a.sha256=q.attachment_sha
      WHERE q.status IN ('PENDING','RETRY_PENDING') AND (q.next_retry_at IS NULL OR q.next_retry_at <= ?)
        AND (q.kind='NOTICE' OR EXISTS (SELECT 1 FROM telegram_queue notice
          WHERE notice.message_id=q.message_id AND notice.kind='NOTICE' AND notice.status='SENT'))
      ORDER BY q.message_id, CASE q.kind WHEN 'NOTICE' THEN 0 ELSE 1 END, q.id LIMIT ?`)
      .all(new Date().toISOString(), limit).map((row) => ({ ...row, fiscalXml: parse(row.fiscal_json) }));
  }

  getMessageAttachments(messageId) {
    return this.db.prepare(`SELECT a.* FROM attachments a JOIN email_attachments ea ON ea.sha256=a.sha256
      WHERE ea.message_id=? AND a.path IS NOT NULL`).all(messageId).map((row) => this.mapAttachment(row));
  }

  markTelegramSent(id) {
    this.db.prepare("UPDATE telegram_queue SET status='SENT', sent_at=?, last_error=NULL WHERE id=?")
      .run(new Date().toISOString(), id);
  }

  markTelegramFailed(id, error, { maxAttempts, baseDelayMs }) {
    const current = this.db.prepare("SELECT attempts FROM telegram_queue WHERE id=?").get(id);
    const attempts = (current?.attempts ?? 0) + 1;
    const terminal = attempts >= maxAttempts;
    const next = terminal ? null : new Date(Date.now() + Math.min(baseDelayMs * (2 ** (attempts - 1)), 24 * 60 * 60 * 1000)).toISOString();
    this.db.prepare("UPDATE telegram_queue SET status=?, attempts=?, next_retry_at=?, last_error=? WHERE id=?")
      .run(terminal ? "DEAD_LETTER" : "RETRY_PENDING", attempts, next, String(error).slice(0, 1000), id);
  }

  async cleanupAttachments(retentionDays) {
    if (!retentionDays) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const rows = this.db.prepare(`SELECT a.sha256,a.path FROM attachments a
      WHERE a.path IS NOT NULL AND a.created_at < ? AND NOT EXISTS
      (SELECT 1 FROM telegram_queue q WHERE q.attachment_sha=a.sha256 AND q.status IN ('PENDING','RETRY_PENDING'))`).all(cutoff);
    let removed = 0;
    for (const row of rows) {
      try { await fs.unlink(row.path); removed += 1; }
      catch (error) { if (error.code !== "ENOENT") continue; }
      this.db.prepare("UPDATE attachments SET path=NULL WHERE sha256=?").run(row.sha256);
    }
    return removed;
  }

  getStats() {
    const statuses = Object.fromEntries(this.db.prepare("SELECT status,COUNT(*) count FROM emails GROUP BY status").all().map((r) => [r.status, r.count]));
    const pendingTelegram = this.db.prepare("SELECT COUNT(*) count FROM telegram_queue WHERE status IN ('PENDING','RETRY_PENDING')").get().count;
    return { emails: statuses, pendingTelegram };
  }

  get records() {
    return this.db.prepare("SELECT message_id messageId, status, processed_at processedAt FROM emails").all();
  }

  mapAttachment(row) { return { filename: row.filename, path: row.path, mimeType: row.mime_type, sha256: row.sha256, fiscalXml: parse(row.fiscal_json) }; }
}
