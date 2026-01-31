/**
 * PDF test fixture generator.
 *
 * Creates minimal PDF files for testing the PdfExtractor.
 * These PDFs contain simple text content that pdf-parse can extract.
 *
 * @module tests/fixtures/documents/pdf-fixtures
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Create a minimal PDF with given text content and metadata.
 *
 * This generates a valid PDF 1.4 file with:
 * - Document info dictionary (title, author, creation date)
 * - Single or multiple pages with text content
 *
 * @param options - PDF generation options
 * @returns PDF file as a Buffer
 */
export function createMinimalPdf(options: {
  pages: string[];
  title?: string;
  author?: string;
  creationDate?: Date;
}): Buffer {
  const { pages, title, author, creationDate } = options;

  // Build PDF objects
  const objects: string[] = [];
  let objectCount = 0;

  // Object 1: Catalog
  objectCount++;
  const catalogRef = objectCount;
  objects.push(`${catalogRef} 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  // Object 2: Pages
  objectCount++;
  const pagesRef = objectCount;
  const pageRefs = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects.push(
    `${pagesRef} 0 obj\n<< /Type /Pages /Kids [ ${pageRefs} ] /Count ${pages.length} >>\nendobj\n`
  );

  // Create page objects and content streams
  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i];
    const pageObjNum = 3 + i * 2;
    const contentObjNum = pageObjNum + 1;

    // Page object
    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n`
    );

    // Content stream
    const contentStream = `BT /F1 12 Tf 72 720 Td (${escapeText(pageText ?? "")}) Tj ET`;
    const streamLength = contentStream.length;
    objects.push(
      `${contentObjNum} 0 obj\n<< /Length ${streamLength} >>\nstream\n${contentStream}\nendstream\nendobj\n`
    );
  }

  // Info dictionary
  objectCount = 3 + pages.length * 2;
  const infoObjNum = objectCount;
  const infoEntries: string[] = [];
  if (title) {
    infoEntries.push(`/Title (${escapeText(title)})`);
  }
  if (author) {
    infoEntries.push(`/Author (${escapeText(author)})`);
  }
  if (creationDate) {
    infoEntries.push(`/CreationDate (D:${formatPdfDate(creationDate)})`);
  }
  infoEntries.push(`/Producer (PersonalKnowledgeMCP Test Fixtures)`);
  objects.push(`${infoObjNum} 0 obj\n<< ${infoEntries.join(" ")} >>\nendobj\n`);

  // Build PDF
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
  const trailer = `trailer\n<< /Size ${totalObjects} /Root ${catalogRef} 0 R /Info ${infoObjNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, "binary");
}

/**
 * Escape text for PDF string.
 */
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Format date for PDF date string.
 */
function formatPdfDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  const second = date.getSeconds().toString().padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}${second}`;
}

/**
 * Create test PDF files in the fixtures directory.
 */
export async function createTestPdfFiles(fixturesDir: string): Promise<void> {
  await fs.mkdir(fixturesDir, { recursive: true });

  // Simple 1-page PDF
  const simplePdf = createMinimalPdf({
    pages: ["This is a simple test PDF document with one page of content."],
  });
  await fs.writeFile(path.join(fixturesDir, "simple.pdf"), simplePdf);

  // Multi-page PDF
  const multiPagePdf = createMinimalPdf({
    pages: [
      "Page 1: Introduction to the document.",
      "Page 2: The main content section.",
      "Page 3: Conclusion and summary.",
    ],
  });
  await fs.writeFile(path.join(fixturesDir, "multi-page.pdf"), multiPagePdf);

  // PDF with metadata
  const withMetadataPdf = createMinimalPdf({
    pages: ["This document has full metadata including title, author, and creation date."],
    title: "Test Document Title",
    author: "Test Author Name",
    creationDate: new Date(2024, 0, 15, 10, 30, 0), // Jan 15, 2024 10:30:00
  });
  await fs.writeFile(path.join(fixturesDir, "with-metadata.pdf"), withMetadataPdf);

  // Create corrupt PDF (just random bytes)
  const corruptPdf = Buffer.from("This is not a valid PDF file content");
  await fs.writeFile(path.join(fixturesDir, "corrupt.pdf"), corruptPdf);
}

/**
 * Get the path to test fixtures directory.
 */
export function getFixturesDir(): string {
  return path.join(__dirname);
}

// Run if executed directly
if (require.main === module) {
  createTestPdfFiles(getFixturesDir())
    .then(() => console.log("Test PDF files created successfully"))
    .catch((err) => console.error("Failed to create test PDF files:", err));
}
