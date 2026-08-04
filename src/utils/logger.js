const write = (level, message) => {
  const safeMessage = String(message).replace(/[\r\n]+/g, " ");
  console.log(`[${level}] ${safeMessage}`);
};

export const logger = {
  info: (message) => write("INFO", message),
  ignored: (message) => write("IGNORED", message),
  fiscal: (message) => write("FISCAL", message),
  downloaded: (message) => write("DOWNLOADED", message),
  error: (message) => write("ERROR", message),
  warn: (message) => write("WARN", message),
};
