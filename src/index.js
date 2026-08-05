import cron from "node-cron";
import { createOAuthClient } from "./config/gmail.js";
import { loadConfig } from "./config/env.js";
import { createEmailJob } from "./jobs/emailJob.js";
import { createGmailService } from "./services/gmailService.js";
import { createHealthServer } from "./services/healthService.js";
import { ProcessedEmailService } from "./services/processedEmailService.js";
import { createTelegramService } from "./services/telegramService.js";
import { configureLogger, logger } from "./utils/logger.js";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const main = async () => {
  const config = loadConfig();
  configureLogger({ format: config.logFormat });
  if (!cron.validate(config.emailCheckCron)) throw new Error(`EMAIL_CHECK_CRON inválido: ${config.emailCheckCron}`);

  const auth = await createOAuthClient({ credentialsPath: config.credentialsPath, tokenPath: config.tokenPath });
  const processedService = new ProcessedEmailService(config.databasePath,
    { legacyJsonPath: config.legacyProcessedEmailsFile });
  await processedService.initialize();
  const job = createEmailJob({ gmailService: createGmailService(auth), processedService,
    telegramService: createTelegramService(config.telegram), config });
  const healthServer = createHealthServer({ port: config.healthPort, getHealth: job.getHealth });

  await job.run();
  const schedule = cron.schedule(config.emailCheckCron, () => job.run());
  logger.info("Monitor agendado", { cron: config.emailCheckCron, healthPort: config.healthPort });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true; job.stop(); schedule.stop();
    logger.info("Encerramento gracioso iniciado", { signal });
    const deadline = Date.now() + 30_000;
    while (job.isRunning() && Date.now() < deadline) await wait(250);
    await new Promise((resolve) => healthServer?.close(resolve) ?? resolve());
    processedService.close();
  };
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
    shutdown(signal).then(() => process.exit(0)).catch(() => process.exit(1));
  });
};

main().catch((error) => { logger.error("Falha fatal", { error: error.message }); process.exitCode = 1; });
