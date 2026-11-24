/**
 * 100% Browser-local document text extractor (.docx, .txt, .md, .csv, .json)
 * Parses .docx ZIP archive directly in memory using Web Streams DecompressionStream('deflate-raw')
 * — zero server upload, zero heavy third-party zip libraries.
 */

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器版本较低，暂不支持本地解析 .docx，请直接复制粘贴文本');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressed as BufferSource);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeExtractedWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractXmlTextFromWordDocument(xml: string): string {
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const hasParserError =
        doc.getElementsByTagName('parsererror').length > 0 ||
        doc.getElementsByTagNameNS('*', 'parsererror').length > 0;

      if (!hasParserError && doc.documentElement) {
        const parts: string[] = [];
        const walk = (node: Node) => {
          if (node.nodeType !== 1) return; // Element nodes only
          const el = node as Element;
          const local = (el.localName || el.nodeName.replace(/^[^:]+:/, '')).toLowerCase();

          // Skip Word tracked-changes deletions, field codes, and style/property metadata
          if (
            local === 'del' ||
            local === 'deltext' ||
            local === 'instrtext' ||
            local === 'fldchar' ||
            local === 'ppr' ||
            local === 'rpr' ||
            local === 'tblpr' ||
            local === 'tcpr' ||
            local === 'sectpr'
          ) {
            return;
          }

          if (local === 't') {
            parts.push(el.textContent || '');
            return;
          }
          if (local === 'tab') {
            parts.push('\t');
            return;
          }
          if (local === 'br' || local === 'cr') {
            parts.push('\n');
            return;
          }

          for (let child = el.firstChild; child; child = child.nextSibling) {
            walk(child);
          }

          if (local === 'tc') {
            // Separate adjacent table cells cleanly on the same row
            if (parts.length > 0 && parts[parts.length - 1] === '\n') {
              parts.pop();
            }
            parts.push('\t');
          } else if (local === 'p' || local === 'tr') {
            parts.push('\n');
          }
        };

        walk(doc.documentElement);
        const extracted = normalizeExtractedWhitespace(parts.join(''));
        if (extracted) {
          return extracted;
        }
      }
    } catch {
      // Fall through cleanly to resilient tag-based extractor below
    }
  }

  // Resilient fallback for Node.js or malformed third-party Word XML
  const cleaned = xml
    .replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')
    .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:(?:br|cr)[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '');

  return normalizeExtractedWhitespace(decodeXmlEntities(cleaned));
}

export async function extractLocalDocumentText(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json')
  ) {
    return (await file.text()).trim();
  }

  if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
    throw new Error('旧版二进制 .doc 格式暂不支持纯本地解析，请另存为 .docx 或直接粘贴文本');
  }

  if (!lower.endsWith('.docx')) {
    throw new Error('目前支持本地读取 .docx、.txt、.md、.csv 文件');
  }

  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  // Locate End of Central Directory (EOCD) signature 0x06054b50 from end of file
  let eocdOffset = -1;
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (readUint32LE(view, i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('无法识别该 .docx 压缩结构，请检查文件是否损坏');
  }

  const cdEntries = readUint16LE(view, eocdOffset + 10);
  const cdOffset = readUint32LE(view, eocdOffset + 16);
  const decoder = new TextDecoder('utf-8');

  let ptr = cdOffset;
  for (let i = 0; i < cdEntries && ptr + 46 <= bytes.length; i++) {
    if (readUint32LE(view, ptr) !== 0x02014b50) break;
    const compressionMethod = readUint16LE(view, ptr + 10);
    const compressedSize = readUint32LE(view, ptr + 20);
    const fileNameLen = readUint16LE(view, ptr + 28);
    const extraLen = readUint16LE(view, ptr + 30);
    const commentLen = readUint16LE(view, ptr + 32);
    const localHeaderOffset = readUint32LE(view, ptr + 42);

    const fileName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + fileNameLen));
    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (fileName === 'word/document.xml') {
      const localNameLen = readUint16LE(view, localHeaderOffset + 26);
      const localExtraLen = readUint16LE(view, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const slice = bytes.subarray(dataStart, dataStart + compressedSize);

      let xmlBytes: Uint8Array;
      if (compressionMethod === 0) {
        xmlBytes = slice;
      } else if (compressionMethod === 8) {
        xmlBytes = await inflateRawBytes(slice);
      } else {
        throw new Error(`不支持的 DOCX 压缩算法 (${compressionMethod})`);
      }

      const xmlText = decoder.decode(xmlBytes);
      return extractXmlTextFromWordDocument(xmlText);
    }
  }

  throw new Error('未在 .docx 中找到正文节点 word/document.xml');
}
