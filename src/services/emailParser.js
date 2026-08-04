import { decodeBase64Url } from "../utils/text.js";

const getHeader = (headers, name) => headers
  .find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

const stripHtml = (html) => String(html)
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim();

const walkParts = (part, result) => {
  if (!part) return;
  const originalFilename = part.filename?.trim();
  const attachmentId = part.body?.attachmentId;

  if (originalFilename || attachmentId) {
    const inferredExtension = /xml/i.test(part.mimeType) ? ".xml"
      : part.mimeType === "application/pdf" ? ".pdf" : "";
    result.attachments.push({
      filename: originalFilename || `anexo-sem-nome${inferredExtension}`,
      mimeType: part.mimeType || "application/octet-stream",
      attachmentId: attachmentId ?? null,
      inlineData: attachmentId ? null : part.body?.data ?? null,
      size: part.body?.size ?? 0,
    });
  } else if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data).toString("utf8");
    if (part.mimeType === "text/plain") result.plainBodies.push(decoded);
    if (part.mimeType === "text/html") result.htmlBodies.push(stripHtml(decoded));
  }

  for (const child of part.parts ?? []) walkParts(child, result);
};

export const parseEmail = (message) => {
  const result = { attachments: [], plainBodies: [], htmlBodies: [] };
  walkParts(message.payload, result);
  const headers = message.payload?.headers ?? [];
  const body = (result.plainBodies.length ? result.plainBodies : result.htmlBodies)
    .join("\n")
    .slice(0, 200_000);

  return {
    id: message.id,
    threadId: message.threadId,
    subject: getHeader(headers, "Subject") || "(sem assunto)",
    from: getHeader(headers, "From"),
    date: getHeader(headers, "Date"),
    body,
    snippet: message.snippet ?? "",
    attachments: result.attachments,
  };
};
