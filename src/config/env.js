import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (!String(value ?? "").trim()) throw new Error(`Configuração obrigatória ausente: ${name}`);
  return String(value).trim();
};

const positiveInteger = (name, fallback) => {
  const value = Number(required(name, fallback));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} deve ser um inteiro positivo`);
  return value;
};

const booleanValue = (name, fallback = "false") => {
  const value = required(name, fallback).toLowerCase();
  if (!["true", "false"].includes(value)) throw new Error(`${name} deve ser true ou false`);
  return value === "true";
};

export const loadConfig = () => {
  const telegramEnabled = booleanValue("TELEGRAM_ENABLED");
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const telegramChatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
  if (telegramEnabled && (!telegramBotToken || !telegramChatId)) {
    throw new Error("TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID são obrigatórios quando TELEGRAM_ENABLED=true");
  }

  return {
    credentialsPath: path.resolve(required("GMAIL_CREDENTIALS_PATH", "credentials.json")),
    tokenPath: path.resolve(required("GMAIL_TOKEN_PATH", "tokens/token.json")),
    gmailQuery: required("GMAIL_QUERY", "in:inbox newer_than:7d has:attachment"),
    gmailMaxResults: positiveInteger("GMAIL_MAX_RESULTS", "100"),
    emailCheckCron: required("EMAIL_CHECK_CRON", "*/30 * * * * *"),
    downloadDir: path.resolve(required("DOWNLOAD_DIR", "downloads")),
    processedEmailsFile: path.resolve(required("PROCESSED_EMAILS_FILE", "data/processed-emails.json")),
    telegram: {
      enabled: telegramEnabled,
      botToken: telegramBotToken,
      chatId: telegramChatId,
    },
  };
};
