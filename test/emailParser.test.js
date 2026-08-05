import test from "node:test";
import assert from "node:assert/strict";
import { parseEmail } from "../src/services/emailParser.js";

const encoded = (text) => Buffer.from(text).toString("base64url");

test("interpreta MIME aninhado, HTML e anexo sem nome", () => {
  const parsed = parseEmail({ id: "m1", threadId: "t1", snippet: "trecho", payload: {
    headers: [{ name: "Subject", value: "NF-e" }], parts: [{ mimeType: "multipart/alternative", parts: [
      { mimeType: "text/html", body: { data: encoded("<b>Nota&nbsp;fiscal</b>") } },
      { mimeType: "application/pdf", filename: "", body: { attachmentId: "a1", size: 10 } },
    ] }],
  } });
  assert.equal(parsed.body, "Nota fiscal");
  assert.equal(parsed.attachments[0].filename, "anexo-sem-nome.pdf");
});
