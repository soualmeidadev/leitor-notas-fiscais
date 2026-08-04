import path from "node:path";
import { getAttachmentBuffer, hashBuffer, saveAttachment } from "../services/attachmentService.js";
import { classifyEmail, isFiscalFilename } from "../services/emailClassifier.js";
import { parseEmail } from "../services/emailParser.js";
import { analyzeFiscalXml } from "../services/fiscalXmlService.js";
import { logger } from "../utils/logger.js";

const isAccepted = (attachment) => [".xml", ".pdf"].includes(
  path.extname(attachment.filename).toLowerCase(),
) || /^(?:application|text)\/xml/i.test(attachment.mimeType)
  || attachment.mimeType === "application/pdf";
const isXml = (attachment) => path.extname(attachment.filename).toLowerCase() === ".xml"
  || /(?:application|text)\/xml/i.test(attachment.mimeType);

const safeDate = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const createEmailJob = ({ gmailService, processedService, config }) => {
  let running = false;

  const run = async () => {
    if (running) {
      logger.warn("Verificação anterior ainda em execução; nova execução ignorada");
      return;
    }
    running = true;
    logger.info("Iniciando verificação do Gmail");

    try {
      const messageRefs = await gmailService.listMessageIds({
        query: config.gmailQuery,
        maxResults: config.gmailMaxResults,
      });
      logger.info(`${messageRefs.length} mensagens candidatas encontradas`);

      for (const reference of messageRefs) {
        if (processedService.hasMessage(reference.id)) {
          logger.info(`Mensagem ${reference.id} já processada; ignorada`);
          continue;
        }
        await processMessage(reference.id);
      }
    } catch (error) {
      logger.error(`Falha na verificação do Gmail: ${error.message}`);
    } finally {
      running = false;
    }
  };

  const processMessage = async (messageId) => {
    let email;
    let classification = { score: 0, reasons: [] };
    const downloaded = [];
    try {
      email = parseEmail(await gmailService.getMessage(messageId));
      classification = classifyEmail(email);
      const inspected = [];
      let confirmedXml = false;

      for (const attachment of email.attachments.filter(isAccepted)) {
        const buffer = await getAttachmentBuffer(gmailService, email.id, attachment);
        const xmlAnalysis = isXml(attachment) ? analyzeFiscalXml(buffer) : null;
        if (xmlAnalysis?.fiscal) confirmedXml = true;
        inspected.push({ attachment, buffer, xmlAnalysis, sha256: hashBuffer(buffer) });
      }

      if (!classification.fiscal && !confirmedXml) {
        const reason = classification.reasons.join(", ") || "sem sinais fiscais suficientes";
        logger.ignored(`${email.subject} — score ${classification.score}`);
        await processedService.add(buildRecord(email, "IGNORED", classification.score, reason, []));
        return;
      }

      for (const item of inspected) {
        const fiscalAttachment = item.xmlAnalysis?.fiscal
          || (isFiscalFilename(item.attachment.filename) && isAccepted(item.attachment));
        const duplicateInMessage = downloaded.some((attachment) => attachment.sha256 === item.sha256);
        if (!fiscalAttachment || duplicateInMessage || processedService.hasHash(item.sha256)) continue;

        const savedPath = await saveAttachment({
          buffer: item.buffer,
          downloadDir: config.downloadDir,
          messageId: email.id,
          filename: item.attachment.filename,
          date: safeDate(email.date),
        });
        downloaded.push({
          filename: path.basename(savedPath),
          path: savedPath,
          mimeType: item.attachment.mimeType,
          sha256: item.sha256,
          fiscalXml: item.xmlAnalysis?.fiscal ? item.xmlAnalysis : undefined,
        });
        logger.downloaded(path.basename(savedPath));
      }

      const type = inspected.find((item) => item.xmlAnalysis?.fiscal)?.xmlAnalysis.type;
      const reason = confirmedXml
        ? `XML fiscal confirmado${type ? ` (${type})` : ""}`
        : classification.reasons.join(", ");
      logger.fiscal(`${email.subject} — score ${classification.score}`);
      await processedService.add(buildRecord(email, "PROCESSED", classification.score, reason, downloaded));
    } catch (error) {
      logger.error(`Falha ao processar mensagem ${messageId}: ${error.message}`);
      try {
        await processedService.add({
          messageId,
          threadId: email?.threadId ?? null,
          processedAt: new Date().toISOString(),
          status: "ERROR",
          score: classification.score,
          reason: error.message,
          attachments: downloaded,
        });
      } catch (writeError) {
        logger.error(`Falha ao registrar erro da mensagem ${messageId}: ${writeError.message}`);
      }
    }
  };

  return { run };
};

const buildRecord = (email, status, score, reason, attachments) => ({
  messageId: email.id,
  threadId: email.threadId,
  processedAt: new Date().toISOString(),
  status,
  score,
  reason,
  attachments,
});
