import crypto from "node:crypto";
import path from "node:path";
import { getAttachmentBuffer, hashBuffer, saveAttachment } from "../services/attachmentService.js";
import { classifyEmail, isFiscalFilename } from "../services/emailClassifier.js";
import { parseEmail } from "../services/emailParser.js";
import { analyzeFiscalXml } from "../services/fiscalXmlService.js";
import { logger } from "../utils/logger.js";

const isAccepted = (attachment) => [".xml", ".pdf"].includes(path.extname(attachment.filename).toLowerCase())
  || /^(?:application|text)\/xml/i.test(attachment.mimeType) || attachment.mimeType === "application/pdf";
const isXml = (attachment) => path.extname(attachment.filename).toLowerCase() === ".xml"
  || /(?:application|text)\/xml/i.test(attachment.mimeType);
const safeDate = (value) => Number.isNaN(new Date(value).getTime()) ? new Date() : new Date(value);

export const createEmailJob = ({ gmailService, processedService, telegramService, config }) => {
  let running = false;
  let stopping = false;
  const owner = `${process.pid}-${crypto.randomUUID()}`;
  const state = { running: false, lastStartedAt: null, lastSuccessAt: null, lastError: null, processed: 0 };

  const processTelegramQueue = async () => {
    if (!telegramService.enabled) return;
    const blocked = new Set();
    for (const item of processedService.getPendingTelegram()) {
      if (blocked.has(item.message_id)) continue;
      try {
        if (item.kind === "NOTICE") {
          const attachments = processedService.getMessageAttachments(item.message_id);
          await telegramService.sendNotice({ subject: item.subject, from: item.sender, date: item.email_date }, attachments);
        } else {
          if (!item.path) throw new Error("Arquivo do anexo não está mais disponível");
          await telegramService.sendDocument({ filename: item.filename, path: item.path, mimeType: item.mime_type, fiscalXml: item.fiscalXml });
        }
        processedService.markTelegramSent(item.id);
      } catch (error) {
        processedService.markTelegramFailed(item.id, error.message, {
          maxAttempts: config.telegramMaxAttempts, baseDelayMs: config.retryBaseDelayMs,
        });
        blocked.add(item.message_id);
        logger.error("Falha em item da fila do Telegram", { messageId: item.message_id, kind: item.kind, error: error.message });
      }
    }
  };

  const processMessage = async (messageId) => {
    let email;
    let classification = { score: 0, reasons: [] };
    const saved = [];
    try {
      email = parseEmail(await gmailService.getMessage(messageId));
      classification = classifyEmail(email, config.classification);
      const inspected = [];
      let confirmedXml = false;
      for (const attachment of email.attachments.filter(isAccepted)) {
        const buffer = await getAttachmentBuffer(gmailService, email.id, attachment, config.maxAttachmentBytes);
        const xmlAnalysis = isXml(attachment) ? analyzeFiscalXml(buffer) : null;
        if (xmlAnalysis?.fiscal) confirmedXml = true;
        inspected.push({ attachment, buffer, xmlAnalysis, sha256: hashBuffer(buffer) });
      }

      if (!classification.fiscal && !confirmedXml) {
        await processedService.add(buildRecord(email, "IGNORED", classification, [], 0));
        logger.ignored("Mensagem sem sinais fiscais suficientes", { messageId, score: classification.score });
        return;
      }

      const selected = [];
      for (const item of inspected) {
        if (!(item.xmlAnalysis?.fiscal || isFiscalFilename(item.attachment.filename))) continue;
        if (selected.some((candidate) => candidate.sha256 === item.sha256)) continue;
        const existing = processedService.findAttachmentByHash(item.sha256);
        if (existing) {
          if (existing.path) { selected.push(existing); continue; }
        }
        const savedPath = await saveAttachment({ buffer: item.buffer, downloadDir: config.downloadDir,
          messageId: email.id, filename: item.attachment.filename, date: safeDate(email.date) });
        const attachment = { filename: path.basename(savedPath), path: savedPath,
          mimeType: item.attachment.mimeType, sha256: item.sha256,
          fiscalXml: item.xmlAnalysis?.fiscal ? item.xmlAnalysis : undefined };
        saved.push(attachment); selected.push(attachment);
        logger.downloaded("Documento fiscal salvo", { messageId, filename: attachment.filename, sha256: item.sha256 });
      }

      if (selected.length === 0) {
        await processedService.add(buildRecord(email, "IGNORED", classification, [], 0, "classificado, mas sem anexo fiscal aceito"));
        logger.warn("Mensagem fiscal sem anexo fiscal aceito", { messageId, score: classification.score });
        return;
      }
      const type = inspected.find((item) => item.xmlAnalysis?.fiscal)?.xmlAnalysis.type;
      await processedService.add(buildRecord(email, "PROCESSED", classification, selected, 0,
        confirmedXml ? `XML fiscal confirmado${type ? ` (${type})` : ""}` : undefined));
      if (telegramService.enabled) processedService.enqueueTelegram(email.id, selected.map((item) => item.sha256));
      state.processed += 1;
      logger.fiscal("Mensagem fiscal processada", { messageId, score: classification.score, attachments: selected.length });
    } catch (error) {
      const outcome = await processedService.recordError({ messageId, threadId: email?.threadId ?? null,
        processedAt: new Date().toISOString(), score: classification.score, reason: error.message,
        attachments: saved, subject: email?.subject, sender: email?.from, emailDate: email?.date },
      { maxAttempts: config.processingMaxAttempts, baseDelayMs: config.retryBaseDelayMs });
      logger.error("Falha ao processar mensagem", { messageId, attempt: outcome.attempts,
        terminal: outcome.terminal, error: error.message });
    }
  };

  const run = async () => {
    if (running || stopping) return;
    if (!processedService.acquireLease("email-job", owner, config.jobTimeoutMs + 60_000)) {
      logger.warn("Outra instância mantém o lock da verificação"); return;
    }
    running = true; state.running = true; state.lastStartedAt = new Date().toISOString();
    const deadline = Date.now() + config.jobTimeoutMs;
    try {
      const listed = await gmailService.listMessageIds({ query: config.gmailQuery, maxResults: config.gmailMaxResults });
      const ids = [...new Set([...processedService.getDueRetryMessageIds(), ...listed.map((item) => item.id)])];
      for (const messageId of ids) {
        if (stopping || Date.now() >= deadline) throw new Error("Tempo máximo da verificação excedido");
        if (!processedService.hasMessage(messageId)) await processMessage(messageId);
      }
      await processTelegramQueue();
      const removed = await processedService.cleanupAttachments(config.attachmentRetentionDays);
      if (removed) logger.info("Retenção removeu anexos antigos", { removed });
      state.lastSuccessAt = new Date().toISOString(); state.lastError = null;
    } catch (error) {
      state.lastError = error.message;
      logger.error("Falha na verificação do Gmail", { error: error.message });
    } finally {
      running = false; state.running = false;
      processedService.releaseLease("email-job", owner);
    }
  };

  return { run, stop: () => { stopping = true; }, isRunning: () => running,
    getHealth: () => ({ ...state, stats: processedService.getStats() }) };
};

const buildRecord = (email, status, classification, attachments, attempts, reason) => ({
  messageId: email.id, threadId: email.threadId, processedAt: new Date().toISOString(), status,
  score: classification.score, reason: reason ?? classification.reasons.join(", "), attachments,
  attempts, nextRetryAt: null, subject: email.subject, sender: email.from, emailDate: email.date,
});
