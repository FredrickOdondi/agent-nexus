import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { docParseTool } from "./doc-parse.js";

function mockCtx(cwd: string): any {
  return {
    cwd,
    session: { log: () => {} },
    signal: new AbortController().signal,
  };
}

test("docParseTool can parse CSV files into markdown tables", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-doc-"));
  const csvFile = path.join(dir, "sales.csv");
  await fs.writeFile(csvFile, "Month,Revenue,Expenses\nJan,10000,4000\nFeb,12000,5000\n", "utf8");

  const ctx = mockCtx(dir);
  const res = await docParseTool.execute({ path: "sales.csv" }, ctx);

  assert.equal(res.isError, undefined);
  assert.match(res.output, /Month \| Revenue \| Expenses/);
  assert.match(res.output, /Jan \| 10000 \| 4000/);
  assert.match(res.output, /Feb \| 12000 \| 5000/);

  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

test("docParseTool can parse Excel .xlsx files and format as JSON and Markdown", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-doc-"));
  const xlsxFile = path.join(dir, "data.xlsx");

  // Create real XLSX workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Product", "Price", "Stock"],
    ["Keyboard", 99, 15],
    ["Mouse", 49, 30],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  await fs.writeFile(xlsxFile, buf);

  const ctx = mockCtx(dir);

  // 1. Markdown test
  const mdRes = await docParseTool.execute({ path: "data.xlsx" }, ctx);
  assert.equal(mdRes.isError, undefined);
  assert.match(mdRes.output, /Inventory/);
  assert.match(mdRes.output, /Product \| Price \| Stock/);
  assert.match(mdRes.output, /Keyboard \| 99 \| 15/);

  // 2. JSON test
  const jsonRes = await docParseTool.execute({ path: "data.xlsx", format: "json" }, ctx);
  assert.equal(jsonRes.isError, undefined);
  assert.match(jsonRes.output, /"Product": "Keyboard"/);
  assert.match(jsonRes.output, /"Price": 99/);

  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});
