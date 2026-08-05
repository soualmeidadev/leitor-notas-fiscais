import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFiscalXml } from "../src/services/fiscalXmlService.js";

test("extrai campos essenciais de NF-e com namespace", () => {
  const key = "1".repeat(44);
  const result = analyzeFiscalXml(Buffer.from(`<nfeProc xmlns="x"><NFe><infNFe Id="NFe${key}"><ide><nNF>42</nNF><dhEmi>2026-08-05</dhEmi></ide><emit><CNPJ>12345678000190</CNPJ></emit><dest><CNPJ>98765432000100</CNPJ></dest><total><vNF>10.50</vNF></total></infNFe></NFe></nfeProc>`));
  assert.equal(result.fiscal, true);
  assert.equal(result.type, "NFE");
  assert.equal(result.accessKey, key);
  assert.equal(result.invoiceNumber, "42");
});

test("rejeita XML malformado", () => assert.equal(analyzeFiscalXml("<NFe>").fiscal, false));
