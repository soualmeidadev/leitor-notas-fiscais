import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { decodeBase64Url, sanitizeFilename } from "../utils/text.js";

export const getAttachmentBuffer = async (gmailService, messageId, attachment) => {
  const encoded = attachment.attachmentId
    ? await gmailService.getAttachment(messageId, attachment.attachmentId)
    : attachment.inlineData;
  if (!encoded) throw new Error(`Anexo ${sanitizeFilename(attachment.filename)} sem conteúdo`);
  return decodeBase64Url(encoded);
};

export const hashBuffer = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const availablePath = async (directory, filename) => {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(directory, filename);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(directory, `${stem}-${suffix}${extension}`);
      suffix += 1;
    } catch (error) {
      if (error.code === "ENOENT") return candidate;
      throw error;
    }
  }
};

export const saveAttachment = async ({ buffer, downloadDir, messageId, filename, date = new Date() }) => {
  const safeMessageId = sanitizeFilename(messageId);
  const directory = path.join(
    downloadDir,
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    safeMessageId,
  );
  await fs.mkdir(directory, { recursive: true });
  const destination = await availablePath(directory, sanitizeFilename(filename));
  await fs.writeFile(destination, buffer, { flag: "wx" });
  return destination;
};
