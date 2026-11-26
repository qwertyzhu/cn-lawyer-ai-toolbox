/**
 * Verified PDF Volume Splitter for Court E-Filing Portals.
 *
 * Ensures every output volume's actual byte length is strictly measured against the chosen
 * limit unit:
 * - 'decimal_mb': 1 MB = 1,000,000 bytes (strictest, guarantees passing portals using 10^6 bytes)
 * - 'binary_mib': 1 MiB = 1,048,576 bytes (1024 * 1024 bytes)
 *
 * If any single page alone exceeds `maxBytes`, `allWithinLimit` is FALSE and `oversizeVolumes`
 * pinpoints the exact page numbers and measured sizes so the UI NEVER falsely reports "达标".
 */

import { PDFDocument } from 'pdf-lib';

export type PdfByteLimitUnit = 'decimal_mb' | 'binary_mib';

export interface SplitVolumeItem {
  volIndex: number;
  fileName: string;
  pageStart: number;
  pageEnd: number;
  pageCount: number;
  bytes: Uint8Array;
  byteLength: number;
  exceedsLimit: boolean;
}

export interface VerifiedPdfSplitResult {
  volumes: SplitVolumeItem[];
  totalPages: number;
  maxVolBytes: number;
  limitBytes: number;
  limitUnit: PdfByteLimitUnit;
  allWithinLimit: boolean;
  oversizeVolumes: SplitVolumeItem[];
}

export function resolveLimitBytes(maxMb: number, unit: PdfByteLimitUnit): number {
  return unit === 'decimal_mb' ? maxMb * 1_000_000 : maxMb * 1024 * 1024;
}

export function formatPdfBytes(bytes: number, unit: PdfByteLimitUnit = 'binary_mib'): string {
  if (unit === 'decimal_mb') {
    if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
    return `${(bytes / 1_000_000).toFixed(2)} MB（十进制）`;
  }
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export async function splitPdfIntoVerifiedVolumes(params: {
  pdfBytes: Uint8Array;
  baseName: string;
  maxMb: number;
  unit?: PdfByteLimitUnit;
  onProgress?: (msg: string) => void;
}): Promise<VerifiedPdfSplitResult> {
  const { pdfBytes, baseName, maxMb, unit = 'decimal_mb', onProgress } = params;
  const limitBytes = resolveLimitBytes(maxMb, unit);
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  const avgPerPage = Math.max(20 * 1024, pdfBytes.byteLength / Math.max(1, totalPages));

  const volumes: SplitVolumeItem[] = [];
  let cursor = 0;
  let volIndex = 1;
  let maxVolBytes = 0;

  while (cursor < totalPages) {
    let take = Math.max(
      1,
      Math.min(totalPages - cursor, Math.floor((limitBytes * 0.9) / avgPerPage))
    );
    let chosenBytes: Uint8Array | null = null;
    let chosenCount = take;

    while (true) {
      onProgress?.(
        `正在按 ${maxMb}${unit === 'decimal_mb' ? 'MB' : 'MiB'} 切分核验：第 ${volIndex} 卷（第 ${cursor + 1}–${cursor + take} 页）…`
      );
      const subDoc = await PDFDocument.create();
      const pageIndices = Array.from({ length: take }, (_, idx) => cursor + idx);
      const copied = await subDoc.copyPages(src, pageIndices);
      copied.forEach((p) => subDoc.addPage(p));
      const candidate = await subDoc.save({ useObjectStreams: true });
      chosenBytes = candidate;
      chosenCount = take;
      if (candidate.byteLength <= limitBytes || take === 1) break;
      const nextTake = Math.floor(take * (limitBytes / candidate.byteLength) * 0.9);
      take = Math.max(1, Math.min(take - 1, nextTake));
    }

    if (chosenBytes) {
      const exceedsLimit = chosenBytes.byteLength > limitBytes;
      maxVolBytes = Math.max(maxVolBytes, chosenBytes.byteLength);
      volumes.push({
        volIndex,
        fileName: `${baseName}-第${volIndex}卷(第${cursor + 1}-${cursor + chosenCount}页).pdf`,
        pageStart: cursor + 1,
        pageEnd: cursor + chosenCount,
        pageCount: chosenCount,
        bytes: chosenBytes,
        byteLength: chosenBytes.byteLength,
        exceedsLimit,
      });
    }
    cursor += chosenCount;
    volIndex++;
  }

  const oversizeVolumes = volumes.filter((v) => v.exceedsLimit);
  return {
    volumes,
    totalPages,
    maxVolBytes,
    limitBytes,
    limitUnit: unit,
    allWithinLimit: oversizeVolumes.length === 0,
    oversizeVolumes,
  };
}
