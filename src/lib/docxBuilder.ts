/**
 * 100% Browser-local, zero-dependency OOXML (.docx) generator for Supreme People's Court
 * element-style civil complaints (要素式民事起诉状).
 *
 * Produces a standard PKZIP (STORE method, UTF-8 filenames, IEEE CRC32) archive containing
 * valid WordprocessingML XML parts that open natively in Microsoft Word, WPS Office,
 * Apple Pages, and LibreOffice with clean A4 two-column bordered court tables.
 */

import type { RenderedComplaintSection } from '../data/elementsComplaintTemplates.ts';
import type { ResolvedSpcAttachment, ResolvedSpcDocument } from './spcOfficialTemplates.ts';

// ---- Pure-JS CRC32 & Minimal Standard PKZIP (STORE) Writer ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntryInput {
  name: string;
  content: Uint8Array;
}

function createZipStore(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.content;
    const sum = crc32(data);

    // Local File Header (30 bytes + name)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lhv = new DataView(lh.buffer);
    lhv.setUint32(0, 0x04034b50, true); // signature
    lhv.setUint16(4, 20, true); // version needed 2.0
    lhv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lhv.setUint16(8, 0, true); // compression: STORE
    lhv.setUint16(10, 0, true); // mod time
    lhv.setUint16(12, 0x5621, true); // mod date
    lhv.setUint32(14, sum, true); // crc32
    lhv.setUint32(18, data.length, true); // compressed size
    lhv.setUint32(22, data.length, true); // uncompressed size
    lhv.setUint16(26, nameBytes.length, true);
    lhv.setUint16(28, 0, true); // extra len
    lh.set(nameBytes, 30);

    localParts.push(lh, data);

    // Central Directory Header (46 bytes + name)
    const ch = new Uint8Array(46 + nameBytes.length);
    const chv = new DataView(ch.buffer);
    chv.setUint32(0, 0x02014b50, true); // signature
    chv.setUint16(4, 20, true); // version made by
    chv.setUint16(6, 20, true); // version needed
    chv.setUint16(8, 0x0800, true); // UTF-8 flag
    chv.setUint16(10, 0, true); // STORE
    chv.setUint16(12, 0, true); // mod time
    chv.setUint16(14, 0x5621, true); // mod date
    chv.setUint32(16, sum, true);
    chv.setUint32(20, data.length, true);
    chv.setUint32(24, data.length, true);
    chv.setUint16(28, nameBytes.length, true);
    chv.setUint16(30, 0, true);
    chv.setUint16(32, 0, true);
    chv.setUint16(34, 0, true);
    chv.setUint16(36, 0, true);
    chv.setUint32(38, 0, true);
    chv.setUint32(42, offset, true); // relative offset of local header
    ch.set(nameBytes, 46);

    centralParts.push(ch);
    offset += lh.length + data.length;
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0);

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + cdSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let ptr = 0;
  for (const part of localParts) {
    out.set(part, ptr);
    ptr += part.length;
  }
  for (const part of centralParts) {
    out.set(part, ptr);
    ptr += part.length;
  }
  out.set(eocd, ptr);
  return out;
}

// ---- WordprocessingML XML Helpers ----

function escapeXml(raw: string): string {
  return String(raw || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function canonicalCjkFont(font: string): string {
  switch (font) {
    case '仿宋':
    case '仿宋_GB2312':
      return 'FangSong';
    case '宋体':
      return 'SimSun';
    case '黑体':
      return 'SimHei';
    case '楷体':
      return 'KaiTi';
    default:
      return font || 'FangSong';
  }
}

function makeParagraph(
  text: string,
  opts?: {
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    sizeHalfPt?: number; // e.g. 21 = 10.5pt (五号), 24 = 12pt (小四), 32 = 16pt (三号)
    font?: string;
    spaceBefore?: number;
    spaceAfter?: number;
    line?: number;
    keepNext?: boolean;
  }
): string {
  const align = opts?.align || 'left';
  const size = opts?.sizeHalfPt ?? 21;
  const font = canonicalCjkFont(opts?.font || 'FangSong');
  const sb = opts?.spaceBefore ?? 40;
  const sa = opts?.spaceAfter ?? 40;
  const line = opts?.line ?? 300;
  const boldXml = opts?.bold ? '<w:b/><w:bCs/>' : '';
  const keepNextXml = opts?.keepNext ? '<w:keepNext/>' : '';
  const rPr = `<w:rPr><w:rFonts w:hint="eastAsia" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${font}" w:cs="Times New Roman"/>${boldXml}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr>`;
  // Dedicated monochrome symbol run properties so □ / ☑ NEVER fall back to color emoji on macOS/iOS!
  const boxRPr = `<w:rPr><w:rFonts w:hint="eastAsia" w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun" w:cs="SimSun"/>${boldXml}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr>`;

  const lines = String(text || '').split('\n');
  const runs = lines
    .map((lineText, idx) => {
      const br = idx > 0 ? `<w:r>${rPr}<w:br/></w:r>` : '';
      if (!lineText.includes('☑') && !lineText.includes('□')) {
        return `${br}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(lineText)}</w:t></w:r>`;
      }
      const segs = lineText.split(/([☑□])/g).filter((s) => s.length > 0);
      const segRuns = segs
        .map((seg) => {
          const isBox = seg === '☑' || seg === '□';
          return `<w:r>${isBox ? boxRPr : rPr}<w:t xml:space="preserve">${escapeXml(seg)}</w:t></w:r>`;
        })
        .join('');
      return `${br}${segRuns}`;
    })
    .join('');

  return `<w:p><w:pPr><w:jc w:val="${align}"/>${keepNextXml}<w:spacing w:before="${sb}" w:after="${sa}" w:line="${line}" w:lineRule="auto"/></w:pPr>${runs}</w:p>`;
}

export interface BuildElementsComplaintDocxInput {
  docTitle?: string;
  signerLabel?: string;
  causeTitle: string;
  courtName?: string;
  sections: RenderedComplaintSection[];
  signerName?: string;
  signDate?: string;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
</Relationships>`;

const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:themeFontLang w:val="en-US" w:eastAsia="zh-CN"/>
</w:settings>`;

const FONT_TABLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="FangSong"><w:altName w:val="仿宋"/><w:charset w:val="86"/><w:family w:val="roman"/></w:font>
  <w:font w:name="SimSun"><w:altName w:val="宋体"/><w:charset w:val="86"/><w:family w:val="auto"/></w:font>
  <w:font w:name="SimHei"><w:altName w:val="黑体"/><w:charset w:val="86"/><w:family w:val="modern"/></w:font>
  <w:font w:name="KaiTi"><w:altName w:val="楷体"/><w:charset w:val="86"/><w:family w:val="script"/></w:font>
  <w:font w:name="Times New Roman"><w:charset w:val="00"/><w:family w:val="roman"/></w:font>
</w:fonts>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:hint="eastAsia" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="FangSong" w:cs="Times New Roman"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
        <w:lang w:val="en-US" w:eastAsia="zh-CN"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`;

export function buildElementsComplaintDocxBytes(
  input: BuildElementsComplaintDocxInput
): Uint8Array {
  const {
    docTitle = '民事起诉状',
    signerLabel = '具状人（签字、盖章）',
    causeTitle,
    courtName,
    sections,
    signerName,
    signDate,
  } = input;

  // A4 width 11906 dxa, margins left/right 1260 dxa (~2.22cm) => usable table width 9386 dxa
  const LEFT_COL_W = 2600;
  const RIGHT_COL_W = 6786;
  const TOTAL_W = LEFT_COL_W + RIGHT_COL_W;

  const tableRowsXml: string[] = [];

  for (const sec of sections) {
    // Full-span section header row with subtle gray shading
    tableRowsXml.push(
      `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
        `<w:tc><w:tcPr><w:tcW w:w="${TOTAL_W}" w:type="dxa"/><w:gridSpan w:val="2"/>` +
        `<w:shd w:val="clear" w:color="auto" w:fill="EFEFEF"/>` +
        `<w:tcMar><w:top w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:left w:w="130" w:type="dxa"/><w:right w:w="130" w:type="dxa"/></w:tcMar>` +
        `<w:vAlign w:val="center"/></w:tcPr>` +
        makeParagraph(sec.title, {
          align: 'center',
          bold: true,
          sizeHalfPt: 22,
          font: '黑体',
          spaceBefore: 20,
          spaceAfter: 20,
          line: 260,
        }) +
        `</w:tc></w:tr>`
    );

    for (const row of sec.rows) {
      tableRowsXml.push(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
          `<w:tc><w:tcPr><w:tcW w:w="${LEFT_COL_W}" w:type="dxa"/>` +
          `<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>` +
          `<w:vAlign w:val="center"/></w:tcPr>` +
          makeParagraph(row.label, {
            align: 'left',
            bold: true,
            sizeHalfPt: 21,
            font: '宋体',
            spaceBefore: 20,
            spaceAfter: 20,
            line: 280,
          }) +
          `</w:tc>` +
          `<w:tc><w:tcPr><w:tcW w:w="${RIGHT_COL_W}" w:type="dxa"/>` +
          `<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="130" w:type="dxa"/><w:right w:w="130" w:type="dxa"/></w:tcMar>` +
          `<w:vAlign w:val="center"/></w:tcPr>` +
          makeParagraph(row.value, {
            align: 'left',
            bold: false,
            sizeHalfPt: 21,
            font: '仿宋',
            spaceBefore: 20,
            spaceAfter: 20,
            line: 300,
          }) +
          `</w:tc></w:tr>`
      );
    }
  }

  const tableXml =
    `<w:tbl>` +
    `<w:tblPr>` +
    `<w:tblW w:w="${TOTAL_W}" w:type="dxa"/>` +
    `<w:jc w:val="center"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/>` +
    `</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${LEFT_COL_W}"/><w:gridCol w:w="${RIGHT_COL_W}"/></w:tblGrid>` +
    tableRowsXml.join('') +
    `</w:tbl>`;

  const noticeText =
    '说明：为了方便您参加诉讼，保护您的合法权利，请参照本表如实填写；有“☐”选项的，在对应项打“☑”；本表空间不足的，可另附页说明。';

  const bodyParts: string[] = [
    makeParagraph(docTitle, {
      align: 'center',
      bold: true,
      sizeHalfPt: 36,
      font: '黑体',
      spaceBefore: 0,
      spaceAfter: 60,
      line: 320,
    }),
    makeParagraph(`（${causeTitle}）`, {
      align: 'center',
      bold: true,
      sizeHalfPt: 26,
      font: '宋体',
      spaceBefore: 0,
      spaceAfter: 140,
      line: 280,
    }),
    makeParagraph(noticeText, {
      align: 'left',
      bold: false,
      sizeHalfPt: 19,
      font: '仿宋',
      spaceBefore: 20,
      spaceAfter: 120,
      line: 280,
    }),
    tableXml,
    makeParagraph('', { spaceBefore: 120, spaceAfter: 40 }),
  ];

  if (courtName && courtName.trim()) {
    bodyParts.push(
      makeParagraph('此致', {
        align: 'left',
        bold: false,
        sizeHalfPt: 24,
        font: '仿宋',
        spaceBefore: 100,
        spaceAfter: 40,
      }),
      makeParagraph(courtName.trim(), {
        align: 'left',
        bold: false,
        sizeHalfPt: 24,
        font: '仿宋',
        spaceBefore: 20,
        spaceAfter: 160,
      })
    );
  }

  bodyParts.push(
    makeParagraph(`${signerLabel}：${(signerName || '').trim() || '                    '}`, {
      align: 'right',
      bold: false,
      sizeHalfPt: 24,
      font: '仿宋',
      spaceBefore: 180,
      spaceAfter: 80,
    }),
    makeParagraph(`日期：${(signDate || '').trim() || '    年    月    日'}`, {
      align: 'right',
      bold: false,
      sizeHalfPt: 24,
      font: '仿宋',
      spaceBefore: 20,
      spaceAfter: 60,
    })
  );

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    bodyParts.join('') +
    `<w:sectPr>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1440" w:right="1260" w:bottom="1440" w:left="1260" w:header="720" w:footer="720" w:gutter="0"/>` +
    `</w:sectPr>` +
    `</w:body></w:document>`;

  const encoder = new TextEncoder();
  return createZipStore([
    { name: '[Content_Types].xml', content: encoder.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', content: encoder.encode(ROOT_RELS_XML) },
    { name: 'word/_rels/document.xml.rels', content: encoder.encode(DOC_RELS_XML) },
    { name: 'word/styles.xml', content: encoder.encode(STYLES_XML) },
    { name: 'word/settings.xml', content: encoder.encode(SETTINGS_XML) },
    { name: 'word/fontTable.xml', content: encoder.encode(FONT_TABLE_XML) },
    { name: 'word/document.xml', content: encoder.encode(documentXml) },
  ]);
}

export function downloadElementsComplaintDocx(
  input: BuildElementsComplaintDocxInput,
  filename: string
): void {
  const bytes = buildElementsComplaintDocxBytes(input);
  triggerDocxDownload(bytes, filename);
}

// ---- Official Supreme People's Court (法〔2025〕82号) Exact-Format OOXML (.docx) Builder ----

function makeSpcNoticeParagraphs(rawText: string): string {
  const lines = String(rawText || '').split('\n');
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('★') && trimmed.endsWith('★')) {
        return makeParagraph(trimmed, {
          align: 'center',
          bold: true,
          sizeHalfPt: 21,
          font: '宋体',
          spaceBefore: 60,
          spaceAfter: 30,
          line: 280,
        });
      }
      if (trimmed === '说明：' || trimmed === '说明:') {
        return makeParagraph(trimmed, {
          align: 'left',
          bold: true,
          sizeHalfPt: 21,
          font: '宋体',
          spaceBefore: 20,
          spaceAfter: 20,
          line: 280,
        });
      }
      return makeParagraph(trimmed, {
        align: 'left',
        bold: false,
        sizeHalfPt: 20,
        font: '仿宋',
        spaceBefore: 10,
        spaceAfter: 15,
        line: 270,
      });
    })
    .filter(Boolean)
    .join('');
}

function makeSpcSectionParagraphs(rawText: string): string {
  const lines = String(rawText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return makeParagraph('', { align: 'center', bold: true, sizeHalfPt: 22, font: '宋体', keepNext: true });
  }
  return lines
    .map((line, idx) =>
      makeParagraph(line, {
        align: 'center',
        bold: idx === 0,
        sizeHalfPt: idx === 0 ? 22 : 19,
        font: idx === 0 ? '宋体' : '仿宋',
        spaceBefore: idx === 0 ? 30 : 10,
        spaceAfter: idx === lines.length - 1 ? 30 : 10,
        line: 270,
        keepNext: true,
      })
    )
    .join('');
}

function makeSpcCell(opts: {
  widthDxa: number;
  gridSpan?: number;
  vMerge?: 'restart' | 'continue';
  align?: 'left' | 'center' | 'right';
  contentXml: string;
  vAlign?: 'center' | 'top';
}): string {
  const gsXml = opts.gridSpan && opts.gridSpan > 1 ? `<w:gridSpan w:val="${opts.gridSpan}"/>` : '';
  const vmXml =
    opts.vMerge === 'restart'
      ? '<w:vMerge w:val="restart"/>'
      : opts.vMerge === 'continue'
      ? '<w:vMerge/>'
      : '';
  const vAlign = opts.vAlign || 'center';
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${opts.widthDxa}" w:type="dxa"/>${gsXml}${vmXml}` +
    `<w:tcMar><w:top w:w="75" w:type="dxa"/><w:bottom w:w="75" w:type="dxa"/><w:left w:w="115" w:type="dxa"/><w:right w:w="115" w:type="dxa"/></w:tcMar>` +
    `<w:vAlign w:val="${vAlign}"/></w:tcPr>` +
    opts.contentXml +
    `</w:tc>`
  );
}

function buildSpcAttachmentXml(att: ResolvedSpcAttachment, totalW: number): string {
  const parts: string[] = [
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
    makeParagraph(att.label || '附件', {
      align: 'left',
      bold: true,
      sizeHalfPt: 22,
      font: '黑体',
      spaceBefore: 0,
      spaceAfter: 40,
      line: 280,
    }),
    makeParagraph(att.title || '', {
      align: 'center',
      bold: true,
      sizeHalfPt: 28,
      font: '宋体',
      spaceBefore: 20,
      spaceAfter: att.subtitle ? 40 : 100,
      line: 300,
    }),
  ];

  if (att.subtitle && att.subtitle.trim()) {
    parts.push(
      makeParagraph(att.subtitle.trim(), {
        align: 'center',
        bold: false,
        sizeHalfPt: 20,
        font: '仿宋',
        spaceBefore: 0,
        spaceAfter: 80,
        line: 260,
      })
    );
  }

  const colCount = Math.max(1, att.columns.length, ...att.rows.map((r) => r.length));
  // Smart proportional column widths for standard 5-col evidence list / 6-col cross-exam table / wide tables
  let colWidths: number[] = [];
  if (colCount === 5 && att.columns[0]?.includes('编号') && att.columns[1]?.includes('页码')) {
    colWidths = [820, 820, 2600, 1772, 3400]; // sum = 9412
  } else if (colCount === 6 && att.columns[0]?.includes('编号') && att.columns[2]?.includes('真实性')) {
    colWidths = [760, 2252, 1300, 1300, 1300, 2500]; // sum = 9412
  } else {
    const baseW = Math.floor(totalW / colCount);
    colWidths = Array.from({ length: colCount }, (_, idx) =>
      idx === colCount - 1 ? totalW - baseW * (colCount - 1) : baseW
    );
  }

  const fontSz = colCount >= 10 ? 15 : colCount >= 7 ? 17 : 19;
  const gridXml = colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const trs: string[] = [];

  if (att.columns.length > 0) {
    const headerTds = Array.from({ length: colCount }, (_, ci) =>
      makeSpcCell({
        widthDxa: colWidths[ci],
        contentXml: makeParagraph(att.columns[ci] || '', {
          align: 'center',
          bold: true,
          sizeHalfPt: fontSz,
          font: '宋体',
          spaceBefore: 15,
          spaceAfter: 15,
          line: 240,
        }),
      })
    ).join('');
    trs.push(`<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${headerTds}</w:tr>`);
  }

  for (const row of att.rows) {
    if (row.length === 1 && colCount > 1) {
      trs.push(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
          makeSpcCell({
            widthDxa: totalW,
            gridSpan: colCount,
            contentXml: makeParagraph(row[0] || '', {
              align: 'left',
              bold: true,
              sizeHalfPt: fontSz,
              font: '宋体',
              spaceBefore: 15,
              spaceAfter: 15,
              line: 250,
            }),
          }) +
          `</w:tr>`
      );
    } else {
      const tds = Array.from({ length: colCount }, (_, ci) =>
        makeSpcCell({
          widthDxa: colWidths[ci],
          contentXml: makeParagraph(row[ci] || '', {
            align: ci === 0 ? 'center' : 'left',
            bold: false,
            sizeHalfPt: fontSz,
            font: '仿宋',
            spaceBefore: 15,
            spaceAfter: 15,
            line: 250,
          }),
        })
      ).join('');
      trs.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${tds}</w:tr>`);
    }
  }

  parts.push(
    `<w:tbl><w:tblPr><w:tblW w:w="${totalW}" w:type="dxa"/><w:jc w:val="center"/>` +
      `<w:tblBorders>` +
      `<w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
      `<w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
      `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
      `<w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
      `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
      `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
      `</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
      `<w:tblGrid>${gridXml}</w:tblGrid>${trs.join('')}</w:tbl>`
  );

  for (const fl of att.footerLines) {
    parts.push(
      makeParagraph(fl, {
        align: 'right',
        bold: false,
        sizeHalfPt: 21,
        font: '宋体',
        spaceBefore: 80,
        spaceAfter: 20,
        line: 280,
      })
    );
  }

  return parts.join('');
}

/**
 * Generates an authentic Supreme People's Court (法〔2025〕82号) Word (.docx)
 * preserving exact official structure: 说明 box, section headers, multi-column
 * 案号/案由 & Patent 3-col vMerge grids, verbatim checkboxes (□/☑), official sign-off,
 * and post-signature 附件 tables.
 */
export function buildOfficialSpcDocxBytes(doc: ResolvedSpcDocument): Uint8Array {
  // A4 width 11906 dxa, margins left=1360 (~24mm), right=1134 (~20mm) => usable width 9412 dxa
  const TOTAL_W = 9412;

  const has4Col = doc.rows.some((r) => r.kind === 'grid' && (r.cells?.length || 0) === 4);
  const has3Col = doc.rows.some((r) => r.kind === 'grid' && (r.cells?.length || 0) === 3);

  // Exact twip-aligned column grid covering 1-col, 2-col, 3-col, and 4-col rows cleanly
  // Left col = 2560 dxa (~27.2%) so "（法人、非法人组织）" fits cleanly on 1 centered line!
  let gridCols: number[];
  let fullSpan: number;
  let twoColSpans: [number, number];
  let threeColSpans: [number, number, number];
  let fourColSpans: [number, number, number, number];

  if (has4Col && has3Col) {
    gridCols = [1500, 1060, 2146, 954, 546, 3206]; // sum = 9412
    fullSpan = 6;
    twoColSpans = [2, 4]; // 2560 + 6852
    threeColSpans = [2, 2, 2]; // 2560 + 3100 + 3752
    fourColSpans = [1, 2, 2, 1]; // 1500 + 3206 + 1500 + 3206
  } else if (has4Col) {
    gridCols = [1500, 1060, 2146, 1500, 3206]; // sum = 9412
    fullSpan = 5;
    twoColSpans = [2, 3]; // 2560 + 6852
    threeColSpans = [2, 2, 1];
    fourColSpans = [1, 2, 1, 1]; // 1500 + 3206 + 1500 + 3206
  } else if (has3Col) {
    gridCols = [2560, 3100, 3752]; // sum = 9412
    fullSpan = 3;
    twoColSpans = [1, 2]; // 2560 + 6852
    threeColSpans = [1, 1, 1]; // 2560 + 3100 + 3752
    fourColSpans = [1, 1, 1, 1];
  } else {
    gridCols = [2560, 6852]; // sum = 9412
    fullSpan = 2;
    twoColSpans = [1, 1];
    threeColSpans = [1, 1, 1];
    fourColSpans = [1, 1, 1, 1];
  }

  const trs: string[] = [];

  for (let i = 0; i < doc.rows.length; i++) {
    const r = doc.rows[i];

    if (r.kind === 'notice') {
      trs.push(
        `<w:tr>` +
          makeSpcCell({
            widthDxa: TOTAL_W,
            gridSpan: fullSpan,
            vAlign: 'top',
            contentXml: makeSpcNoticeParagraphs(r.value || ''),
          }) +
          `</w:tr>`
      );
      continue;
    }

    if (r.kind === 'section') {
      trs.push(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
          makeSpcCell({
            widthDxa: TOTAL_W,
            gridSpan: fullSpan,
            contentXml: makeSpcSectionParagraphs(r.value || ''),
          }) +
          `</w:tr>`
      );
      continue;
    }

    if (r.kind === 'guide' || r.kind === 'full_input') {
      const isGuideOnly = r.kind === 'guide' && !(r.value || '').includes('\n');
      const trHeight = isGuideOnly ? '<w:trHeight w:val="680" w:hRule="atLeast"/>' : '';
      trs.push(
        `<w:tr><w:trPr>${trHeight}</w:trPr>` +
          makeSpcCell({
            widthDxa: TOTAL_W,
            gridSpan: fullSpan,
            vAlign: isGuideOnly ? 'top' : 'center',
            contentXml: makeParagraph(r.value || '', {
              align: 'left',
              bold: false,
              sizeHalfPt: 21,
              font: '仿宋',
              spaceBefore: 20,
              spaceAfter: 20,
              line: 290,
            }),
          }) +
          `</w:tr>`
      );
      continue;
    }

    if (r.kind === 'grid' && r.cells && r.cells.length === 4) {
      const widths = [1500, 3206, 1500, 3206];
      const cellsXml = r.cells
        .map((txt, ci) =>
          makeSpcCell({
            widthDxa: widths[ci],
            gridSpan: fourColSpans[ci],
            contentXml: makeParagraph(txt, {
              align: ci === 0 || ci === 2 ? 'center' : 'left',
              bold: ci === 0 || ci === 2,
              sizeHalfPt: 21,
              font: ci === 0 || ci === 2 ? '宋体' : '仿宋',
              spaceBefore: 20,
              spaceAfter: 20,
              line: 280,
            }),
          })
        )
        .join('');
      trs.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cellsXml}</w:tr>`);
      continue;
    }

    if (r.kind === 'grid' && r.cells && r.cells.length === 3) {
      const nextIsContinue = Boolean(doc.rows[i + 1]?.vMergeContinue);
      const col0VMerge: 'restart' | 'continue' | undefined = r.vMergeContinue
        ? 'continue'
        : nextIsContinue
        ? 'restart'
        : undefined;
      const widths = [2560, 3100, 3752];
      const cellsXml = r.cells
        .map((txt, ci) =>
          makeSpcCell({
            widthDxa: widths[ci],
            gridSpan: threeColSpans[ci],
            vMerge: ci === 0 ? col0VMerge : undefined,
            contentXml: makeParagraph(ci === 0 && col0VMerge === 'continue' ? '' : txt, {
              align: ci === 0 ? 'center' : 'left',
              bold: ci === 0,
              sizeHalfPt: 21,
              font: ci === 0 ? '宋体' : '仿宋',
              spaceBefore: 20,
              spaceAfter: 20,
              line: 280,
            }),
          })
        )
        .join('');
      trs.push(`<w:tr>${cellsXml}</w:tr>`);
      continue;
    }

    // Standard official 2-column element row
    const leftXml = makeSpcCell({
      widthDxa: 2560,
      gridSpan: twoColSpans[0],
      contentXml: makeParagraph(r.label || '', {
        align: 'center',
        bold: false,
        sizeHalfPt: 21,
        font: '宋体',
        spaceBefore: 20,
        spaceAfter: 20,
        line: 280,
      }),
    });
    const rightXml = makeSpcCell({
      widthDxa: 6852,
      gridSpan: twoColSpans[1],
      contentXml: makeParagraph(r.value || '', {
        align: 'left',
        bold: false,
        sizeHalfPt: 21,
        font: '仿宋',
        spaceBefore: 20,
        spaceAfter: 20,
        line: 290,
      }),
    });
    // Allow very long party/mediation rows to flow cleanly across pages, keep short rows together
    const rowLen = (r.value || '').length;
    const trPr = rowLen < 320 ? '<w:trPr><w:cantSplit/></w:trPr>' : '';
    trs.push(`<w:tr>${trPr}${leftXml}${rightXml}</w:tr>`);
  }

  const mainTableXml =
    `<w:tbl>` +
    `<w:tblPr>` +
    `<w:tblW w:w="${TOTAL_W}" w:type="dxa"/>` +
    `<w:jc w:val="center"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/>` +
    `</w:tblPr>` +
    `<w:tblGrid>${gridCols.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    trs.join('') +
    `</w:tbl>`;

  const bodyParts: string[] = [
    makeParagraph(doc.docTitle, {
      align: 'center',
      bold: true,
      sizeHalfPt: 44, // 22pt 二号 (matches official SPC 22pt title)
      font: '宋体',
      spaceBefore: 0,
      spaceAfter: doc.docSubtitle ? 40 : 140,
      line: 320,
    }),
  ];

  if (doc.docSubtitle) {
    bodyParts.push(
      makeParagraph(doc.docSubtitle, {
        align: 'center',
        bold: true,
        sizeHalfPt: 32, // 16pt 三号 (matches official SPC 16-18pt subtitle)
        font: '宋体',
        spaceBefore: 0,
        spaceAfter: 140,
        line: 290,
      })
    );
  }

  bodyParts.push(
    mainTableXml,
    makeParagraph(`${doc.signerLine}${doc.signerName || '                    '}`, {
      align: 'right',
      bold: false,
      sizeHalfPt: 24, // 小四 12pt
      font: '宋体',
      spaceBefore: 220,
      spaceAfter: 60,
      line: 300,
    }),
    makeParagraph(`${doc.dateLine}${doc.signDate || '      年    月    日'}`, {
      align: 'right',
      bold: false,
      sizeHalfPt: 24,
      font: '宋体',
      spaceBefore: 20,
      spaceAfter: 60,
      line: 300,
    })
  );

  for (const fnLine of doc.footnotes || []) {
    bodyParts.push(
      makeParagraph(fnLine, {
        align: 'left',
        bold: fnLine === '注释：' || fnLine === '注释:',
        sizeHalfPt: 19,
        font: fnLine === '注释：' || fnLine === '注释:' ? '宋体' : '仿宋',
        spaceBefore: fnLine === '注释：' || fnLine === '注释:' ? 140 : 20,
        spaceAfter: 30,
        line: 270,
      })
    );
  }

  for (const att of doc.attachments || []) {
    bodyParts.push(buildSpcAttachmentXml(att, TOTAL_W));
  }

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    bodyParts.join('') +
    `<w:sectPr>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1360" w:header="720" w:footer="720" w:gutter="0"/>` +
    `</w:sectPr>` +
    `</w:body></w:document>`;

  const encoder = new TextEncoder();
  return createZipStore([
    { name: '[Content_Types].xml', content: encoder.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', content: encoder.encode(ROOT_RELS_XML) },
    { name: 'word/_rels/document.xml.rels', content: encoder.encode(DOC_RELS_XML) },
    { name: 'word/styles.xml', content: encoder.encode(STYLES_XML) },
    { name: 'word/settings.xml', content: encoder.encode(SETTINGS_XML) },
    { name: 'word/fontTable.xml', content: encoder.encode(FONT_TABLE_XML) },
    { name: 'word/document.xml', content: encoder.encode(documentXml) },
  ]);
}

export function downloadOfficialSpcDocx(doc: ResolvedSpcDocument, filename: string): void {
  const bytes = buildOfficialSpcDocxBytes(doc);
  triggerDocxDownload(bytes, filename);
}

function triggerDocxDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---- Markdown / AI Report to Court-Ready Word (.docx) Exporter ----

function makeInlineFormattedRuns(
  rawText: string,
  opts: { sizeHalfPt: number; font: string; baseBold?: boolean }
): string {
  const font = canonicalCjkFont(opts.font);
  const parts = String(rawText || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  if (parts.length === 0) {
    return `<w:r><w:rPr><w:rFonts w:hint="eastAsia" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${font}" w:cs="Times New Roman"/><w:sz w:val="${opts.sizeHalfPt}"/><w:szCs w:val="${opts.sizeHalfPt}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr><w:t xml:space="preserve"></w:t></w:r>`;
  }
  return parts
    .map((seg) => {
      let text = seg;
      let isBold = Boolean(opts.baseBold);
      if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
        text = seg.slice(2, -2);
        isBold = true;
      } else if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
        text = seg.slice(1, -1);
      }
      const boldXml = isBold ? '<w:b/><w:bCs/>' : '';
      return `<w:r><w:rPr><w:rFonts w:hint="eastAsia" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${font}" w:cs="Times New Roman"/>${boldXml}<w:sz w:val="${opts.sizeHalfPt}"/><w:szCs w:val="${opts.sizeHalfPt}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
    })
    .join('');
}

function buildMdTableXml(rows: string[][]): string {
  if (rows.length === 0) return '';
  const colCount = Math.max(1, ...rows.map((r) => r.length));
  const totalW = 9266;
  const colW = Math.floor(totalW / colCount);
  const gridXml = Array.from({ length: colCount }, () => `<w:gridCol w:w="${colW}"/>`).join('');

  const trs = rows
    .map((cells, rIdx) => {
      const isHeader = rIdx === 0;
      const tds = Array.from({ length: colCount }, (_, cIdx) => {
        const val = (cells[cIdx] || '').trim();
        const shd = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="EFEFEF"/>' : '';
        return (
          `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${shd}` +
          `<w:tcMar><w:top w:w="70" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar>` +
          `<w:vAlign w:val="center"/></w:tcPr>` +
          `<w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="280" w:lineRule="auto"/></w:pPr>` +
          makeInlineFormattedRuns(val, {
            sizeHalfPt: 20,
            font: isHeader ? 'SimSun' : 'FangSong',
            baseBold: isHeader,
          }) +
          `</w:p></w:tc>`
        );
      }).join('');
      return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tds}</w:tr>`;
    })
    .join('');

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${totalW}" w:type="dxa"/><w:jc w:val="center"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${gridXml}</w:tblGrid>${trs}</w:tbl>`
  );
}

export interface BuildMarkdownReportDocxInput {
  title: string;
  subtitle?: string;
  markdownBody: string;
}

export function buildMarkdownReportDocxBytes(input: BuildMarkdownReportDocxInput): Uint8Array {
  const { title, subtitle, markdownBody } = input;
  const blocks: string[] = [
    makeParagraph(title || '法律实务文书底稿', {
      align: 'center',
      bold: true,
      sizeHalfPt: 34,
      font: '黑体',
      spaceBefore: 0,
      spaceAfter: 80,
      line: 320,
    }),
  ];

  if (subtitle && subtitle.trim()) {
    blocks.push(
      makeParagraph(subtitle.trim(), {
        align: 'center',
        bold: false,
        sizeHalfPt: 20,
        font: '仿宋',
        spaceBefore: 0,
        spaceAfter: 160,
        line: 280,
      })
    );
  }

  const lines = String(markdownBody || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal rule -> light visual spacer
    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push(makeParagraph('', { spaceBefore: 40, spaceAfter: 40 }));
      i++;
      continue;
    }

    // Markdown table detection
    if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      const tableRows: string[][] = [];
      const parseRow = (line: string) =>
        line
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      tableRows.push(parseRow(trimmed));
      i += 2; // skip separator
      while (i < lines.length && lines[i].trim().includes('|')) {
        tableRows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push(buildMdTableXml(tableRows));
      blocks.push(makeParagraph('', { spaceBefore: 40, spaceAfter: 40 }));
      continue;
    }

    // Headings # / ## / ###
    const hMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (hMatch) {
      const lvl = hMatch[1].length;
      const cleanHeading = hMatch[2].replace(/\*\*/g, '').trim();
      blocks.push(
        makeParagraph(cleanHeading, {
          align: 'left',
          bold: true,
          sizeHalfPt: lvl === 1 ? 28 : lvl === 2 ? 25 : 23,
          font: lvl <= 2 ? '黑体' : '宋体',
          spaceBefore: lvl <= 2 ? 160 : 120,
          spaceAfter: 70,
          line: 300,
        })
      );
      i++;
      continue;
    }

    // Bullet list items
    const ulMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (ulMatch) {
      blocks.push(
        `<w:p><w:pPr><w:ind w:left="360" w:hanging="180"/><w:spacing w:before="30" w:after="40" w:line="320" w:lineRule="auto"/></w:pPr>` +
          makeInlineFormattedRuns(`• ${ulMatch[1]}`, { sizeHalfPt: 23, font: '仿宋' }) +
          `</w:p>`
      );
      i++;
      continue;
    }

    // Blockquote
    const bqMatch = trimmed.match(/^>\s*(.*)$/);
    if (bqMatch) {
      blocks.push(
        `<w:p><w:pPr><w:ind w:left="420"/><w:spacing w:before="40" w:after="60" w:line="300" w:lineRule="auto"/></w:pPr>` +
          makeInlineFormattedRuns(bqMatch[1], { sizeHalfPt: 21, font: '楷体' }) +
          `</w:p>`
      );
      i++;
      continue;
    }

    // Standard body paragraph (first-line indent 2 chars for clean Chinese legal style unless numbered/bold heading)
    const isShortHeading = /^\*\*[^*]+\*\*[：:]?$/.test(trimmed) || /^[一二三四五六七八九十]+[、.]/.test(trimmed);
    const indentXml = isShortHeading ? '' : '<w:ind w:firstLineChars="200" w:firstLine="460"/>';
    blocks.push(
      `<w:p><w:pPr>${indentXml}<w:spacing w:before="40" w:after="60" w:line="340" w:lineRule="auto"/></w:pPr>` +
        makeInlineFormattedRuns(trimmed, {
          sizeHalfPt: 24,
          font: isShortHeading ? '黑体' : '仿宋',
          baseBold: isShortHeading,
        }) +
        `</w:p>`
    );
    i++;
  }

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    blocks.join('') +
    `<w:sectPr>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1440" w:right="1320" w:bottom="1440" w:left="1320" w:header="720" w:footer="720" w:gutter="0"/>` +
    `</w:sectPr>` +
    `</w:body></w:document>`;

  const encoder = new TextEncoder();
  return createZipStore([
    { name: '[Content_Types].xml', content: encoder.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', content: encoder.encode(ROOT_RELS_XML) },
    { name: 'word/_rels/document.xml.rels', content: encoder.encode(DOC_RELS_XML) },
    { name: 'word/styles.xml', content: encoder.encode(STYLES_XML) },
    { name: 'word/settings.xml', content: encoder.encode(SETTINGS_XML) },
    { name: 'word/fontTable.xml', content: encoder.encode(FONT_TABLE_XML) },
    { name: 'word/document.xml', content: encoder.encode(documentXml) },
  ]);
}

export function downloadMarkdownReportDocx(
  input: BuildMarkdownReportDocxInput,
  filename: string
): void {
  const bytes = buildMarkdownReportDocxBytes(input);
  triggerDocxDownload(bytes, filename);
}
