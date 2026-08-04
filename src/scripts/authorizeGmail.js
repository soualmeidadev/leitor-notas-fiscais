import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createOAuthClient, GMAIL_READONLY_SCOPE } from "../config/gmail.js";
import { loadConfig } from "../config/env.js";

const extractCode = (answer) => {
  const value = answer.trim();
  try {
    return new URL(value).searchParams.get("code") ?? value;
  } catch {
    return value;
  }
};

const authorize = async () => {
  const config = loadConfig();
  const client = await createOAuthClient({
    credentialsPath: config.credentialsPath,
    tokenPath: config.tokenPath,
    requireToken: false,
  });
  const authorizationUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: [GMAIL_READONLY_SCOPE],
    prompt: "consent",
  });

  console.log("\nAbra esta URL no navegador e autorize a conta Gmail desejada:\n");
  console.log(authorizationUrl);
  console.log("\nCole abaixo o código ou a URL completa exibida após a autorização.\n");

  const terminal = readline.createInterface({ input, output });
  try {
    const answer = await terminal.question("Código/URL: ");
    const code = extractCode(answer);
    if (!code) throw new Error("Código de autorização não informado");
    const { tokens } = await client.getToken(code);
    await fs.mkdir(path.dirname(config.tokenPath), { recursive: true });
    await fs.writeFile(config.tokenPath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
    console.log(`Token salvo com segurança em ${config.tokenPath}`);
  } finally {
    terminal.close();
  }
};

authorize().catch((error) => {
  console.error(`[ERROR] Falha na autorização: ${error.message}`);
  process.exitCode = 1;
});
