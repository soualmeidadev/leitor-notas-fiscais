import cron from "node-cron";
import { createOAuthClient } from "./config/gmail.js";
import { loadConfig } from "./config/env.js";
import { createEmailJob } from "./jobs/emailJob.js";
import { createGmailService } from "./services/gmailService.js";
import { ProcessedEmailService } from "./services/processedEmailService.js";
import { logger } from "./utils/logger.js";

const main = async () => {
  const config = loadConfig();
  if (!cron.validate(config.emailCheckCron)) {
    throw new Error(`EMAIL_CHECK_CRON inválido: ${config.emailCheckCron}`);
  }

  const auth = await createOAuthClient({
    credentialsPath: config.credentialsPath,
    tokenPath: config.tokenPath,
  });
  const processedService = new ProcessedEmailService(config.processedEmailsFile);
  await processedService.initialize();

  const job = createEmailJob({
    gmailService: createGmailService(auth),
    processedService,
    config,
  });

  await job.run();
  cron.schedule(config.emailCheckCron, () => job.run());
  logger.info(`Monitor agendado com a expressão: ${config.emailCheckCron}`);
};

main().catch((error) => {
  logger.error(error.message);
  process.exitCode = 1;
});
