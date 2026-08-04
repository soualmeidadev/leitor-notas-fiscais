import fs from "node:fs/promises";

const TEMPORARY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const truncate = (value, length) => {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

const requestTelegram = async (url, options, attempts = 3) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) return result.result;

      const error = new Error(result.description || `Telegram respondeu HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfter = Number(result.parameters?.retry_after) || null;
      throw error;
    } catch (error) {
      lastError = error;
      const temporary = TEMPORARY_STATUS.has(error.status) || error.name === "TimeoutError"
        || error.name === "TypeError";
      if (!temporary || attempt === attempts - 1) throw error;
      const delay = error.retryAfter ? error.retryAfter * 1_000 : 1_000 * (2 ** attempt);
      await sleep(Math.min(delay, 10_000));
    }
  }
  throw lastError;
};

const buildNotice = (email, attachments) => {
  const fiscalXml = attachments.find((item) => item.fiscalXml)?.fiscalXml;
  const lines = [
    "🧾 Nova nota fiscal recebida",
    "",
    `Assunto: ${truncate(email.subject, 180)}`,
    `Remetente: ${truncate(email.from, 160) || "não informado"}`,
    `Data: ${truncate(email.date, 80) || "não informada"}`,
    `Tipo: ${fiscalXml?.type ?? "documento fiscal"}`,
  ];
  if (fiscalXml?.invoiceNumber) lines.push(`Número: ${truncate(fiscalXml.invoiceNumber, 60)}`);
  if (fiscalXml?.totalValue) lines.push(`Valor informado: ${truncate(fiscalXml.totalValue, 60)}`);
  lines.push(`Anexos: ${attachments.length}`);
  return lines.join("\n");
};

export const createTelegramService = ({ enabled, botToken, chatId }) => {
  if (!enabled) {
    return { enabled: false, notifyFiscalEmail: async () => ({ status: "DISABLED", sentDocuments: 0 }) };
  }

  const endpoint = (method) => `https://api.telegram.org/bot${botToken}/${method}`;

  return {
    enabled: true,
    async notifyFiscalEmail(email, attachments) {
      await requestTelegram(endpoint("sendMessage"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: buildNotice(email, attachments),
          protect_content: true,
        }),
      });

      let sentDocuments = 0;
      for (const attachment of attachments) {
        const buffer = await fs.readFile(attachment.path);
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("protect_content", "true");
        form.append("document", new Blob([buffer], { type: attachment.mimeType }), attachment.filename);
        await requestTelegram(endpoint("sendDocument"), { method: "POST", body: form });
        sentDocuments += 1;
      }

      return { status: "SENT", sentDocuments, sentAt: new Date().toISOString() };
    },
  };
};
