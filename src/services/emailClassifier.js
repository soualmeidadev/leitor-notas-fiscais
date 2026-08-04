import path from "node:path";
import { hasAccessKey, normalizeText } from "../utils/text.js";

const fiscalTerms = /\b(nota fiscal|nfs?e|nfs-e|danfe|ct-?e|documento fiscal|chave de acesso)\b/;
const subjectAcronyms = /\b(nf-?e|nfe|nfs-?e|nfse|danfe|ct-?e|cte)\b/;
const fiscalFilename = /(?:^|[^a-z])(nota|nfe|nfse|danfe|cte|fiscal)(?:[^a-z]|$)/;

export const isFiscalFilename = (filename) => fiscalFilename.test(normalizeText(filename));

export const classifyEmail = (email) => {
  const subject = normalizeText(email.subject);
  const text = normalizeText(`${email.subject} ${email.body} ${email.snippet} ${email.from}`);
  let score = 0;
  const reasons = [];

  if (subject.includes("nota fiscal")) { score += 40; reasons.push("assunto menciona nota fiscal"); }
  if (subjectAcronyms.test(subject)) { score += 35; reasons.push("assunto contém sigla fiscal"); }
  if (fiscalTerms.test(normalizeText(`${email.body} ${email.snippet} ${email.from}`))) {
    score += 15; reasons.push("texto contém termos fiscais");
  }
  if (hasAccessKey(`${email.subject} ${email.body} ${email.snippet}`)) {
    score += 50; reasons.push("possível chave de acesso");
  }

  const hasXml = email.attachments.some((item) => path.extname(item.filename).toLowerCase() === ".xml"
    || /xml/i.test(item.mimeType));
  const hasPdf = email.attachments.some((item) => path.extname(item.filename).toLowerCase() === ".pdf"
    || item.mimeType === "application/pdf");
  if (hasXml) { score += 40; reasons.push("possui XML"); }
  if (hasPdf) { score += 10; reasons.push("possui PDF"); }
  if (email.attachments.some((item) => isFiscalFilename(item.filename))) {
    score += 25; reasons.push("nome de anexo fiscal");
  }

  return { score, fiscal: score >= 60, confirmed: false, reasons };
};
