// Minimaler Parser für multipart/mixed-Antworten (ace-server liefert so JSON-Metadaten + Audio/Latents).

export interface MultipartPart {
  contentType: string;
  body: Uint8Array;
}

const CRLF_CRLF = new TextEncoder().encode("\r\n\r\n");

function boundaryOf(contentType: string): string | undefined {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return m?.[1] ?? m?.[2];
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function parseMultipart(contentType: string, body: Uint8Array): MultipartPart[] {
  const boundary = boundaryOf(contentType);
  if (!boundary) return [];
  const delimiter = new TextEncoder().encode(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let pos = indexOf(body, delimiter, 0);
  while (pos >= 0) {
    const start = pos + delimiter.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;   // "--" = Ende
    const next = indexOf(body, delimiter, start);
    if (next < 0) break;
    const part = body.subarray(start, next);
    const headerEnd = indexOf(part, CRLF_CRLF, 0);
    if (headerEnd >= 0) {
      const headers = new TextDecoder().decode(part.subarray(0, headerEnd));
      let content = part.subarray(headerEnd + CRLF_CRLF.length);
      if (content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a) {
        content = content.subarray(0, content.length - 2);   // CRLF vor dem nächsten Trenner gehört nicht zum Inhalt
      }
      const type = /^content-type:\s*([^\r\n;]+)/im.exec(headers)?.[1]?.trim().toLowerCase() ?? "text/plain";
      parts.push({ contentType: type, body: content });
    }
    pos = next;
  }
  return parts;
}
