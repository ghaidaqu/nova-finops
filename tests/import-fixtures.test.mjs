// Realistic exports from Saudi banks, gateways, stores, POS, delivery apps and accounting
// systems (tests/fixtures/imports, ground truth in manifest.json), read the way the browser
// does: detect the sheet and header row, guess the kind and columns, then parse the rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import readXlsxFile from "read-excel-file/node";
import { bestSheet, decodeText, guessKind, guessMapping, parseCsv, toRows, toTable } from "../lib/parse-file.ts";

const dir = new URL("./fixtures/imports/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));

async function load(entry) {
  const bytes = readFileSync(new URL(entry.file, dir));
  const sheets = /\.xlsx$/i.test(entry.file) ? (await readXlsxFile(bytes)).map((s) => ({ name: s.sheet, cells: s.data })) : [{ name: entry.file, cells: parseCsv(decodeText(new Uint8Array(bytes))) }];
  const table = toTable(sheets[bestSheet(sheets)].cells);
  const kind = guessKind(entry.upload, table.headers);
  const mapping = guessMapping(table.headers, kind, table.rows);
  return { table, kind, mapping, ...toRows(table, mapping) };
}

const key = (r) => `${r.date}|${Number(r.amount).toFixed(2)}`;

for (const entry of manifest) {
  test(`${entry.file} (${entry.system})`, async () => {
    const { table, kind, mapping, rows } = await load(entry);
    const named = Object.fromEntries(Object.entries(mapping).map(([f, i]) => [f, table.headers[i]]));
    for (const [field, header] of Object.entries(entry.expect)) assert.equal(named[field], header, `${field} column`);
    assert.equal(kind, entry.kind, "kind");
    assert.deepEqual(rows.map(key).sort(), entry.truth.map(key).sort(), "rows (date|amount)");
  });
}

test("gateway fee includes the VAT charged on it", async () => {
  const { rows } = await load(manifest.find((e) => e.file === "gateway_moyasar.csv"));
  assert.equal(rows[0].fee, 6.76);
});
