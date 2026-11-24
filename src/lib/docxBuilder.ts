/**
 * 100% Browser-local, zero-dependency OOXML (.docx) generator for Supreme People's Court
 * element-style civil complaints (要素式民事起诉状).
 *
 * Produces a standard PKZIP (STORE method, UTF-8 filenames, IEEE CRC32) archive containing
 * valid WordprocessingML XML parts that open natively in Microsoft Word, WPS Office,
 * Apple Pages, and LibreOffice with clean A4 two-column bordered court tables.
 */

import type { RenderedComplaintSection } from '../data/elementsComplaintTemplates';

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
  }
): string {
  const align = opts?.align || 'left';
  const size = opts?.sizeHalfPt ?? 21;
  const font = canonicalCjkFont(opts?.font || 'FangSong');
  const sb = opts?.spaceBefore ?? 40;
  const sa = opts?.spaceAfter ?? 40;
  const line = opts?.line ?? 300;
  const boldXml = opts?.bold ? '<w:b/><w:bCs/>' : '';
  const rPr = `<w:rPr><w:rFonts w:hint="eastAsia" w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${font}" w:cs="Times New Roman"/>${boldXml}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr>`;

  const lines = String(text || '').split('\n');
  const runs = lines
    .map((lineText, idx) => {
      const br = idx > 0 ? '<w:br/>' : '';
      return `<w:r>${rPr}${br}<w:t xml:space="preserve">${escapeXml(lineText)}</w:t></w:r>`;
    })
    .join('');

  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="${sb}" w:after="${sa}" w:line="${line}" w:lineRule="auto"/></w:pPr>${runs}</w:p>`;
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
