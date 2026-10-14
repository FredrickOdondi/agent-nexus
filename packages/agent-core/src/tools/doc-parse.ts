import { promises as fs } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { ToolDefinition } from "../types.js";
import { clampText } from "../util/fs.js";
import "../util/polyfills.js";

interface DocParseArgs {
  path: string;
  page?: number;
  max_pages?: number;
  sheet?: string;
  format?: "markdown" | "json" | "text";
  max_rows?: number;
}

const MAX_OUTPUT = 40_000;

export const docParseTool: ToolDefinition<DocParseArgs> = {
  id: "doc_parse",
  title: "doc_parse",
  category: "workflow",
  description: [
    "Extract and inspect structured text, tables, and metadata from documents without opening visual apps.",
    "Supported formats:",
    "- PDF (.pdf): Extracts full text, page counts, metadata, or specific pages.",
    "- Spreadsheets (.xlsx, .xls, .csv, .tsv): Extracts sheets as Markdown tables or JSON.",
    "- Word documents (.docx): Extracts clean text, headings, and tables.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the document (.pdf, .xlsx, .docx, .csv)." },
      page: { type: "number", description: "Specific 1-indexed page number to extract for PDFs." },
      max_pages: { type: "number", description: "Max pages to extract from PDF (default 50)." },
      sheet: { type: "string", description: "Name of the sheet to inspect in spreadsheets. If omitted, uses the first sheet." },
      format: { type: "string", enum: ["markdown", "json", "text"], description: "Output format for spreadsheets/tables (default 'markdown')." },
      max_rows: { type: "number", description: "Max rows to return for spreadsheets/tables (default 100)." },
    },
    required: ["path"],
  },
  permission: "Read",
  readOnly: true,
  summarize: (a) => `parse ${path.basename(a.path ?? "")}`,
  permissionSubject: (a) => a.path,
  async execute(args, ctx) {
    const rawPath = args.path;
    if (!rawPath) return { output: "doc_parse requires a `path` parameter.", isError: true };

    const target = path.resolve(ctx.cwd, rawPath);
    let buf: Buffer;
    try {
      buf = await fs.readFile(target);
    } catch (e) {
      return { output: `Could not read file at ${target}: ${(e as Error).message}`, isError: true };
    }

    const ext = path.extname(target).toLowerCase();

    // 1. PDF Parser
    if (ext === ".pdf") {
      try {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: buf, verbosity: 0 });
        const parseParams = args.page && args.page > 0
          ? { partial: [args.page] }
          : { first: args.max_pages ?? 50 };

        const [infoResult, textResult] = await Promise.all([
          parser.getInfo().catch(() => null),
          parser.getText(parseParams),
        ]);

        const numPages = textResult.total || textResult.pages.length || 1;
        const info = (infoResult?.info || {}) as Record<string, unknown>;
        const metaStr = [
          `Document: ${path.basename(target)} (PDF, ${numPages} page${numPages === 1 ? "" : "s"})`,
          info.Title ? `Title: ${String(info.Title)}` : null,
          info.Author ? `Author: ${String(info.Author)}` : null,
        ].filter(Boolean).join(" | ");

        if (args.page && args.page > 0) {
          const targetPage = textResult.pages.find((p) => p.num === args.page);
          if (targetPage) {
            return {
              output: `${metaStr}\n--- Page ${args.page} of ${numPages} ---\n\n${clampText(targetPage.text, MAX_OUTPUT)}`,
            };
          }
          return {
            output: `${metaStr}\nPage ${args.page} not found (document has ${numPages} pages).`,
            isError: true,
          };
        }

        return {
          output: `${metaStr}\n\n${clampText(textResult.text.trim(), MAX_OUTPUT)}`,
        };
      } catch (e) {
        return { output: `Failed to parse PDF ${path.basename(target)}: ${(e as Error).message}`, isError: true };
      }
    }

    // 2. Word (.docx) Parser
    if (ext === ".docx") {
      try {
        const result = await mammoth.extractRawText({ buffer: buf });
        const text = result.value.trim();
        return {
          output: `Document: ${path.basename(target)} (Word .docx)\n\n${clampText(text, MAX_OUTPUT)}`,
        };
      } catch (e) {
        return { output: `Failed to parse Word document ${path.basename(target)}: ${(e as Error).message}`, isError: true };
      }
    }

    // 3. Spreadsheets (.xlsx, .xls, .csv, .tsv)
    if ([".xlsx", ".xls", ".csv", ".tsv"].includes(ext)) {
      try {
        const workbook = XLSX.read(buf, { type: "buffer" });
        const sheetNames = workbook.SheetNames;
        if (!sheetNames.length) {
          return { output: `Spreadsheet ${path.basename(target)} has no sheets.` };
        }

        const sheetName = args.sheet && sheetNames.includes(args.sheet) ? args.sheet : sheetNames[0]!;
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
          return { output: `Sheet "${sheetName}" not found. Available: ${sheetNames.join(", ")}`, isError: true };
        }

        const maxRows = Math.min(500, Math.max(1, args.max_rows ?? 100));
        const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });

        const headerStr = `File: ${path.basename(target)} | Sheets: [${sheetNames.join(", ")}] | Current Sheet: "${sheetName}" (${rows.length} total rows)`;

        if (rows.length === 0) {
          return { output: `${headerStr}\n(Sheet is empty)` };
        }

        if (args.format === "json") {
          const jsonObjs = XLSX.utils.sheet_to_json(worksheet).slice(0, maxRows);
          return {
            output: `${headerStr}\n\n\`\`\`json\n${JSON.stringify(jsonObjs, null, 2)}\n\`\`\``,
          };
        }

        // Render as clean Markdown table
        const slice = rows.slice(0, maxRows);
        const mdTable = formatMarkdownTable(slice);
        const truncated = rows.length > maxRows ? `\n\n... and ${rows.length - maxRows} more rows.` : "";

        return {
          output: `${headerStr}\n\n${mdTable}${truncated}`,
        };
      } catch (e) {
        return { output: `Failed to parse spreadsheet ${path.basename(target)}: ${(e as Error).message}`, isError: true };
      }
    }

    return {
      output: `Unsupported file extension "${ext}". Supported: .pdf, .xlsx, .xls, .docx, .csv, .tsv.`,
      isError: true,
    };
  },
};

function formatMarkdownTable(rows: unknown[][]): string {
  if (rows.length === 0) return "";
  const header = (rows[0] || []).map((c) => String(c ?? "").trim() || "-");
  const colCount = Math.max(1, header.length);

  const lines: string[] = [];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const cells: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const val = row[c] != null ? String(row[c]).replace(/\|/g, "\\|").replace(/\r?\n/g, " ") : "";
      cells.push(val);
    }
    lines.push(`| ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}
