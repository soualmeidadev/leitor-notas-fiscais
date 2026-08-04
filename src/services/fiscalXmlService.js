import { XMLParser, XMLValidator } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

const asArray = (value) => (Array.isArray(value) ? value : [value]);

const findFirst = (node, keys) => {
  if (!node || typeof node !== "object") return null;
  const normalizedKeys = keys.map((key) => key.toLowerCase());

  for (const [key, value] of Object.entries(node)) {
    if (normalizedKeys.includes(key.toLowerCase()) && value !== undefined && value !== null) {
      if (typeof value !== "object") return String(value);
    }
  }
  for (const value of Object.values(node)) {
    for (const child of asArray(value)) {
      const found = findFirst(child, keys);
      if (found !== null) return found;
    }
  }
  return null;
};

const findObject = (node, keys) => {
  if (!node || typeof node !== "object") return null;
  const normalizedKeys = keys.map((key) => key.toLowerCase());
  for (const [key, value] of Object.entries(node)) {
    if (normalizedKeys.includes(key.toLowerCase())) return value;
  }
  for (const value of Object.values(node)) {
    for (const child of asArray(value)) {
      const found = findObject(child, keys);
      if (found) return found;
    }
  }
  return null;
};

const detectType = (document) => {
  const rootNames = Object.keys(document).map((key) => key.toLowerCase());
  const allNames = JSON.stringify(document).toLowerCase();
  if (rootNames.some((name) => ["nfeproc", "nfe"].includes(name))) return "NFE";
  if (rootNames.some((name) => ["cteproc", "cte"].includes(name))) return "CTE";
  if (rootNames.some((name) => ["compnfse", "nfs-e", "consultarnfseresposta"].includes(name))) return "NFSE";
  if (allNames.includes('"compnfse"') || allNames.includes('"infonfse"')) return "NFSE";
  return "UNKNOWN";
};

const digits = (value) => value ? String(value).replace(/\D/g, "") || null : null;
const field = (scope, names) => findFirst(scope, names);

export const analyzeFiscalXml = (xmlBuffer) => {
  const emptyResult = {
    validXml: false,
    fiscal: false,
    type: "UNKNOWN",
    accessKey: null,
    invoiceNumber: null,
    issuerCnpj: null,
    recipientCnpj: null,
    totalValue: null,
    issueDate: null,
  };

  try {
    const xml = Buffer.isBuffer(xmlBuffer) ? xmlBuffer.toString("utf8") : String(xmlBuffer);
    if (XMLValidator.validate(xml) !== true) return emptyResult;
    const document = parser.parse(xml);
    const type = detectType(document);
    const info = findObject(document, type === "CTE" ? ["infCte"] : ["infNFe", "infNfse"]) ?? document;
    const issuer = findObject(document, ["emit", "prestadorServico", "identificacaoPrestador"]);
    const recipient = findObject(document, ["dest", "tomadorServico", "identificacaoTomador"]);
    const rawId = field(info, ["Id", "id"]);
    const keyFromId = rawId?.match(/\d{44}/)?.[0] ?? null;

    return {
      validXml: true,
      fiscal: type !== "UNKNOWN",
      type,
      accessKey: keyFromId ?? field(document, ["chNFe", "chCTe", "chaveAcesso"]),
      invoiceNumber: field(info, ["nNF", "nCT", "numeroNfse", "numero"]),
      issuerCnpj: digits(field(issuer, ["CNPJ", "CpfCnpj"])),
      recipientCnpj: digits(field(recipient, ["CNPJ", "CpfCnpj"])),
      totalValue: field(info, ["vNF", "vTPrest", "valorServicos", "valorLiquidoNfse"]),
      issueDate: field(info, ["dhEmi", "dEmi", "dataEmissao"]),
    };
  } catch {
    return emptyResult;
  }
};
