import path from "node:path";

export const normalizeText = (value = "") => String(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

export const sanitizeFilename = (filename = "") => {
  const basename = path.basename(String(filename).replace(/\\/g, "/"));
  const sanitized = basename
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);

  return sanitized || "anexo-sem-nome";
};

export const decodeBase64Url = (data = "") => Buffer.from(
  String(data).replace(/-/g, "+").replace(/_/g, "/"),
  "base64",
);

export const hasAccessKey = (text = "") => /(?:^|\D)\d{44}(?:\D|$)/.test(String(text));
