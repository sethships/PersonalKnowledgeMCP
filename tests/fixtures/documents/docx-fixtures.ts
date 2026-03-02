/**
 * DOCX test fixture generator.
 *
 * Creates minimal valid DOCX files for testing the DocxExtractor.
 * DOCX files are ZIP archives containing XML files following the
 * Office Open XML (OOXML) format.
 *
 * @module tests/fixtures/documents/docx-fixtures
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Minimal DOCX content types XML.
 */
const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

/**
 * Minimal DOCX relationships XML.
 */
const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/**
 * Minimal word/_rels/document.xml.rels
 */
const WORD_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

/**
 * Create a minimal document.xml with the given paragraphs.
 *
 * @param paragraphs - Array of paragraph objects with text and optional style
 * @returns XML string for document.xml
 */
function createDocumentXml(
  paragraphs: Array<{ text: string; style?: "Heading1" | "Heading2" | "ListParagraph" }>
): string {
  const bodyContent = paragraphs
    .map((p) => {
      const styleXml = p.style
        ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>`
        : "";
      return `<w:p>${styleXml}<w:r><w:t>${escapeXml(p.text)}</w:t></w:r></w:p>`;
    })
    .join("\n    ");

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
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
            mc:Ignorable="w14 wp14">
  <w:body>
    ${bodyContent}
  </w:body>
</w:document>`;
}

/**
 * Escape XML special characters.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Create a minimal DOCX file as a Buffer.
 *
 * Uses the built-in Blob API to create ZIP archives. DOCX is a ZIP-based format
 * with XML content files.
 *
 * @param documentXml - The document.xml content
 * @returns DOCX file as a Buffer
 */
async function createDocxBuffer(documentXml: string): Promise<Buffer> {
  // Use a simple ZIP creation approach
  // DOCX requires specific files in a ZIP archive
  const files: Array<{ name: string; content: string }> = [
    { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
    { name: "_rels/.rels", content: RELS_XML },
    { name: "word/_rels/document.xml.rels", content: WORD_RELS_XML },
    { name: "word/document.xml", content: documentXml },
  ];

  return createZipBuffer(files);
}

/**
 * Create a minimal ZIP file from the given entries.
 *
 * Implements the ZIP format (PK headers) with stored (uncompressed) entries
 * for simplicity. This is sufficient for DOCX test fixtures.
 *
 * @param entries - Array of file entries to include
 * @returns ZIP archive as a Buffer
 */
function createZipBuffer(entries: Array<{ name: string; content: string }>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const dataBuffer = Buffer.from(entry.content, "utf8");

    // Local file header (30 bytes + name + data)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed (2.0)
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(0, 8); // Compression method (stored)
    localHeader.writeUInt16LE(0, 10); // Last mod file time
    localHeader.writeUInt16LE(0, 12); // Last mod file date
    localHeader.writeUInt32LE(0, 14); // CRC-32 (skip for simplicity)
    localHeader.writeUInt32LE(dataBuffer.length, 18); // Compressed size
    localHeader.writeUInt32LE(dataBuffer.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length

    const localRecord = Buffer.concat([localHeader, nameBuffer, dataBuffer]);
    localHeaders.push(localRecord);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0, 8); // General purpose bit flag
    centralHeader.writeUInt16LE(0, 10); // Compression method
    centralHeader.writeUInt16LE(0, 12); // Last mod file time
    centralHeader.writeUInt16LE(0, 14); // Last mod file date
    centralHeader.writeUInt32LE(0, 16); // CRC-32
    centralHeader.writeUInt32LE(dataBuffer.length, 20); // Compressed size
    centralHeader.writeUInt32LE(dataBuffer.length, 24); // Uncompressed size
    centralHeader.writeUInt16LE(nameBuffer.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(offset, 42); // Relative offset of local header

    centralHeaders.push(Buffer.concat([centralHeader, nameBuffer]));
    offset += localRecord.length;
  }

  const centralDirOffset = offset;
  const centralDir = Buffer.concat(centralHeaders);
  const centralDirSize = centralDir.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Disk with central directory
  eocd.writeUInt16LE(entries.length, 8); // Number of entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // Total entries
  eocd.writeUInt32LE(centralDirSize, 12); // Size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16); // Offset of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localHeaders, centralDir, eocd]);
}

/**
 * Create test DOCX files in the fixtures directory.
 *
 * Writes DOCX files into a `docx/` subdirectory under the given fixtures dir.
 */
export async function createTestDocxFiles(fixturesDir: string): Promise<void> {
  const docxDir = path.join(fixturesDir, "docx");
  await fs.mkdir(docxDir, { recursive: true });

  // Simple DOCX with basic text
  const simpleXml = createDocumentXml([
    { text: "This is a simple test document." },
    { text: "It contains two paragraphs of plain text." },
  ]);
  const simpleDocx = await createDocxBuffer(simpleXml);
  await fs.writeFile(path.join(docxDir, "simple.docx"), simpleDocx);

  // DOCX with headings
  const headingsXml = createDocumentXml([
    { text: "Document Title", style: "Heading1" },
    { text: "This is the introduction paragraph." },
    { text: "First Section", style: "Heading2" },
    { text: "Content under the first section heading." },
    { text: "Second Section", style: "Heading2" },
    { text: "Content under the second section heading." },
  ]);
  const headingsDocx = await createDocxBuffer(headingsXml);
  await fs.writeFile(path.join(docxDir, "with-headings.docx"), headingsDocx);

  // DOCX with lists
  const listsXml = createDocumentXml([
    { text: "Shopping List", style: "Heading1" },
    { text: "Apples", style: "ListParagraph" },
    { text: "Bananas", style: "ListParagraph" },
    { text: "Oranges", style: "ListParagraph" },
    { text: "These are the items we need." },
  ]);
  const listsDocx = await createDocxBuffer(listsXml);
  await fs.writeFile(path.join(docxDir, "with-lists.docx"), listsDocx);

  // Invalid DOCX (not a valid ZIP)
  const invalidDocx = Buffer.from("This is not a valid DOCX file");
  await fs.writeFile(path.join(docxDir, "invalid.docx"), invalidDocx);
}
