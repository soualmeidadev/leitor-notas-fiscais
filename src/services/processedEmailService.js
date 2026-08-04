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
