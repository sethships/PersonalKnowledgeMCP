/**
 * PDF table test fixture generator.
 *
 * Creates PDF files with text items positioned at specific grid coordinates
 * for testing the PdfTableExtractor. Uses raw PDF content streams with
 * explicit Td (text position) operators to place text at known (x, y)
 * positions that pdfreader can parse.
 *
 * @module tests/fixtures/documents/pdf-table-fixtures
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Options for a single text item in a PDF page.
 */
interface TextPlacement {
  /** Text content to display. */
  text: string;
  /** X-coordinate (horizontal position, points from left). */
  x: number;
  /** Y-coordinate (vertical position, points from bottom). */
  y: number;
}

/**
 * Options for generating a test PDF with table-like content.
 */
interface TablePdfOptions {
  /** Pages of text placements. Each element is an array of items for one page. */
  pages: TextPlacement[][];
}

/**
 * Escape text for PDF string literals.
 *
 * @param text - Raw text content
 * @returns Escaped text safe for PDF string
 */
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Create a PDF with text items at precise (x, y) coordinates.
 *
 * Generates a valid PDF 1.4 file with text items placed using absolute
 * positioning (Td operator). Each text item appears at its specified
 * coordinates, which pdfreader can parse with spatial information.
 *
 * @param options - PDF generation options with text placements per page
 * @returns PDF file as a Buffer
 */
export function createTablePdf(options: TablePdfOptions): Buffer {
  const { pages } = options;
  const objects: string[] = [];

  // Object 1: Catalog
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Object 2: Pages container
  const pageRefs = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [ ${pageRefs} ] /Count ${pages.length} >>\nendobj\n`
  );

  // Create page objects and content streams
  for (let i = 0; i < pages.length; i++) {
    const placements = pages[i]!;
    const pageObjNum = 3 + i * 2;
    const contentObjNum = pageObjNum + 1;

    // Build content stream with absolute positioning for each text item
    const textOps: string[] = [];
    for (const placement of placements) {
      // Each item: move to absolute position and show text
      // Using Tm (text matrix) for absolute positioning within the same BT/ET block
      textOps.push(`1 0 0 1 ${placement.x} ${placement.y} Tm (${escapeText(placement.text)}) Tj`);
    }

    const contentStream = `BT /F1 10 Tf ${textOps.join(" ")} ET`;
    const streamLength = contentStream.length;

    // Page object
    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n`
    );

    // Content stream object
    objects.push(
      `${contentObjNum} 0 obj\n<< /Length ${streamLength} >>\nstream\n${contentStream}\nendstream\nendobj\n`
    );
  }

  // Info dictionary
  const infoObjNum = 3 + pages.length * 2;
  objects.push(
    `${infoObjNum} 0 obj\n<< /Producer (PersonalKnowledgeMCP Table Test Fixtures) >>\nendobj\n`
  );

  // Build PDF structure
  const header = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
  const body = objects.join("");
  const xrefOffset = header.length + body.length;

  // Cross-reference table
  const totalObjects = infoObjNum + 1;
  let xref = `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;

  let offset = header.length;
  for (const obj of objects) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
    offset += obj.length;
  }

  // Trailer
  const trailer = `trailer\n<< /Size ${totalObjects} /Root 1 0 R /Info ${infoObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, "binary");
}

/**
 * Create a simple 2-column, 3-row table PDF.
 *
 * Layout:
 * ```
 * Name     | Age
 * Alice    | 30
 * Bob      | 25
 * ```
 *
 * @returns PDF buffer
 */
export function createSimpleTablePdf(): Buffer {
  return createTablePdf({
    pages: [
      [
        // Row 1 (header)
        { text: "Name", x: 72, y: 720 },
        { text: "Age", x: 200, y: 720 },
        // Row 2
        { text: "Alice", x: 72, y: 700 },
        { text: "30", x: 200, y: 700 },
        // Row 3
        { text: "Bob", x: 72, y: 680 },
        { text: "25", x: 200, y: 680 },
      ],
    ],
  });
}

/**
 * Create a PDF with two tables separated by non-table text.
 *
 * Layout:
 * ```
 * Table 1:
 * Product  | Price
 * Widget   | 9.99
 * Gadget   | 19.99
 *
 * Some paragraph text here that is not a table.
 *
 * Table 2:
 * City     | Country
 * Paris    | France
 * Tokyo    | Japan
 * ```
 *
 * @returns PDF buffer
 */
export function createMultiTablePdf(): Buffer {
  return createTablePdf({
    pages: [
      [
        // Table 1
        { text: "Product", x: 72, y: 720 },
        { text: "Price", x: 200, y: 720 },
        { text: "Widget", x: 72, y: 700 },
        { text: "9.99", x: 200, y: 700 },
        { text: "Gadget", x: 72, y: 680 },
        { text: "19.99", x: 200, y: 680 },
        // Non-table paragraph (single item per "row" = won't qualify as table)
        { text: "Some paragraph text that separates the tables.", x: 72, y: 640 },
        // Table 2
        { text: "City", x: 72, y: 600 },
        { text: "Country", x: 200, y: 600 },
        { text: "Paris", x: 72, y: 580 },
        { text: "France", x: 200, y: 580 },
        { text: "Tokyo", x: 72, y: 560 },
        { text: "Japan", x: 200, y: 560 },
      ],
    ],
  });
}

/**
 * Create a PDF with a table containing a merged (column-spanning) header.
 *
 * The merged cell's text is placed at x=72 with a width that conceptually
 * spans to beyond the second column (x=200). The width value is encoded
 * in the PDF content stream indirectly through font metrics.
 *
 * Layout:
 * ```
 * Employee Details  (spans 2 columns)
 * Name     | Department
 * Alice    | Engineering
 * Bob      | Marketing
 * ```
 *
 * @returns PDF buffer
 */
export function createMergedCellPdf(): Buffer {
  return createTablePdf({
    pages: [
      [
        // Row 1 — merged header (single wide text item)
        { text: "Employee Details", x: 72, y: 720 },
        // Row 2 — column headers
        { text: "Name", x: 72, y: 700 },
        { text: "Department", x: 200, y: 700 },
        // Row 3
        { text: "Alice", x: 72, y: 680 },
        { text: "Engineering", x: 200, y: 680 },
        // Row 4
        { text: "Bob", x: 72, y: 660 },
        { text: "Marketing", x: 200, y: 660 },
      ],
    ],
  });
}

/**
 * Create a PDF with only prose text (no tables).
 *
 * Contains a few lines of text, each at different y-coordinates but
 * only one item per line (below minColumns threshold).
 *
 * @returns PDF buffer
 */
export function createNoTablePdf(): Buffer {
  return createTablePdf({
    pages: [
      [
        { text: "This is a paragraph of text.", x: 72, y: 720 },
        { text: "It continues on the next line.", x: 72, y: 700 },
        { text: "There are no tables in this document.", x: 72, y: 680 },
        { text: "Just plain prose content.", x: 72, y: 660 },
      ],
    ],
  });
}

/**
 * Create a 3-column table PDF for wider table testing.
 *
 * Layout:
 * ```
 * Name     | Role       | Level
 * Alice    | Engineer   | Senior
 * Bob      | Designer   | Junior
 * Charlie  | Manager    | Lead
 * ```
 *
 * @returns PDF buffer
 */
export function createThreeColumnTablePdf(): Buffer {
  return createTablePdf({
    pages: [
      [
        // Header row
        { text: "Name", x: 72, y: 720 },
        { text: "Role", x: 200, y: 720 },
        { text: "Level", x: 330, y: 720 },
        // Row 2
        { text: "Alice", x: 72, y: 700 },
        { text: "Engineer", x: 200, y: 700 },
        { text: "Senior", x: 330, y: 700 },
        // Row 3
        { text: "Bob", x: 72, y: 680 },
        { text: "Designer", x: 200, y: 680 },
        { text: "Junior", x: 330, y: 680 },
        // Row 4
        { text: "Charlie", x: 72, y: 660 },
        { text: "Manager", x: 200, y: 660 },
        { text: "Lead", x: 330, y: 660 },
      ],
    ],
  });
}

/**
 * Create an empty PDF with no text content.
 *
 * @returns PDF buffer
 */
export function createEmptyPdf(): Buffer {
  return createTablePdf({
    pages: [[]],
  });
}

/**
 * Create test PDF table fixture files in the fixtures directory.
 *
 * Writes PDF files into a `pdf-tables/` subdirectory under the given
 * fixtures directory.
 *
 * @param fixturesDir - Root fixtures directory path
 */
export async function createTestPdfTableFiles(fixturesDir: string): Promise<void> {
  const pdfTablesDir = path.join(fixturesDir, "pdf-tables");
  await fs.mkdir(pdfTablesDir, { recursive: true });

  await Promise.all([
    fs.writeFile(path.join(pdfTablesDir, "simple-table.pdf"), createSimpleTablePdf()),
    fs.writeFile(path.join(pdfTablesDir, "multi-table.pdf"), createMultiTablePdf()),
    fs.writeFile(path.join(pdfTablesDir, "merged-cells.pdf"), createMergedCellPdf()),
    fs.writeFile(path.join(pdfTablesDir, "no-table.pdf"), createNoTablePdf()),
    fs.writeFile(
      path.join(pdfTablesDir, "three-column-table.pdf"),
      createThreeColumnTablePdf()
    ),
    fs.writeFile(path.join(pdfTablesDir, "empty.pdf"), createEmptyPdf()),
  ]);
}

/**
 * Get the path to the PDF table fixtures directory.
 *
 * @param fixturesDir - Root fixtures directory
 * @returns Path to pdf-tables subdirectory
 */
export function getPdfTablesFixturesDir(fixturesDir: string): string {
  return path.join(fixturesDir, "pdf-tables");
}
