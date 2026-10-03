import { inflateRawSync } from "node:zlib";
import { SaxesParser } from "saxes";

export const OFFICE_MIME_EXTENSIONS: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
const MAIN_PARTS: Record<string, [string, string]> = {
  docx: ["word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
  xlsx: ["xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"],
  pptx: ["ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
};
const TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const MAX_TYPES_BYTES = 128 * 1024;

/** Returns true for malformed extra fields too: their semantics are not safe to
 * ignore at this admission boundary. */
function hasZip64OrMalformedExtra(extra: Buffer): boolean {
  for (let cursor = 0; cursor < extra.length;) {
    if (cursor + 4 > extra.length) return true;
    const id = extra.readUInt16LE(cursor), size = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + size > extra.length || id === 0x0001) return true;
    cursor += size;
  }
  return false;
}

/** Bounded format admission only, not malware scanning. Never extracts files or
 * renders Office content. Macros, embedded objects, encrypted and ZIP64 archives
 * are outside this release's supported file formats. */
export function validOfficePackage(mime: string, bytes: Buffer): boolean {
  const extension = OFFICE_MIME_EXTENSIONS[mime];
  if (!extension || bytes.length < 22 || bytes.length > 10 * 1024 * 1024) return false;
  try {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
    }
    if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) return false;
    const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12), directory = bytes.readUInt32LE(end + 16);
    if (!count || count > 4096 || count !== bytes.readUInt16LE(end + 8) || directory + directorySize !== end) return false;
    const names = new Set<string>(), ranges: [number, number][] = [];
    let cursor = directory, expandedTotal = 0, types: Buffer | null = null;
    for (let n = 0; n < count; n++) {
      if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) return false;
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
      const compressed = bytes.readUInt32LE(cursor + 20), expanded = bytes.readUInt32LE(cursor + 24);
      const nameSize = bytes.readUInt16LE(cursor + 28), extraSize = bytes.readUInt16LE(cursor + 30), commentSize = bytes.readUInt16LE(cursor + 32);
      const offset = bytes.readUInt32LE(cursor + 42), next = cursor + 46 + nameSize + extraSize + commentSize;
      if (next > end || !nameSize || flags & 0x2049 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34) !== 0 || compressed === 0xffffffff || expanded === 0xffffffff || hasZip64OrMalformedExtra(bytes.subarray(cursor + 46 + nameSize, next - commentSize))) return false;
      const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize));
      const folded = name.toLowerCase();
      if (names.has(name) || /[\\\x00-\x1f%]/.test(name) || name.startsWith("/") || name.split("/").some(part => part === ".." || part === ".") || /vbaproject|activex|\/embeddings\//.test(folded)) return false;
      names.add(name); expandedTotal += expanded;
      if (expandedTotal > 100 * 1024 * 1024 || offset + 30 > directory || bytes.readUInt32LE(offset) !== 0x04034b50) return false;
      if (bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method) return false;
      const localNameSize = bytes.readUInt16LE(offset + 26), localExtraSize = bytes.readUInt16LE(offset + 28), data = offset + 30 + localNameSize + localExtraSize;
      if (data > directory || hasZip64OrMalformedExtra(bytes.subarray(offset + 30 + localNameSize, data))) return false;
      if (data + compressed > directory || !bytes.subarray(offset + 30, offset + 30 + localNameSize).equals(bytes.subarray(cursor + 46, cursor + 46 + nameSize))) return false;
      ranges.push([offset, data + compressed]);
      if (name === "[Content_Types].xml") {
        if (expanded > MAX_TYPES_BYTES || compressed > MAX_TYPES_BYTES) return false;
        const body = bytes.subarray(data, data + compressed);
        types = method === 0 ? body : inflateRawSync(body, { maxOutputLength: MAX_TYPES_BYTES });
        if (types.length !== expanded) return false;
      }
      cursor = next;
    }
    if (cursor !== end || !types) return false;
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1])) return false;
    const [mainPart, contentType] = MAIN_PARTS[extension];
    if (!names.has(mainPart) || !names.has("_rels/.rels")) return false;
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(types);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return false;
    let depth = 0, valid = true, match = false;
    const parser = new SaxesParser({ xmlns: true });
    parser.on("error", () => { valid = false; });
    parser.on("opentag", tag => {
      depth++;
      if (tag.uri !== TYPES_NS || (depth === 1 ? tag.local !== "Types" : depth !== 2 || !["Default", "Override"].includes(tag.local))) valid = false;
      const attrs = Object.fromEntries(Object.values(tag.attributes).map(attribute => [attribute.local, attribute.value]));
      if (/macroenabled|vbaproject|activex|oleobject/i.test(attrs.ContentType || "")) valid = false;
      if (tag.local === "Override" && attrs.PartName === `/${mainPart}` && attrs.ContentType === contentType) match = true;
    });
    parser.on("closetag", () => { depth--; });
    parser.write(xml).close();
    return valid && match;
  } catch { return false; }
}
