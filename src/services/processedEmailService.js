import fs from "node:fs/promises";
import path from "node:path";

export class ProcessedEmailService {
  constructor(filePath) {
    this.filePath = filePath;
    this.records = [];
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) throw new Error("o conteúdo deve ser uma lista");
      this.records = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`Falha ao ler controle de processados: ${error.message}`);
      await this.save();
    }
  }

  hasMessage(messageId) {
    return this.records.some((record) => record.messageId === messageId);
  }

  hasHash(sha256) {
    return this.records.some((record) => record.attachments?.some((item) => item.sha256 === sha256));
  }

  findAttachmentByHash(sha256) {
    for (const record of this.records) {
      const attachment = record.attachments?.find((item) => item.sha256 === sha256);
      if (attachment) return attachment;
    }
    return null;
  }

  wasHashSentToTelegram(sha256) {
    return this.records.some((record) => record.notification?.status === "SENT"
      && (record.notification.attachmentHashes?.includes(sha256)
        || record.attachments?.some((item) => item.sha256 === sha256)));
  }

  async updateNotification(messageId, notification) {
    const record = this.records.find((item) => item.messageId === messageId);
    if (!record) throw new Error(`Mensagem ${messageId} não encontrada no histórico`);
    const previous = record.notification;
    record.notification = notification;
    try {
      await this.save();
    } catch (error) {
      record.notification = previous;
      throw error;
    }
  }

  async add(record) {
    this.records.push(record);
    try {
      await this.save();
    } catch (error) {
      this.records.pop();
      throw error;
    }
  }

  async save() {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(this.records, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.filePath);
  }
}
