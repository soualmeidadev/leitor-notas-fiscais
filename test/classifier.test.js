import test from "node:test";
import assert from "node:assert/strict";
import { classifyEmail } from "../src/services/emailClassifier.js";

const email = (overrides = {}) => ({ subject: "", body: "", snippet: "", from: "",
  attachments: [], ...overrides });

test("aceita contexto fiscal forte com PDF", () => {
  const result = classifyEmail(email({ subject: "NF-e disponível",
    attachments: [{ filename: "danfe.pdf", mimeType: "application/pdf" }] }));
  assert.equal(result.fiscal, true);
});

test("não aceita PDF genérico isolado", () => {
  const result = classifyEmail(email({ subject: "Relatório mensal",
    attachments: [{ filename: "relatorio.pdf", mimeType: "application/pdf" }] }));
  assert.equal(result.fiscal, false);
});
