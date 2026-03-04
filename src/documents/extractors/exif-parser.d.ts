/**
 * Type declarations for the exif-parser package.
 *
 * exif-parser is a lightweight EXIF metadata parser for JPEG and TIFF images.
 * It does not ship its own type definitions or have an @types package.
 *
 * @see https://www.npmjs.com/package/exif-parser
 */

declare module "exif-parser" {
  /**
   * EXIF tag values parsed from image metadata.
   *
   * Only commonly used tags are typed; others appear as unknown.
   */
  interface ExifTags {
    DateTimeOriginal?: number;
    Make?: string;
    Model?: string;
    Orientation?: number;
    GPSLatitude?: number;
    GPSLongitude?: number;
    ImageWidth?: number;
    ImageHeight?: number;
    [key: string]: unknown;
  }

  /**
   * Result returned by ExifParser.parse().
   */
  interface ExifParseResult {
    tags: ExifTags;
    imageSize?: {
      width: number;
      height: number;
    };
    hasThumbnail?: (mimeType: string) => boolean;
    getThumbnailBuffer?: () => Buffer;
  }

  /**
   * Parser instance created by exif-parser.create().
   */
  interface ExifParser {
    parse(): ExifParseResult;
    enableBinaryFields(enable: boolean): ExifParser;
    enablePointers(enable: boolean): ExifParser;
    enableTagNames(enable: boolean): ExifParser;
    enableImageSize(enable: boolean): ExifParser;
    enableReturnTags(enable: boolean): ExifParser;
    enableSimpleValues(enable: boolean): ExifParser;
  }

  /**
   * Create a new EXIF parser from a Buffer.
   *
   * @param buffer - Image file buffer (JPEG or TIFF)
   * @returns Parser instance; call .parse() to extract tags
   */
  function create(buffer: Buffer): ExifParser;
}
