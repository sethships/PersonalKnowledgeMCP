/**
 * DOCX table test fixture generator.
 *
 * Creates minimal DOCX files (ZIP archives containing word/document.xml)
 * with table structures for testing the DocxTableExtractor. Uses JSZip to
 * build valid DOCX archives.
 *
 * @module tests/fixtures/documents/docx-table-fixtures
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import JSZip from "jszip";

// ── DOCX XML templates ─────────────────────────────────────────────

/** Minimal content types XML required by DOCX spec. */
const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

/** Root relationships XML. */
const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** Word relationships XML (empty). */
const WORD_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

/**
 * Wrap body XML content in the standard DOCX document.xml structure.
 *
 * @param bodyContent - XML content to place inside `<w:body>`
 * @returns Complete document.xml content
 */
function wrapDocumentXml(bodyContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml">
  <w:body>
${bodyContent}
  </w:body>
</w:document>`;
}

/**
 * Build a DOCX ZIP archive from document.xml content.
 *
 * @param documentXml - Complete document.xml content
 * @returns DOCX file as a Buffer
 */
async function buildDocx(documentXml: string): Promise<Buffer> {
  const zip = new JSZip();

  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.file("_rels/.rels", RELS_XML);
  zip.file("word/_rels/document.xml.rels", WORD_RELS_XML);
  zip.file("word/document.xml", documentXml);

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer;
}

// ── XML helper for table rows ──────────────────────────────────────

/**
 * Build a DOCX table cell (`<w:tc>`) XML element.
 *
 * @param text - Cell text content
 * @param options - Cell options (colSpan, rowSpan, isHeader)
 * @returns XML string for the cell
 */
function buildCell(
  text: string,
  options?: { colSpan?: number; rowSpan?: number }
): string {
  let tcPr = "";

  if (options?.colSpan && options.colSpan > 1) {
    tcPr += `<w:gridSpan w:val="${options.colSpan}"/>`;
  }

  if (options?.rowSpan && options.rowSpan > 1) {
    tcPr += `<w:vMerge w:val="restart"/>`;
  }

  const tcPrXml = tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : "";

  return `<w:tc>${tcPrXml}<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
}

/**
 * Build a DOCX table cell that continues a vertical merge.
 *
 * @returns XML string for a vMerge continuation cell
 */
function buildVMergeCell(): string {
  return `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`;
}

/**
 * Build a DOCX table row (`<w:tr>`) XML element.
 *
 * @param cells - Array of cell XML strings
 * @param isHeader - Whether this is a header row (tblHeader)
 * @returns XML string for the row
 */
function buildRow(cells: string[], isHeader = false): string {
  const trPr = isHeader ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
  return `<w:tr>${trPr}${cells.join("")}</w:tr>`;
}

/**
 * Build a DOCX table (`<w:tbl>`) XML element.
 *
 * @param rows - Array of row XML strings
 * @param gridCols - Number of grid columns
 * @returns XML string for the table
 */
function buildTable(rows: string[], gridCols: number): string {
  const grid = Array(gridCols)
    .fill('<w:gridCol w:w="2000"/>')
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join("")}</w:tbl>`;
}

/**
 * Escape XML special characters.
 *
 * @param text - Raw text
 * @returns XML-safe text
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Fixture generators ─────────────────────────────────────────────

/**
 * Create a simple 2-column, 3-row table DOCX.
 *
 * Layout:
 * ```
 * Name  | Age
 * Alice | 30
 * Bob   | 25
 * ```
 */
export async function createSimpleTableDocx(): Promise<Buffer> {
  const rows = [
    buildRow([buildCell("Name"), buildCell("Age")], true),
    buildRow([buildCell("Alice"), buildCell("30")]),
    buildRow([buildCell("Bob"), buildCell("25")]),
  ];

  const body = buildTable(rows, 2);
  return buildDocx(wrapDocumentXml(body));
}

/**
 * Create a DOCX with two tables separated by a paragraph.
 *
 * Layout:
 * ```
 * Table 1:
 * Product | Price
 * Widget  | 9.99
 *
 * Separator paragraph
 *
 * Table 2:
 * City   | Country
 * Paris  | France
 * ```
 */
export async function createMultiTableDocx(): Promise<Buffer> {
  const table1 = buildTable(
    [
      buildRow([buildCell("Product"), buildCell("Price")], true),
      buildRow([buildCell("Widget"), buildCell("9.99")]),
    ],
    2
  );

  const paragraph = "<w:p><w:r><w:t>Separator paragraph</w:t></w:r></w:p>";

  const table2 = buildTable(
    [
      buildRow([buildCell("City"), buildCell("Country")], true),
      buildRow([buildCell("Paris"), buildCell("France")]),
    ],
    2
  );

  const body = `${table1}\n${paragraph}\n${table2}`;
  return buildDocx(wrapDocumentXml(body));
}

/**
 * Create a DOCX with a table containing header rows marked with `<w:tblHeader>`.
 *
 * Layout:
 * ```
 * Name  | Role      | Level  (header)
 * Alice | Engineer  | Senior
 * Bob   | Designer  | Junior
 * ```
 */
export async function createWithHeadersDocx(): Promise<Buffer> {
  const rows = [
    buildRow([buildCell("Name"), buildCell("Role"), buildCell("Level")], true),
    buildRow([buildCell("Alice"), buildCell("Engineer"), buildCell("Senior")]),
    buildRow([buildCell("Bob"), buildCell("Designer"), buildCell("Junior")]),
  ];

  const body = buildTable(rows, 3);
  return buildDocx(wrapDocumentXml(body));
}

/**
 * Create a DOCX with a table containing colspan.
 *
 * Layout:
 * ```
 * Employee Details  (colspan=2)
 * Name  | Department
 * Alice | Engineering
 * ```
 */
export async function createColspanDocx(): Promise<Buffer> {
  const rows = [
    buildRow([buildCell("Employee Details", { colSpan: 2 })]),
    buildRow([buildCell("Name"), buildCell("Department")], true),
    buildRow([buildCell("Alice"), buildCell("Engineering")]),
  ];

  const body = buildTable(rows, 2);
  return buildDocx(wrapDocumentXml(body));
}

/**
 * Create a DOCX with a table containing rowspan (vertical merge).
 *
 * Layout:
 * ```
 * Category | Value | Notes
 * Group A  | 100   | OK     (Category spans 2 rows)
 *          | 200   | Done
 * Group B  | 300   | Fine
 * ```
 */
export async function createRowspanDocx(): Promise<Buffer> {
  const rows = [
    buildRow([buildCell("Category"), buildCell("Value"), buildCell("Notes")], true),
    buildRow([
      buildCell("Group A", { rowSpan: 2 }),
      buildCell("100"),
      buildCell("OK"),
    ]),
    buildRow([buildVMergeCell(), buildCell("200"), buildCell("Done")]),
    buildRow([buildCell("Group B"), buildCell("300"), buildCell("Fine")]),
  ];

  const body = buildTable(rows, 3);
  return buildDocx(wrapDocumentXml(body));
}

/**
 * Create a DOCX with no tables (prose only).
 */
export async function createNoTableDocx(): Promise<Buffer> {
  const body = `
    <w:p><w:r><w:t>This is a paragraph of text.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Another paragraph without any tables.</w:t></w:r></w:p>
  `;
  return buildDocx(wrapDocumentXml(body));
}

/**
 * Create a DOCX with an empty table (table with no rows).
 */
export async function createEmptyTableDocx(): Promise<Buffer> {
  const body = buildTable([], 2);
  return buildDocx(wrapDocumentXml(body));
}

/**
 * Create a DOCX with a table containing cells with only whitespace.
 */
export async function createWhitespaceCellsDocx(): Promise<Buffer> {
  const rows = [
    buildRow([buildCell("Header1"), buildCell("Header2")], true),
    buildRow([buildCell("   "), buildCell("data")]),
  ];

  const body = buildTable(rows, 2);
  return buildDocx(wrapDocumentXml(body));
}

/**
 * Create test DOCX table fixture files in the fixtures directory.
 *
 * Writes DOCX files into a `docx-tables/` subdirectory under the given
 * fixtures directory.
 *
 * @param fixturesDir - Root fixtures directory path
 */
export async function createTestDocxTableFiles(fixturesDir: string): Promise<void> {
  const docxTablesDir = path.join(fixturesDir, "docx-tables");
  await fs.mkdir(docxTablesDir, { recursive: true });

  await Promise.all([
    createSimpleTableDocx().then((buf) =>
      fs.writeFile(path.join(docxTablesDir, "simple-table.docx"), buf)
    ),
    createMultiTableDocx().then((buf) =>
      fs.writeFile(path.join(docxTablesDir, "multi-table.docx"), buf)
    ),
    createWithHeadersDocx().then((buf) =>
      fs.writeFile(path.join(docxTablesDir, "with-headers.docx"), buf)
    ),
    createColspanDocx().then((buf) =>
      fs.writeFile(path.join(docxTablesDir, "colspan.docx"), buf)
    ),
    createRowspanDocx().then((buf) =>
      fs.writeFile(path.join(docxTablesDir, "rowspan.docx"), buf)
    ),
    createNoTableDocx().then((buf) =>
      fs.writeFile(path.join(docxTablesDir, "no-table.docx"), buf)
    ),
    createEmptyTableDocx().then((buf) =>
      fs.writeFile(path.join(docxTablesDir, "empty-table.docx"), buf)
    ),
    createWhitespaceCellsDocx().then((buf) =>
      fs.writeFile(path.join(docxTablesDir, "whitespace-cells.docx"), buf)
    ),
  ]);
}

/**
 * Get the path to the DOCX table fixtures directory.
 *
 * @param fixturesDir - Root fixtures directory
 * @returns Path to docx-tables subdirectory
 */
export function getDocxTablesFixturesDir(fixturesDir: string): string {
  return path.join(fixturesDir, "docx-tables");
}
