/**
 * DOCX test fixture generator.
 *
 * Creates minimal valid DOCX files for testing the DocxExtractor.
 * DOCX files are ZIP archives containing XML files following the
 * Office Open XML (OOXML) format. Uses JSZip for proper CRC-32 checksums.
 *
 * @module tests/fixtures/documents/docx-fixtures
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import JSZip from "jszip";

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
 * Content types XML that includes docProps/core.xml override.
 */
const CONTENT_TYPES_WITH_CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

/**
 * Minimal DOCX relationships XML.
 */
const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/**
 * Relationships XML that includes docProps/core.xml reference.
 */
const RELS_WITH_CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
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
 * Create Dublin Core metadata XML for docProps/core.xml.
 *
 * @param metadata - Document metadata
 * @returns XML string for core.xml
 */
function createCoreXml(metadata: {
  title?: string;
  creator?: string;
  created?: string;
}): string {
  const titleXml = metadata.title ? `  <dc:title>${escapeXml(metadata.title)}</dc:title>` : "";
  const creatorXml = metadata.creator
    ? `  <dc:creator>${escapeXml(metadata.creator)}</dc:creator>`
    : "";
  const createdXml = metadata.created
    ? `  <dcterms:created xsi:type="dcterms:W3CDTF">${metadata.created}</dcterms:created>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
${titleXml}
${creatorXml}
${createdXml}
</cp:coreProperties>`;
}

/**
 * Create Dublin Core metadata XML with alternative (non-standard) namespace prefixes.
 *
 * Uses "dublin:" instead of "dc:" and "dublinTerms:" instead of "dcterms:" to exercise
 * namespace-aware parsing. The namespace URIs remain the same; only the prefixes differ.
 *
 * @param metadata - Document metadata
 * @returns XML string for core.xml with alternative namespace prefixes
 */
function createCoreXmlAltNamespace(metadata: {
  title?: string;
  creator?: string;
  created?: string;
}): string {
  const titleXml = metadata.title
    ? `  <dublin:title>${escapeXml(metadata.title)}</dublin:title>`
    : "";
  const creatorXml = metadata.creator
    ? `  <dublin:creator>${escapeXml(metadata.creator)}</dublin:creator>`
    : "";
  const createdXml = metadata.created
    ? `  <dublinTerms:created xsi:type="dublinTerms:W3CDTF">${metadata.created}</dublinTerms:created>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dublin="http://purl.org/dc/elements/1.1/"
                   xmlns:dublinTerms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
${titleXml}
${creatorXml}
${createdXml}
</cp:coreProperties>`;
}

/**
 * Create Dublin Core metadata XML with valid structure but empty elements.
 *
 * Contains empty `<dc:title></dc:title>` and `<dc:creator></dc:creator>` elements
 * to verify the extractor returns undefined (not empty strings) for empty fields.
 *
 * @returns XML string for core.xml with empty metadata elements
 */
function createCoreXmlWithEmptyElements(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title></dc:title>
  <dc:creator></dc:creator>
</cp:coreProperties>`;
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
 * Create a minimal DOCX file as a Buffer using JSZip.
 *
 * Creates a ZIP archive containing OOXML content files with proper CRC-32 checksums.
 *
 * @param documentXml - The document.xml content
 * @param options - Optional additional files to include
 * @returns DOCX file as a Buffer
 */
async function createDocxBuffer(
  documentXml: string,
  options?: {
    coreXml?: string;
  }
): Promise<Buffer> {
  const zip = new JSZip();

  // Add required OOXML files
  const contentTypes = options?.coreXml ? CONTENT_TYPES_WITH_CORE_XML : CONTENT_TYPES_XML;
  const rels = options?.coreXml ? RELS_WITH_CORE_XML : RELS_XML;

  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("word/_rels/document.xml.rels", WORD_RELS_XML);
  zip.file("word/document.xml", documentXml);

  // Add optional metadata
  if (options?.coreXml) {
    zip.file("docProps/core.xml", options.coreXml);
  }

  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return Buffer.from(arrayBuffer);
}

/**
 * Create a DOCX file with raw (arbitrary) content for docProps/core.xml.
 *
 * Unlike createDocxBuffer which expects valid XML, this function accepts any
 * string for core.xml — including garbage text — for testing graceful degradation.
 *
 * @param documentXml - The document.xml content
 * @param options - Options including raw core.xml content
 * @returns DOCX file as a Buffer
 */
async function createDocxBufferRaw(
  documentXml: string,
  options: {
    coreXmlRaw: string;
  }
): Promise<Buffer> {
  const zip = new JSZip();

  zip.file("[Content_Types].xml", CONTENT_TYPES_WITH_CORE_XML);
  zip.file("_rels/.rels", RELS_WITH_CORE_XML);
  zip.file("word/_rels/document.xml.rels", WORD_RELS_XML);
  zip.file("word/document.xml", documentXml);
  zip.file("docProps/core.xml", options.coreXmlRaw);

  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return Buffer.from(arrayBuffer);
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

  // DOCX with metadata (title, author, creation date)
  const metadataXml = createDocumentXml([
    { text: "Metadata Test Document", style: "Heading1" },
    { text: "This document has Dublin Core metadata in docProps/core.xml." },
  ]);
  const coreXml = createCoreXml({
    title: "Test Document Title",
    creator: "Test Author",
    created: "2024-06-15T10:30:00Z",
  });
  const metadataDocx = await createDocxBuffer(metadataXml, { coreXml });
  await fs.writeFile(path.join(docxDir, "with-metadata.docx"), metadataDocx);

  // DOCX with alternative namespace prefixes in core.xml
  const altNsXml = createDocumentXml([
    { text: "Alt Namespace Document", style: "Heading1" },
    { text: "This document uses non-standard namespace prefixes in core.xml." },
  ]);
  const altNsCoreXml = createCoreXmlAltNamespace({
    title: "Alt NS Title",
    creator: "Alt NS Author",
    created: "2025-01-20T08:00:00Z",
  });
  const altNsDocx = await createDocxBuffer(altNsXml, { coreXml: altNsCoreXml });
  await fs.writeFile(path.join(docxDir, "with-metadata-alt-ns.docx"), altNsDocx);

  // DOCX with malformed/garbage core.xml (tests graceful degradation)
  const malformedMetaXml = createDocumentXml([
    { text: "Malformed Metadata Document", style: "Heading1" },
    { text: "This document has garbage content in docProps/core.xml." },
  ]);
  const malformedMetaDocx = await createDocxBufferRaw(malformedMetaXml, {
    coreXmlRaw: "this is not valid XML at all !@#$%^&*()",
  });
  await fs.writeFile(path.join(docxDir, "with-malformed-metadata.docx"), malformedMetaDocx);

  // DOCX with empty metadata elements (valid XML but empty dc:title and dc:creator)
  const emptyMetaXml = createDocumentXml([
    { text: "Empty Metadata Document", style: "Heading1" },
    { text: "This document has empty metadata elements in docProps/core.xml." },
  ]);
  const emptyMetaCoreXml = createCoreXmlWithEmptyElements();
  const emptyMetaDocx = await createDocxBuffer(emptyMetaXml, { coreXml: emptyMetaCoreXml });
  await fs.writeFile(path.join(docxDir, "with-empty-metadata.docx"), emptyMetaDocx);

  // Invalid DOCX (not a valid ZIP)
  const invalidDocx = Buffer.from("This is not a valid DOCX file");
  await fs.writeFile(path.join(docxDir, "invalid.docx"), invalidDocx);
}
