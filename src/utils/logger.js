let jsonOutput = true;

export const configureLogger = ({ format = "json" } = {}) => { jsonOutput = format === "json"; };

const write = (level, message, fields = {}) => {
  const safeMessage = String(message).replace(/[\r\n]+/g, " ");
  if (jsonOutput) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message: safeMessage, ...fields }));
  } else console.log(`[${level}] ${safeMessage}`);
};

export const logger = {
  info: (message, fields) => write("INFO", message, fields),
  ignored: (message, fields) => write("IGNORED", message, fields),
  fiscal: (message, fields) => write("FISCAL", message, fields),
  downloaded: (message, fields) => write("DOWNLOADED", message, fields),
  error: (message, fields) => write("ERROR", message, fields),
  warn: (message, fields) => write("WARN", message, fields),
};
