import path from "node:path";
import { hasAccessKey, normalizeText } from "../utils/text.js";

const fiscalTerms = /\b(nota fiscal|nfs?e|nfs-e|danfe|ct-?e|documento fiscal|chave de acesso)\b/;
const subjectAcronyms = /\b(nf-?e|nfe|nfs-?e|nfse|danfe|ct-?e|cte)\b/;
const fiscalFilename = /(?:^|[^a-z])(nota|nfe|nfse|danfe|cte|fiscal)(?:[^a-z]|$)/;

export const isFiscalFilename = (filename) => fiscalFilename.test(normalizeText(filename));

export const DEFAULT_CLASSIFICATION_WEIGHTS = {
  subjectTerm: 40, subjectAcronym: 35, bodyTerm: 15, accessKey: 50,
  xml: 40, pdf: 10, fiscalFilename: 25,
};

export const classifyEmail = (email, options = {}) => {
  const weights = { ...DEFAULT_CLASSIFICATION_WEIGHTS, ...(options.weights ?? {}) };
  const threshold = options.threshold ?? 60;
  const subject = normalizeText(email.subject);
  const text = normalizeText(`${email.subject} ${email.body} ${email.snippet} ${email.from}`);
  let score = 0;
  const reasons = [];

  if (subject.includes("nota fiscal")) { score += weights.subjectTerm; reasons.push("assunto menciona nota fiscal"); }
  if (subjectAcronyms.test(subject)) { score += weights.subjectAcronym; reasons.push("assunto contém sigla fiscal"); }
  if (fiscalTerms.test(normalizeText(`${email.body} ${email.snippet} ${email.from}`))) {
    score += weights.bodyTerm; reasons.push("texto contém termos fiscais");
  }
  if (hasAccessKey(`${email.subject} ${email.body} ${email.snippet}`)) {
    score += weights.accessKey; reasons.push("possível chave de acesso");
  }

  const hasXml = email.attachments.some((item) => path.extname(item.filename).toLowerCase() === ".xml"
    || /xml/i.test(item.mimeType));
  const hasPdf = email.attachments.some((item) => path.extname(item.filename).toLowerCase() === ".pdf"
    || item.mimeType === "application/pdf");
  if (hasXml) { score += weights.xml; reasons.push("possui XML"); }
  if (hasPdf) { score += weights.pdf; reasons.push("possui PDF"); }
  if (email.attachments.some((item) => isFiscalFilename(item.filename))) {
    score += weights.fiscalFilename; reasons.push("nome de anexo fiscal");
  }

  return { score, fiscal: score >= threshold, confirmed: false, reasons };
};
