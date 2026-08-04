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

export const loadConfig = () => ({
  credentialsPath: path.resolve(required("GMAIL_CREDENTIALS_PATH", "credentials.json")),
  tokenPath: path.resolve(required("GMAIL_TOKEN_PATH", "tokens/token.json")),
  gmailQuery: required("GMAIL_QUERY", "in:inbox newer_than:7d has:attachment"),
  gmailMaxResults: positiveInteger("GMAIL_MAX_RESULTS", "100"),
  emailCheckCron: required("EMAIL_CHECK_CRON", "*/2 * * * *"),
  downloadDir: path.resolve(required("DOWNLOAD_DIR", "downloads")),
  processedEmailsFile: path.resolve(required("PROCESSED_EMAILS_FILE", "data/processed-emails.json")),
});
