import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProcessedEmailService } from "../src/services/processedEmailService.js";

const setup = async (options) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fiscal-reader-"));
  const service = new ProcessedEmailService(path.join(directory, "db.sqlite"), options);
  await service.initialize();
  return { directory, service };
};

test("persiste hashes, evita duplicação da fila e controla lock", async (t) => {
  const { directory, service } = await setup();
  t.after(async () => { service.close(); await fs.rm(directory, { recursive: true }); });
  await service.add({ messageId: "m1", processedAt: new Date().toISOString(), status: "PROCESSED",
    score: 80, attachments: [{ sha256: "abc", filename: "nfe.xml", path: "/tmp/nfe.xml", mimeType: "text/xml" }] });
  assert.equal(service.hasHash("abc"), true);
  service.enqueueTelegram("m1", ["abc"]); service.enqueueTelegram("m1", ["abc"]);
  const notice = service.getPendingTelegram();
  assert.equal(notice.length, 1);
  assert.equal(notice[0].kind, "NOTICE");
  service.markTelegramSent(notice[0].id);
  assert.equal(service.getPendingTelegram()[0].kind, "DOCUMENT");
  assert.equal(service.acquireLease("job", "one", 10000), true);
  assert.equal(service.acquireLease("job", "two", 10000), false);
});

test("agenda retry e encerra em dead letter", async (t) => {
  const { directory, service } = await setup();
  t.after(async () => { service.close(); await fs.rm(directory, { recursive: true }); });
  const base = { messageId: "m2", processedAt: new Date().toISOString(), score: 0, reason: "falha", attachments: [] };
  const first = await service.recordError(base, { maxAttempts: 2, baseDelayMs: 1 });
  assert.equal(first.terminal, false);
  const second = await service.recordError(base, { maxAttempts: 2, baseDelayMs: 1 });
  assert.equal(second.terminal, true);
  assert.equal(service.getStats().emails.DEAD_LETTER, 1);
});

test("migra histórico JSON legado", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fiscal-reader-"));
  const legacy = path.join(directory, "processed.json");
  await fs.writeFile(legacy, JSON.stringify([{ messageId: "old", processedAt: new Date().toISOString(),
    status: "PROCESSED", score: 60, attachments: [] }]));
  const service = new ProcessedEmailService(path.join(directory, "db.sqlite"), { legacyJsonPath: legacy });
  await service.initialize();
  t.after(async () => { service.close(); await fs.rm(directory, { recursive: true }); });
  assert.equal(service.hasMessage("old"), true);
  await fs.access(`${legacy}.migrated`);
});
