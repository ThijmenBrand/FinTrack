import { describe, it, expect } from "vitest";
import {
  contentDisposition,
  detectAttachmentType,
  formatFileSize,
  isAttachmentPathname,
} from "./attachments";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string, pad = 0) =>
  new Uint8Array([...[...text].map((c) => c.charCodeAt(0)), ...Array(pad).fill(0)]);

describe("detectAttachmentType", () => {
  it("recognises a PDF and the image types we re-encode", () => {
    expect(detectAttachmentType(ascii("%PDF-1.7\n%âãÏÓ"))).toBe("pdf");
    expect(
      detectAttachmentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)),
    ).toBe("png");
    expect(detectAttachmentType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe(
      "jpeg",
    );
  });

  it("rejects what the content type alone would have let through", () => {
    // The whole point of sniffing: an SVG is a script container, and a browser
    // would run it if it were ever served back from our own origin.
    expect(detectAttachmentType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectAttachmentType(ascii("<!DOCTYPE html><script>alert(1)</script>"))).toBeNull();
    // A PDF header further in the file is not a PDF we will vouch for.
    expect(detectAttachmentType(ascii("junkjunkjunk%PDF-1.4"))).toBeNull();
    expect(detectAttachmentType(ascii("%PD"))).toBeNull();
    expect(detectAttachmentType(new Uint8Array())).toBeNull();
  });
});

describe("isAttachmentPathname", () => {
  it("accepts only the flat shape we write ourselves", () => {
    expect(isAttachmentPathname("attachments/abc-123.webp")).toBe(true);
    expect(isAttachmentPathname("attachments/abc-123.pdf")).toBe(true);
  });

  it("refuses anything that could reach outside attachments/", () => {
    expect(isAttachmentPathname("attachments/../avatars/me.webp")).toBe(false);
    expect(isAttachmentPathname("attachments/nested/file.webp")).toBe(false);
    expect(isAttachmentPathname("avatars/me.webp")).toBe(false);
    expect(isAttachmentPathname("https://evil.test/x.webp")).toBe(false);
    expect(isAttachmentPathname("attachments/x.svg")).toBe(false);
    expect(isAttachmentPathname(null)).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("encodes a filename that would otherwise inject a header", () => {
    const header = contentDisposition('re"ceipt\r\nX-Evil: 1.pdf');
    expect(header).not.toMatch(/[\r\n"]/);
    expect(header.startsWith("inline; filename*=UTF-8''")).toBe(true);
  });
});

describe("formatFileSize", () => {
  it("reads as a size at every magnitude", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});
