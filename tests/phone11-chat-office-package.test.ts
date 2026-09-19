import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { OFFICE_MIME_EXTENSIONS, validOfficePackage } from "../server/chat/office-package";

type Entry = {
  name: string;
  body: Buffer;
  method?: 0 | 8;
  flags?: number;
  centralExtra?: Buffer;
  localExtra?: Buffer;
  centralExpanded?: number;
  centralCompressed?: number;
};

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Small, standards-shaped local/central-directory ZIP fixtures. */
function zip(entries: Entry[]) {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8"), method = entry.method ?? 8, flags = entry.flags ?? 0;
    const data = method === 8 ? deflateRawSync(entry.body) : entry.body;
    const localExtra = entry.localExtra ?? Buffer.alloc(0), centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const compressed = data.length, expanded = entry.body.length, checksum = crc32(entry.body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed, 18); local.writeUInt32LE(expanded, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(localExtra.length, 28);
    locals.push(local, name, localExtra, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8); record.writeUInt16LE(method, 10); record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(entry.centralCompressed ?? compressed, 20); record.writeUInt32LE(entry.centralExpanded ?? expanded, 24);
    record.writeUInt16LE(name.length, 28); record.writeUInt16LE(centralExtra.length, 30); record.writeUInt32LE(offset, 42);
    central.push(record, name, centralExtra);
    offset += local.length + name.length + localExtra.length + data.length;
  }
  const directory = Buffer.concat(central), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

const formats = {
  docx: ["word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
  xlsx: ["xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"],
  pptx: ["ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
} as const;

function office(format: keyof typeof formats, additions: Entry[] = [], contentType: string = formats[format][1]) {
  const [main] = formats[format];
  return zip([
    { name: "[Content_Types].xml", body: Buffer.from(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main}" ContentType="${contentType}"/></Types>`) },
    { name: "_rels/.rels", body: Buffer.from("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"/>") },
    { name: main, body: Buffer.from("<document/>") },
    ...additions,
  ]);
}

describe("Office attachment package admission", () => {
  it("accepts standard docx, xlsx, and pptx packages", () => {
    for (const format of Object.keys(formats) as Array<keyof typeof formats>) {
      const mime = Object.entries(OFFICE_MIME_EXTENSIONS).find(([, extension]) => extension === format)![0];
      expect(validOfficePackage(mime, office(format))).toBe(true);
    }
  });

  it("rejects malformed containers and MIME/main-part mismatches", () => {
    const docx = office("docx");
    expect(validOfficePackage("application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx.subarray(0, -1))).toBe(false);
    expect(validOfficePackage("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx)).toBe(false);
    expect(validOfficePackage("application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.alloc(10 * 1024 * 1024 + 1))).toBe(false);
  });

  it("rejects encrypted, data-descriptor, ZIP64, macro, and traversal packages", () => {
    const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(validOfficePackage(mime, office("docx", [{ name: "word/vbaProject.bin", body: Buffer.from("macro") }]))).toBe(false);
    expect(validOfficePackage(mime, office("docx", [], "application/vnd.ms-word.document.macroEnabled.main+xml"))).toBe(false);
    expect(validOfficePackage(mime, office("docx", [{ name: "word/../escape.xml", body: Buffer.from("x") }]))).toBe(false);
    expect(validOfficePackage(mime, office("docx", [{ name: "word/encrypted.xml", body: Buffer.from("x"), flags: 0x1 }]))).toBe(false);
    expect(validOfficePackage(mime, office("docx", [{ name: "word/descriptor.xml", body: Buffer.from("x"), flags: 0x8 }]))).toBe(false);
    expect(validOfficePackage(mime, office("docx", [{ name: "word/zip64.xml", body: Buffer.from("x"), centralExtra: Buffer.from([1, 0, 0, 0]) }]))).toBe(false);
  });

  it("rejects a bounded decompression attempt from central-directory metadata", () => {
    const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const packageBytes = office("docx", [{ name: "word/large.xml", body: Buffer.from("x"), centralExpanded: 100 * 1024 * 1024 + 1 }]);
    expect(validOfficePackage(mime, packageBytes)).toBe(false);
  });
});
