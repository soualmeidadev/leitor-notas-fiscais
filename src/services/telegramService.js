import fs from "node:fs/promises";

const TEMPORARY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const truncate = (value, length) => {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

const parseSender = (from) => {
  const value = String(from ?? "").trim();
  const match = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(value)) return { name: "", email: value };
  return { name: value, email: "" };
};

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number)) return truncate(value, 60);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(number);
};

const formatDate = (value) => {
  if (!value) return "";
  const text = String(value);
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return truncate(value, 60);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
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
  const sender = parseSender(email.from);
  const lines = ["🧾 Nova nota fiscal", ""];
  if (sender.name) lines.push(`🏢 Remetente: ${truncate(sender.name, 140)}`);
  if (sender.email) lines.push(`📧 ${truncate(sender.email, 160)}`);
  if (fiscalXml?.type && fiscalXml.type !== "UNKNOWN") lines.push(`📄 Tipo: ${fiscalXml.type.replace("NFE", "NF-e").replace("NFSE", "NFS-e").replace("CTE", "CT-e")}`);
  if (fiscalXml?.invoiceNumber) lines.push(`🔢 Número: ${truncate(fiscalXml.invoiceNumber, 60)}`);
  if (fiscalXml?.totalValue) lines.push(`💰 Valor: ${formatCurrency(fiscalXml.totalValue)}`);
  if (fiscalXml?.issueDate) lines.push(`📅 Emissão: ${formatDate(fiscalXml.issueDate)}`);
  if (attachments.length) {
    lines.push("");
    for (const attachment of attachments) lines.push(`📎 ${truncate(attachment.filename, 160)}`);
  }
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
