import test from "node:test";
import assert from "node:assert/strict";
import { decodeBase64Url, hasAccessKey, sanitizeFilename } from "../src/utils/text.js";

test("sanitizeFilename impede traversal e caracteres perigosos", () => {
  assert.equal(sanitizeFilename("../../nota:123?.xml"), "nota_123_.xml");
  assert.equal(sanitizeFilename(".."), "anexo-sem-nome");
});

test("decodeBase64Url decodifica o formato do Gmail", () => {
  assert.equal(decodeBase64Url("bm90YSBmaXNjYWw").toString(), "nota fiscal");
});

test("hasAccessKey exige exatamente uma sequência de 44 dígitos", () => {
  assert.equal(hasAccessKey(`chave ${"1".repeat(44)} fim`), true);
  assert.equal(hasAccessKey("1".repeat(43)), false);
});
