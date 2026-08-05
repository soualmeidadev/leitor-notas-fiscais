import { google } from "googleapis";

const TEMPORARY_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const withRetry = async (operation, attempts = 4) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = error.response?.status ?? error.code;
      if (!TEMPORARY_STATUS.has(Number(status)) || attempt === attempts - 1) throw error;
      await sleep(Math.min(1_000 * (2 ** attempt), 8_000) + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
};

export const createGmailService = (auth) => {
  const gmail = google.gmail({ version: "v1", auth });

  return {
    async listMessageIds({ query, maxResults }) {
      const messages = [];
      let pageToken;
      do {
        const response = await withRetry(() => gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: Math.min(maxResults, 500),
          pageToken,
        }, { timeout: 30_000 }));
        messages.push(...(response.data.messages ?? []));
        pageToken = response.data.nextPageToken;
      } while (pageToken);
      return messages;
    },

    async getMessage(messageId) {
      const response = await withRetry(() => gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      }, { timeout: 30_000 }));
      return response.data;
    },

    async getAttachment(messageId, attachmentId) {
      const response = await withRetry(() => gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: attachmentId,
      }, { timeout: 30_000 }));
      return response.data.data;
    },
  };
};
