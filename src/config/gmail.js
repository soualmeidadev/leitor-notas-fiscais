import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const readJson = async (filePath, label) => {
  try {
    const stat = await fs.stat(filePath);
    if ((stat.mode & 0o077) !== 0) await fs.chmod(filePath, 0o600);
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} não encontrado em ${filePath}`);
    }
    throw new Error(`Não foi possível ler ${label}: ${error.message}`);
  }
};

export const getOAuthClientDefinition = async (credentialsPath) => {
  const credentials = await readJson(credentialsPath, "Arquivo de credenciais OAuth");
  const definition = credentials.installed ?? credentials.web;

  if (!definition?.client_id || !definition?.client_secret) {
    throw new Error("credentials.json inválido: client_id/client_secret ausentes");
  }

  const redirectUri = definition.redirect_uris?.[0] ?? "http://localhost";
  return { definition, redirectUri };
};

export const createOAuthClient = async ({ credentialsPath, tokenPath, requireToken = true }) => {
  const { definition, redirectUri } = await getOAuthClientDefinition(credentialsPath);
  const client = new google.auth.OAuth2(
    definition.client_id,
    definition.client_secret,
    redirectUri,
  );

  if (requireToken) {
    const token = await readJson(tokenPath, "Token OAuth");
    client.setCredentials(token);
    client.on("tokens", async (newTokens) => {
      if (!newTokens.refresh_token) return;
      const mergedToken = { ...token, ...newTokens };
      await fs.mkdir(path.dirname(tokenPath), { recursive: true });
      await fs.writeFile(tokenPath, `${JSON.stringify(mergedToken, null, 2)}\n`, { mode: 0o600 });
    });
  }

  return client;
};
