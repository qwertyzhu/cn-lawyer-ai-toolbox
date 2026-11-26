import React, { useRef, useState } from 'react';
import { Link } from '../../components/ToolboxBridgeLink';
import type { PDFDocument } from 'pdf-lib';

async function loadPdfDocumentCtor() {
  const mod = await import('pdf-lib');
  return mod.PDFDocument;
}
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  FilePlus2,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  Scissors,
  ShieldCheck,
  Stamp,
  Trash2,
} from 'lucide-react';
import { trackEvent } from '../../components/ToolboxBridgeLink';
import { downloadZipBundle } from '../../lib/docxBuilder';
import {
  formatPdfBytes,
  resolveLimitBytes,
  splitPdfIntoVerifiedVolumes,
  type PdfByteLimitUnit,
  type VerifiedPdfSplitResult,
} from '../../lib/pdfVolumeSplitter';

type PdfTab = 'merge_build' | 'stamp_number' | 'split_extract';
type QualityPreset = 'high' | 'balanced' | 'compact';
type PageNumPos = 'bottom-center' | 'bottom-right' | 'top-right';
type PageNumFmt = 'cn_full' | 'cn_evidence' | 'slash';

interface QueuedFile {
  id: string;
  file: File;
  kind: 'pdf' | 'image';
  pages: number;
  size: number;
}

const QUALITY_MAP: Record<QualityPreset, { label: string; desc: string; maxDim: number; quality: number }> = {
  high: { label: '高清立案（推荐 50MB 档）', desc: '最长边 2200px · 文字印章极清', maxDim: 2200, quality: 0.86 },
  balanced: { label: '标准平衡（推荐 10MB 档）', desc: '最长边 1500px · 兼顾清晰与体积', maxDim: 1500, quality: 0.72 },
  compact: { label: '极限瘦身', desc: '最长边 1100px · 百张截图快速瘦身', maxDim: 1100, quality: 0.56 },
};

type VolumeCapMb = 50 | 10 | 0;

const VOLUME_CAP_OPTIONS: { value: VolumeCapMb; label: string; desc: string }[] = [
  { value: 50, label: '50MB 档（大卷宗 / 仲裁 / 邮件）', desc: '适合大型证据合订册与高清扫描件' },
  { value: 10, label: '10MB 档（法院网上立案）', desc: '适配人民法院在线服务单文件限制' },
  { value: 0, label: '不限体积（高清归档）', desc: '单文件完整输出，不做体积拆分' },
];

const WATERMARK_PRESETS = [
  '仅限本案诉讼举证使用 · 复印无效',
  '证据材料 · 仅供审阅',
  '复印件与原件核对无异 · 仅作举证',
];

let oflSansPromise: Promise<void> | null = null;

/** Lazily loads our self-hosted SIL OFL 1.1 Noto Sans SC subset for crisp commercial-safe Chinese PDF stamps */
async function ensureOflStampFont(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document) || typeof FontFace === 'undefined') return;
  if (!oflSansPromise) {
    oflSansPromise = (async () => {
      const loadedAlready = Array.from(document.fonts).some(
        (f) => f.family === 'ToolboxPdfOflSans' && f.status === 'loaded'
      );
      if (loadedAlready) return;
      const face = new FontFace(
        'ToolboxPdfOflSans',
        `url(${import.meta.env.BASE_URL}fonts/ofl-noto-sans-sc-medium.woff2) format("woff2")`,
        { weight: '500', style: 'normal' }
      );
      const loaded = await face.load();
      document.fonts.add(loaded);
      await document.fonts.ready;
    })().catch(() => {
      oflSansPromise = null;
    });
  }
  await oflSansPromise;
}

/** Renders crisp transparent PNG stamp via Canvas for Chinese text (0 bloat, 100% SIL OFL 1.1) */
function renderTextStampPng(
  text: string,
  opts: { fontSize: number; color: string; rotateDeg?: number; paddingX?: number; paddingY?: number }
): { bytes: Uint8Array; width: number; height: number } {
  const scale = 2; // Retina crispness
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontSpec = `500 ${opts.fontSize * scale}px "ToolboxPdfOflSans", "Noto Sans SC", sans-serif`;
  ctx.font = fontSpec;
  const metrics = ctx.measureText(text);
  const textW = Math.ceil(metrics.width);
  const textH = Math.ceil(opts.fontSize * scale * 1.45);
  const padX = (opts.paddingX ?? 10) * scale;
  const padY = (opts.paddingY ?? 6) * scale;
  const rawW = textW + padX * 2;
  const rawH = textH + padY * 2;

  const rad = ((opts.rotateDeg || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const outW = Math.ceil(rawW * cos + rawH * sin);
  const outH = Math.ceil(rawW * sin + rawH * cos);

  canvas.width = Math.max(2, outW);
  canvas.height = Math.max(2, outH);
  const ctx2 = canvas.getContext('2d')!;
  ctx2.translate(canvas.width / 2, canvas.height / 2);
  ctx2.rotate(rad);
  ctx2.font = fontSpec;
  ctx2.fillStyle = opts.color;
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, 0, 0);

  const dataUrl = canvas.toDataURL('image/png');
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, width: outW / scale, height: outH / scale };
}

/** Compresses any image File (JPG/PNG/WebP) into a clean JPEG byte array on browser Canvas */
async function compressImageToJpeg(file: File, preset: QualityPreset): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const cfg = QUALITY_MAP[preset];
  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`无法解析图片：${file.name}`));
      el.src = imgUrl;
    });
    const ratio = Math.min(1, cfg.maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', cfg.quality);
    });
    const buf = await blob.arrayBuffer();
    return { bytes: new Uint8Array(buf), w, h };
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

/** Parses human page range like "1-3, 5, 8-10" into 0-based indices */
function parsePageRanges(spec: string, totalPages: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const parts = spec
    .replace(/，/g, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const start = Math.max(1, Number(m[1]));
      const end = Math.min(totalPages, Number(m[2]));
      if (start <= end) {
        for (let p = start; p <= end; p++) {
          if (!seen.has(p - 1)) {
            seen.add(p - 1);
            out.push(p - 1);
          }
        }
      }
    } else if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p >= 1 && p <= totalPages && !seen.has(p - 1)) {
        seen.add(p - 1);
        out.push(p - 1);
      }
    }
  }
  return out;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function triggerDownload(bytes: Uint8Array, filename: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const EvidencePdfToolkit: React.FC = () => {
  const [tab, setTab] = useState<PdfTab>('merge_build');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [lastOutputInfo, setLastOutputInfo] = useState<{
    name: string;
    size: number;
    pages: number;
    volumes?: number;
  } | null>(null);
  const [lastOutputBytes, setLastOutputBytes] = useState<Uint8Array | null>(null);

  // Tab 1: Merge PDF + Images
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [quality, setQuality] = useState<QualityPreset>('balanced');
  const [targetLimitMb, setTargetLimitMb] = useState<VolumeCapMb>(50);
  const [byteLimitUnit, setByteLimitUnit] = useState<PdfByteLimitUnit>('decimal_mb');
  const [autoSplitOnLimit, setAutoSplitOnLimit] = useState(true);
  const [lastSplitResult, setLastSplitResult] = useState<{
    baseName: string;
    maxMb: number;
    result: VerifiedPdfSplitResult;
  } | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);

  // Shared Stamp & Page Number options (used by both Tab 1 optional & Tab 2)
  const [enablePageNum, setEnablePageNum] = useState(true);
  const [pageNumFmt, setPageNumFmt] = useState<PageNumFmt>('cn_full');
  const [pageNumPos, setPageNumPos] = useState<PageNumPos>('bottom-center');
  const [startNum, setStartNum] = useState(1);
  const [skipFirstPage, setSkipFirstPage] = useState(false);

  const [enableWatermark, setEnableWatermark] = useState(false);
  const [watermarkText, setWatermarkText] = useState(WATERMARK_PRESETS[0]);
  const [watermarkOpacity, setWatermarkOpacity] = useState(22);
  const [watermarkTiled, setWatermarkTiled] = useState(false);

  // Tab 2: Stamp existing PDF
  const [stampFile, setStampFile] = useState<{ file: File; pages: number } | null>(null);

  // Tab 3: Split existing PDF
  const [splitFile, setSplitFile] = useState<{ file: File; pages: number } | null>(null);
  const [splitRange, setSplitRange] = useState('1-3');

  const applyOverlays = async (
    doc: PDFDocument,
    opts: { pageNum: boolean; watermark: boolean }
  ) => {
    if (!opts.pageNum && !opts.watermark) return;
    await ensureOflStampFont();
    const pages = doc.getPages();
    const totalCount = pages.length;

    let wmImage: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
    let wmDims = { width: 0, height: 0 };
    if (opts.watermark && watermarkText.trim()) {
      const alpha = Math.max(0.08, Math.min(0.6, watermarkOpacity / 100));
      const stamp = renderTextStampPng(watermarkText.trim(), {
        fontSize: watermarkTiled ? 18 : 26,
        color: `rgba(120, 30, 30, ${alpha.toFixed(2)})`,
        rotateDeg: -34,
        paddingX: 14,
        paddingY: 10,
      });
      wmImage = await doc.embedPng(stamp.bytes);
      wmDims = { width: stamp.width, height: stamp.height };
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();

      if (wmImage) {
        if (watermarkTiled) {
          const stepX = Math.max(220, wmDims.width + 60);
          const stepY = Math.max(180, wmDims.height + 70);
          for (let x = 20; x < width; x += stepX) {
            for (let y = 30; y < height; y += stepY) {
              page.drawImage(wmImage, { x, y, width: wmDims.width, height: wmDims.height });
            }
          }
        } else {
          const scale = Math.min(1, (width * 0.78) / Math.max(1, wmDims.width));
          const drawW = wmDims.width * scale;
          const drawH = wmDims.height * scale;
          page.drawImage(wmImage, {
            x: (width - drawW) / 2,
            y: (height - drawH) / 2,
            width: drawW,
            height: drawH,
          });
        }
      }

      if (opts.pageNum && !(skipFirstPage && i === 0)) {
        const displayIndex = startNum + (skipFirstPage ? i - 1 : i);
        const displayTotal = startNum - 1 + (skipFirstPage ? Math.max(1, totalCount - 1) : totalCount);
        const label =
          pageNumFmt === 'cn_full'
            ? `第 ${displayIndex} 页 / 共 ${displayTotal} 页`
            : pageNumFmt === 'cn_evidence'
            ? `证据第 ${displayIndex} 页`
            : `${displayIndex} / ${displayTotal}`;
        const numStamp = renderTextStampPng(label, {
          fontSize: 10.5,
          color: 'rgba(30, 36, 46, 0.85)',
          paddingX: 8,
          paddingY: 4,
        });
        const numImg = await doc.embedPng(numStamp.bytes);
        let x = (width - numStamp.width) / 2;
        let y = 16;
        if (pageNumPos === 'bottom-right') {
          x = width - numStamp.width - 24;
          y = 16;
        } else if (pageNumPos === 'top-right') {
          x = width - numStamp.width - 24;
          y = height - numStamp.height - 16;
        }
        page.drawImage(numImg, { x: Math.max(10, x), y: Math.max(10, y), width: numStamp.width, height: numStamp.height });
      }
    }
  };

  const handleAddMergeFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg('');
    const added: QueuedFile[] = [];
    for (const file of Array.from(fileList)) {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isImg = file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name);
      if (!isPdf && !isImg) continue;
      let pages = 1;
      if (isPdf) {
        try {
          const buf = await file.arrayBuffer();
          const PdfDoc = await loadPdfDocumentCtor();
          const doc = await PdfDoc.load(buf, { ignoreEncryption: true });
          pages = doc.getPageCount();
        } catch {
          setErrorMsg(`无法读取加密或损坏的 PDF：${file.name}`);
          continue;
        }
      }
      added.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        kind: isPdf ? 'pdf' : 'image',
        pages,
        size: file.size,
      });
    }
    setQueue((prev) => [...prev, ...added]);
    if (mergeInputRef.current) mergeInputRef.current.value = '';
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= queue.length) return;
    const copy = [...queue];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    setQueue(copy);
  };

  /** Splits any PDF byte array into verified volumes and tracks oversize single-page warnings */
  const runVerifiedVolumeSplit = async (
    pdfBytes: Uint8Array,
    baseName: string,
    maxMb: number,
    unit: PdfByteLimitUnit = byteLimitUnit
  ): Promise<VerifiedPdfSplitResult> => {
    const res = await splitPdfIntoVerifiedVolumes({
      pdfBytes,
      baseName,
      maxMb,
      unit,
      onProgress: (msg) => setStatusMsg(msg),
    });
    setLastSplitResult({ baseName, maxMb, result: res });

    if (res.volumes.length <= 3) {
      for (const vol of res.volumes) {
        triggerDownload(vol.bytes, vol.fileName);
        await new Promise((r) => setTimeout(r, 180));
      }
    } else {
      downloadZipBundle(
        res.volumes.map((v) => ({ name: v.fileName, data: v.bytes })),
        `${baseName}-共${res.volumes.length}卷.zip`
      );
    }
    return res;
  };

  const handleBuildMergedPdf = async (overrideQuality?: QualityPreset) => {
    if (queue.length === 0) {
      setErrorMsg('请先添加至少 1 个 PDF 或图片证据文件。');
      return;
    }
    const effectiveQuality = overrideQuality || quality;
    if (overrideQuality) setQuality(overrideQuality);
    setBusy(true);
    setErrorMsg('');
    setStatusMsg('正在本地浏览器合并卷宗与压缩图片...');
    setLastOutputInfo(null);
    setLastSplitResult(null);
    try {
      const PdfDoc = await loadPdfDocumentCtor();
      const outDoc = await PdfDoc.create();
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        setStatusMsg(`正在处理 (${i + 1}/${queue.length})：${item.file.name}`);
        if (item.kind === 'pdf') {
          const buf = await item.file.arrayBuffer();
          const src = await PdfDoc.load(buf, { ignoreEncryption: true });
          const copiedPages = await outDoc.copyPages(src, src.getPageIndices());
          copiedPages.forEach((p) => outDoc.addPage(p));
        } else {
          const { bytes, w, h } = await compressImageToJpeg(item.file, effectiveQuality);
          const jpg = await outDoc.embedJpg(bytes);
          // Standard A4 portrait (595.28 x 841.89 pt) with clean filing margins
          const a4W = 595.28;
          const a4H = 841.89;
          const margin = 32;
          const isLandscape = w > h * 1.25;
          const pageW = isLandscape ? a4H : a4W;
          const pageH = isLandscape ? a4W : a4H;
          const page = outDoc.addPage([pageW, pageH]);
          const maxW = pageW - margin * 2;
          const maxH = pageH - margin * 2 - (enablePageNum ? 18 : 0);
          const scale = Math.min(maxW / w, maxH / h);
          const drawW = w * scale;
          const drawH = h * scale;
          page.drawImage(jpg, {
            x: (pageW - drawW) / 2,
            y: (pageH - drawH) / 2 + (enablePageNum ? 8 : 0),
            width: drawW,
            height: drawH,
          });
        }
      }

      if (enablePageNum || enableWatermark) {
        setStatusMsg('正在本地叠加中文证据页码与举证水印...');
        await applyOverlays(outDoc, { pageNum: enablePageNum, watermark: enableWatermark });
      }

      const outBytes = await outDoc.save({ useObjectStreams: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      const baseName = `证据卷宗-${dateStr}`;
      const fileName = `${baseName}.pdf`;
      setLastOutputBytes(outBytes);

      const limitBytes = targetLimitMb > 0 ? resolveLimitBytes(targetLimitMb, byteLimitUnit) : 0;
      if (targetLimitMb > 0 && autoSplitOnLimit && outBytes.byteLength > limitBytes) {
        const res = await runVerifiedVolumeSplit(outBytes, baseName, targetLimitMb, byteLimitUnit);
        setLastOutputInfo({
          name: `${baseName}-第1至${res.volumes.length}卷.pdf`,
          size: outBytes.byteLength,
          pages: res.totalPages,
          volumes: res.volumes.length,
        });
        setStatusMsg(
          res.allWithinLimit
            ? `总体积 ${formatPdfBytes(outBytes.byteLength, byteLimitUnit)}，已按 ${targetLimitMb}MB 切分核验为 ${res.volumes.length} 卷！`
            : `已切分为 ${res.volumes.length} 卷，但其中 ${res.oversizeVolumes.length} 卷单页本身超出 ${targetLimitMb}MB 上限，请查看下方告警！`
        );
      } else {
        triggerDownload(outBytes, fileName);
        setLastOutputInfo({ name: fileName, size: outBytes.byteLength, pages: outDoc.getPageCount() });
        setStatusMsg('合并完成，已自动下载到本地！');
      }
      trackEvent('tool_result');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'PDF 生成失败，请检查文件格式。');
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSinglePdf = async (file: File | null, target: 'stamp' | 'split') => {
    if (!file) return;
    setErrorMsg('');
    try {
      const buf = await file.arrayBuffer();
      const PdfDoc = await loadPdfDocumentCtor();
      const doc = await PdfDoc.load(buf, { ignoreEncryption: true });
      const info = { file, pages: doc.getPageCount() };
      if (target === 'stamp') setStampFile(info);
      else {
        setSplitFile(info);
        setSplitRange(`1-${Math.min(3, info.pages)}`);
      }
    } catch {
      setErrorMsg(`无法解析该 PDF 文件：${file.name}`);
    }
  };

  const handleRunStampPdf = async () => {
    if (!stampFile) {
      setErrorMsg('请先选择一个 PDF 文件。');
      return;
    }
    if (!enablePageNum && !enableWatermark) {
      setErrorMsg('请至少勾选「加连续证据页码」或「加举证水印」之一。');
      return;
    }
    setBusy(true);
    setErrorMsg('');
    setLastSplitResult(null);
    setStatusMsg('正在本地加载思源开源字体并叠加页码/水印...');
    try {
      const buf = await stampFile.file.arrayBuffer();
      const PdfDoc = await loadPdfDocumentCtor();
      const doc = await PdfDoc.load(buf, { ignoreEncryption: true });
      await applyOverlays(doc, { pageNum: enablePageNum, watermark: enableWatermark });
      const outBytes = await doc.save({ useObjectStreams: true });
      const base = stampFile.file.name.replace(/\.pdf$/i, '');
      const fileName = `${base}-已编页加水印.pdf`;
      setLastOutputBytes(outBytes);
      triggerDownload(outBytes, fileName);
      setLastOutputInfo({ name: fileName, size: outBytes.byteLength, pages: doc.getPageCount() });
      setStatusMsg('处理完成，已自动下载！');
      trackEvent('tool_result');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '处理失败');
    } finally {
      setBusy(false);
    }
  };

  const handleRunSplitPdf = async () => {
    if (!splitFile) {
      setErrorMsg('请先选择一个 PDF 文件。');
      return;
    }
    const indices = parsePageRanges(splitRange, splitFile.pages);
    if (indices.length === 0) {
      setErrorMsg(`页码范围无效，请填写 1 至 ${splitFile.pages} 之间的页码（如 1-3, 5）。`);
      return;
    }
    setBusy(true);
    setErrorMsg('');
    setLastSplitResult(null);
    setStatusMsg(`正在本地提取 ${indices.length} 页证据...`);
    try {
      const buf = await splitFile.file.arrayBuffer();
      const PdfDoc = await loadPdfDocumentCtor();
      const src = await PdfDoc.load(buf, { ignoreEncryption: true });
      const outDoc = await PdfDoc.create();
      const copied = await outDoc.copyPages(src, indices);
      copied.forEach((p) => outDoc.addPage(p));
      const outBytes = await outDoc.save({ useObjectStreams: true });
      const base = splitFile.file.name.replace(/\.pdf$/i, '');
      const fileName = `${base}-提取${indices.length}页.pdf`;
      setLastOutputBytes(outBytes);
      triggerDownload(outBytes, fileName);
      setLastOutputInfo({ name: fileName, size: outBytes.byteLength, pages: outDoc.getPageCount() });
      setStatusMsg('拆分提取完成，已自动下载！');
      trackEvent('tool_result');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '拆分失败');
    } finally {
      setBusy(false);
    }
  };

  const handleAutoVolumeSplitFile = async (capMb: 10 | 50) => {
    if (!splitFile) {
      setErrorMsg('请先选择一个 PDF 文件。');
      return;
    }
    setBusy(true);
    setErrorMsg('');
    setLastSplitResult(null);
    try {
      const buf = await splitFile.file.arrayBuffer();
      const base = splitFile.file.name.replace(/\.pdf$/i, '');
      const res = await runVerifiedVolumeSplit(new Uint8Array(buf), base, capMb, byteLimitUnit);
      setLastOutputInfo({
        name: `${base}-第1至${res.volumes.length}卷.pdf`,
        size: splitFile.file.size,
        pages: res.totalPages,
        volumes: res.volumes.length,
      });
      setStatusMsg(
        res.allWithinLimit
          ? `已按 ${capMb}MB/卷 切分核验为 ${res.volumes.length} 个 PDF！`
          : `已切分为 ${res.volumes.length} 卷，但其中 ${res.oversizeVolumes.length} 卷单页本身超出 ${capMb}MB 上限！`
      );
      trackEvent('tool_result');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '自动分卷失败');
    } finally {
      setBusy(false);
    }
  };

  const totalQueuePages = queue.reduce((s, q) => s + q.pages, 0);
  const totalQueueSize = queue.reduce((s, q) => s + q.size, 0);

  return (
    <div className="bg-[#F6F4EF] py-5 sm:py-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Top Bar */}
        <div className="hidden">
          <Link to="/tools" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#11151C]">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回实用法律工具
          </Link>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
            <Lock className="h-3.5 w-3.5" />
            <span>100% 本地浏览器离线处理 · 零文件上传服务器</span>
          </span>
        </div>

        {/* Header */}
        <div className="mt-2">
          <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9A773E]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#B89254]" />
            <span>PRIVACY-FIRST LEGAL PDF TOOLKIT · 律师与当事人保密工具</span>
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold text-[#11151C] sm:text-4xl">
            律所保密证据 PDF 工具箱
          </h1>
          <p className="mt-2.5 max-w-3xl text-sm leading-7 text-slate-600">
            专为中国诉讼举证与人民法院在线服务设计：微信截图/拍照一键压缩合并为 A4 立案 PDF、自动编连续证据页码、加“仅限诉讼举证使用”斜向水印与卷宗按页拆分。全程在您自己的电脑/手机浏览器本地运算，<strong className="font-semibold text-[#11151C]">绝不上传任何案卷文件</strong>。
          </p>
        </div>

        {/* Obsidian Zero-Upload Guarantee Strip */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-[#B89254] bg-[#11151C] px-5 py-3.5 text-xs text-slate-200">
          <div className="flex items-center gap-2.5">
            <Lock className="h-4 w-4 flex-none text-[#D1B27A]" />
            <span>
              <strong className="text-white">绝对保密架构：</strong>
              告别把合同和证据上传给陌生在线 PDF 网站——您可以直接断开网络测试，本工具依然正常运行；关闭页面后内存立即清空。
            </span>
          </div>
          <span className="font-mono text-[11px] text-[#D1B27A]">SIL OFL 1.1 免费商用开源字库</span>
        </div>

        {/* Mode Tabs */}
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ['merge_build', '证据合并 & 截图压图转 PDF', '支持 50MB+ 大卷宗合并，超限可按 10MB / 50MB 自动分卷', Layers],
              ['stamp_number', '一键加连续证据页码 & 水印', '自动编“第 X 页 / 共 Y 页”与斜向举证防滥用水印', Stamp],
              ['split_extract', '大卷宗按页提取 / 按 10MB·50MB 自动分卷', '既支持按页码精准提取，也支持超大卷宗一键按体积分卷', Scissors],
            ] as const
          ).map(([id, title, desc, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                setErrorMsg('');
                setStatusMsg('');
              }}
              className={`rounded-[2px] border p-4 text-left transition-colors ${
                tab === id
                  ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]'
                  : 'border-[#DED8CC] bg-white text-[#11151C] hover:border-[#11151C]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${tab === id ? 'text-[#D1B27A]' : 'text-[#9A773E]'}`} />
                <span className="text-xs font-bold">{title}</span>
              </div>
              <p className={`mt-1.5 text-[11px] leading-4 ${tab === id ? 'text-slate-300' : 'text-slate-500'}`}>{desc}</p>
            </button>
          ))}
        </div>

        {/* TAB 1: MERGE PDF & IMAGES */}
        {tab === 'merge_build' && (
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7 space-y-5 border border-[#DED8CC] bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE5] pb-4">
                <div>
                  <h2 className="font-display text-base font-bold text-[#11151C]">步骤 1：添加 PDF 与图片证据并排序</h2>
                  <p className="mt-0.5 text-[11px] text-slate-500">支持同时多选 PDF、JPG、PNG、WebP 截图，按上下箭头调整最终页序</p>
                </div>
                {queue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQueue([])}
                    className="text-xs text-rose-600 underline hover:text-rose-700"
                  >
                    清空列表
                  </button>
                )}
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center border border-dashed border-[#B89254] bg-[#FAF9F6] px-6 py-8 text-center transition hover:bg-[#F3ECE0]/40">
                <FilePlus2 className="h-8 w-8 text-[#9A773E]" />
                <p className="mt-2.5 text-sm font-bold text-[#11151C]">点击选择 PDF 或批量微信截图 / 拍照图片</p>
                <p className="mt-1 text-xs text-slate-500">支持一次多选几十张图片与多份 PDF，全部仅在本机内存中处理</p>
                <input
                  ref={mergeInputRef}
                  type="file"
                  multiple
                  accept=".pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => handleAddMergeFiles(e.target.files)}
                  className="hidden"
                />
              </label>

              {queue.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      已添加 <strong className="text-[#11151C]">{queue.length}</strong> 个文件 · 预计合并{' '}
                      <strong className="font-num text-[#11151C]">{totalQueuePages}</strong> 页
                    </span>
                    <span className="font-num">原始合计：{fmtBytes(totalQueueSize)}</span>
                  </div>

                  <div className="max-h-72 divide-y divide-[#EFECE5] overflow-y-auto border border-[#E4DFD4]">
                    {queue.map((item, idx) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 bg-white px-3.5 py-2.5 text-xs">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="font-num text-[11px] font-bold text-[#9A773E]">{String(idx + 1).padStart(2, '0')}</span>
                          {item.kind === 'pdf' ? (
                            <FileText className="h-4 w-4 flex-none text-[#0E223D]" />
                          ) : (
                            <ImageIcon className="h-4 w-4 flex-none text-[#B89254]" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-[#11151C]">{item.file.name}</p>
                            <p className="font-num text-[10.5px] text-slate-400">
                              {item.kind === 'pdf' ? `PDF · ${item.pages} 页` : '图片 · 自动排入 A4'} · {fmtBytes(item.size)}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-none items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveItem(idx, -1)}
                            className="rounded-[2px] border border-[#E4DFD4] p-1 text-slate-500 hover:border-[#11151C] disabled:opacity-30"
                            aria-label="上移"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === queue.length - 1}
                            onClick={() => moveItem(idx, 1)}
                            className="rounded-[2px] border border-[#E4DFD4] p-1 text-slate-500 hover:border-[#11151C] disabled:opacity-30"
                            aria-label="下移"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                            className="rounded-[2px] border border-[#E4DFD4] p-1 text-rose-500 hover:border-rose-400"
                            aria-label="移除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Compression & Optional Stamp Config */}
            <div className="min-w-0 lg:col-span-5 space-y-5 border border-[#DED8CC] bg-white p-5 sm:p-6">
              <h2 className="font-display text-base font-bold text-[#11151C] border-b border-[#EFECE5] pb-3.5">
                步骤 2：画质瘦身与顺手加页码/水印
              </h2>

              <div>
                <p className="text-xs font-semibold text-slate-700">目标体积上限（本地处理，支持 50MB+ 大卷宗）</p>
                <div className="mt-2 grid grid-cols-1 gap-1.5">
                  {VOLUME_CAP_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTargetLimitMb(opt.value)}
                      className={`w-full rounded-[2px] border px-3 py-2 text-left text-xs transition-colors ${
                        targetLimitMb === opt.value
                          ? 'border-[#0E223D] bg-[#0E223D] text-[#F6F4EF]'
                          : 'border-[#E4DFD4] bg-[#FAF9F6] text-slate-700 hover:border-[#0E223D]'
                      }`}
                    >
                      <span className="font-bold">{opt.label}</span>
                      <span className={`ml-2 text-[11px] ${targetLimitMb === opt.value ? 'text-[#D1B27A]' : 'text-slate-400'}`}>
                        {opt.desc}
                      </span>
                    </button>
                  ))}
                </div>
                {targetLimitMb > 0 && (
                  <div className="mt-2.5 space-y-2">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#0E223D]">
                      <input
                        type="checkbox"
                        checked={autoSplitOnLimit}
                        onChange={(e) => setAutoSplitOnLimit(e.target.checked)}
                        className="h-3.5 w-3.5 accent-[#0E223D]"
                      />
                      <span>合并后若超过 {targetLimitMb}MB，自动切分为「第 1 卷、第 2 卷…」并逐卷校验实测字节</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                      <span className="font-semibold text-slate-700">体积换算口径：</span>
                      <button
                        type="button"
                        onClick={() => setByteLimitUnit('decimal_mb')}
                        className={`rounded border px-2 py-0.5 ${
                          byteLimitUnit === 'decimal_mb'
                            ? 'border-[#0E223D] bg-[#0E223D] text-white font-semibold'
                            : 'border-[#D8D2C6] bg-white text-slate-600'
                        }`}
                      >
                        严格十进制 MB（1MB=1,000,000字节 · 推荐）
                      </button>
                      <button
                        type="button"
                        onClick={() => setByteLimitUnit('binary_mib')}
                        className={`rounded border px-2 py-0.5 ${
                          byteLimitUnit === 'binary_mib'
                            ? 'border-[#0E223D] bg-[#0E223D] text-white font-semibold'
                            : 'border-[#D8D2C6] bg-white text-slate-600'
                        }`}
                      >
                        二进制 MiB（1MiB=1,048,576字节）
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {totalQueueSize > 60 * 1024 * 1024 && (
                <div className="rounded-[2px] border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-950">
                  提示：当前待合并卷宗合计 {fmtBytes(totalQueueSize)}（超过 60MB）。电脑端浏览器处理更稳更快；如在手机端卡顿建议分批处理。
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-slate-700">图片证据压缩画质档位</p>
                <div className="mt-2 space-y-1.5">
                  {(Object.keys(QUALITY_MAP) as QualityPreset[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setQuality(k)}
                      className={`w-full rounded-[2px] border px-3.5 py-2.5 text-left text-xs transition-colors ${
                        quality === k
                          ? 'border-[#11151C] bg-[#11151C] text-[#F6F4EF]'
                          : 'border-[#E4DFD4] bg-[#FAF9F6] text-slate-700 hover:border-[#11151C]'
                      }`}
                    >
                      <span className="font-bold">{QUALITY_MAP[k].label}</span>
                      <span className={`ml-2 text-[11px] ${quality === k ? 'text-[#D1B27A]' : 'text-slate-400'}`}>
                        {QUALITY_MAP[k].desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 border-t border-[#EFECE5] pt-4 text-xs">
                <label className="flex cursor-pointer items-center gap-2 font-semibold text-[#11151C]">
                  <input
                    type="checkbox"
                    checked={enablePageNum}
                    onChange={(e) => setEnablePageNum(e.target.checked)}
                    className="h-4 w-4 accent-[#11151C]"
                  />
                  <span>合并时自动加连续证据页码（如 第 1 页 / 共 N 页）</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 font-semibold text-[#11151C]">
                  <input
                    type="checkbox"
                    checked={enableWatermark}
                    onChange={(e) => setEnableWatermark(e.target.checked)}
                    className="h-4 w-4 accent-[#11151C]"
                  />
                  <span>合并时顺手加斜向“仅限诉讼举证使用”防滥用水印</span>
                </label>
                {enableWatermark && (
                  <input
                    type="text"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                    placeholder="输入自定义水印文字"
                    className="w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3 py-2 text-xs"
                  />
                )}
              </div>

              <button
                type="button"
                disabled={busy || queue.length === 0}
                onClick={() => handleBuildMergedPdf()}
                className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-3 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D] disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin text-[#D1B27A]" /> : <Download className="h-4 w-4 text-[#D1B27A]" />}
                <span>{busy ? statusMsg || '本地生成中...' : '一键在本地生成并下载规范证据 PDF'}</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: STAMP & NUMBER EXISTING PDF */}
        {tab === 'stamp_number' && (
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-6 space-y-4 border border-[#DED8CC] bg-white p-5 sm:p-6">
              <h2 className="font-display text-base font-bold text-[#11151C] border-b border-[#EFECE5] pb-3.5">
                上传需要编页码或加水印的 PDF（仅本地读取）
              </h2>
              <label className="flex cursor-pointer flex-col items-center justify-center border border-dashed border-[#B89254] bg-[#FAF9F6] px-6 py-8 text-center">
                <Stamp className="h-8 w-8 text-[#9A773E]" />
                <p className="mt-2.5 text-sm font-bold text-[#11151C]">
                  {stampFile ? `已载入：${stampFile.file.name}（共 ${stampFile.pages} 页）` : '点击选择本地 PDF 证据文件'}
                </p>
                <p className="mt-1 text-xs text-slate-500">支持重新选择替换 · 绝不上传网络</p>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => handleLoadSinglePdf(e.target.files?.[0] || null, 'stamp')}
                  className="hidden"
                />
              </label>

              {/* Page number details */}
              <div className="space-y-3 border border-[#E4DFD4] bg-[#FAF9F6] p-4 text-xs">
                <label className="flex cursor-pointer items-center gap-2 font-bold text-[#11151C]">
                  <input
                    type="checkbox"
                    checked={enablePageNum}
                    onChange={(e) => setEnablePageNum(e.target.checked)}
                    className="h-4 w-4 accent-[#11151C]"
                  />
                  <span>开启连续证据页码</span>
                </label>
                {enablePageNum && (
                  <div className="grid gap-3 pt-1 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-[11px] text-slate-500">页码格式</span>
                      <select
                        value={pageNumFmt}
                        onChange={(e) => setPageNumFmt(e.target.value as PageNumFmt)}
                        className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="cn_full">第 1 页 / 共 12 页</option>
                        <option value="cn_evidence">证据第 1 页</option>
                        <option value="slash">1 / 12</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-500">摆放位置</span>
                      <select
                        value={pageNumPos}
                        onChange={(e) => setPageNumPos(e.target.value as PageNumPos)}
                        className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="bottom-center">页面底部居中</option>
                        <option value="bottom-right">页面右下角</option>
                        <option value="top-right">页面右上角</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-500">起始页码（续编卷宗可用）</span>
                      <input
                        type="number"
                        min={1}
                        value={startNum}
                        onChange={(e) => setStartNum(Math.max(1, Number(e.target.value) || 1))}
                        className="mt-1 w-full rounded-[2px] border border-[#D8D2C6] bg-white px-2.5 py-1.5 font-num text-xs font-bold"
                      />
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 self-end pb-1.5 text-[11px] text-slate-700">
                      <input
                        type="checkbox"
                        checked={skipFirstPage}
                        onChange={(e) => setSkipFirstPage(e.target.checked)}
                        className="h-3.5 w-3.5 accent-[#11151C]"
                      />
                      <span>跳过第 1 页（如封面/目录）</span>
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0 lg:col-span-6 space-y-4 border border-[#DED8CC] bg-white p-5 sm:p-6">
              <div className="space-y-3 border border-[#E4DFD4] bg-[#FAF9F6] p-4 text-xs">
                <label className="flex cursor-pointer items-center gap-2 font-bold text-[#11151C]">
                  <input
                    type="checkbox"
                    checked={enableWatermark}
                    onChange={(e) => setEnableWatermark(e.target.checked)}
                    className="h-4 w-4 accent-[#11151C]"
                  />
                  <span>开启斜向举证防滥用中文水印</span>
                </label>
                {enableWatermark && (
                  <div className="space-y-3 pt-1">
                    <input
                      type="text"
                      value={watermarkText}
                      onChange={(e) => setWatermarkText(e.target.value)}
                      placeholder="输入水印内容"
                      className="w-full rounded-[2px] border border-[#D8D2C6] bg-white px-3 py-2 text-xs"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {WATERMARK_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setWatermarkText(p)}
                          className="rounded-[2px] border border-[#DED8CC] bg-white px-2 py-1 text-[10.5px] text-slate-600 hover:border-[#11151C]"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[11px] text-slate-500">透明度：{watermarkOpacity}%</span>
                        <input
                          type="range"
                          min={10}
                          max={50}
                          value={watermarkOpacity}
                          onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                          className="mt-1.5 w-full accent-[#11151C]"
                        />
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 self-end pb-1 text-[11px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={watermarkTiled}
                          onChange={(e) => setWatermarkTiled(e.target.checked)}
                          className="h-3.5 w-3.5 accent-[#11151C]"
                        />
                        <span>全页平铺（不勾选则居中大图章）</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={busy || !stampFile}
                onClick={handleRunStampPdf}
                className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[2px] bg-[#11151C] px-5 py-3 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D] disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin text-[#D1B27A]" /> : <Download className="h-4 w-4 text-[#D1B27A]" />}
                <span>{busy ? statusMsg : '立即在本地加页码/水印并下载'}</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: SPLIT / EXTRACT PAGES */}
        {tab === 'split_extract' && (
          <div className="mt-6 border border-[#DED8CC] bg-white p-6 sm:p-8 space-y-5">
            <h2 className="font-display text-base font-bold text-[#11151C] border-b border-[#EFECE5] pb-3.5">
              大卷宗 PDF 按页码拆分提取（本地瞬时完成）
            </h2>
            <label className="flex cursor-pointer flex-col items-center justify-center border border-dashed border-[#B89254] bg-[#FAF9F6] px-6 py-8 text-center">
              <Scissors className="h-8 w-8 text-[#9A773E]" />
              <p className="mt-2.5 text-sm font-bold text-[#11151C]">
                {splitFile ? `已载入：${splitFile.file.name}（共 ${splitFile.pages} 页 · ${fmtBytes(splitFile.file.size)}）` : '点击选择需要拆分的本地 PDF 卷宗'}
              </p>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => handleLoadSinglePdf(e.target.files?.[0] || null, 'split')}
                className="hidden"
              />
            </label>

            {splitFile && (
              <div className="space-y-4">
                <div className="rounded-[2px] border border-[#E5DFD3] bg-[#FAF9F6] p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold text-[#0E223D]">
                      方式一：按目标体积一键自动分卷并逐卷实测字节校验
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setByteLimitUnit('decimal_mb')}
                        className={`rounded border px-2 py-0.5 ${
                          byteLimitUnit === 'decimal_mb'
                            ? 'border-[#0E223D] bg-[#0E223D] text-white font-semibold'
                            : 'border-[#D8D2C6] bg-white text-slate-600'
                        }`}
                      >
                        严格十进制 MB（10⁶ 字节）
                      </button>
                      <button
                        type="button"
                        onClick={() => setByteLimitUnit('binary_mib')}
                        className={`rounded border px-2 py-0.5 ${
                          byteLimitUnit === 'binary_mib'
                            ? 'border-[#0E223D] bg-[#0E223D] text-white font-semibold'
                            : 'border-[#D8D2C6] bg-white text-slate-600'
                        }`}
                      >
                        二进制 MiB（2²⁰ 字节）
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAutoVolumeSplitFile(50)}
                      className="inline-flex items-center gap-1.5 rounded-[2px] bg-[#0E223D] px-4 py-2 text-xs font-semibold text-[#F6F4EF] hover:bg-[#17345C] disabled:opacity-50"
                    >
                      <Scissors className="h-3.5 w-3.5 text-[#D1B27A]" /> 按 50MB/卷 自动切分下载
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAutoVolumeSplitFile(10)}
                      className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#0E223D] bg-white px-4 py-2 text-xs font-semibold text-[#0E223D] hover:bg-[#F3EFE6] disabled:opacity-50"
                    >
                      <Scissors className="h-3.5 w-3.5 text-[#9A773E]" /> 按 10MB/卷 自动切分（法院立案）
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1 block">
                    <span className="text-xs font-semibold text-[#11151C]">
                      方式二：按指定页码提取（共 {splitFile.pages} 页，逗号分隔，如：1-3, 5, 8-12）
                    </span>
                    <input
                      type="text"
                      value={splitRange}
                      onChange={(e) => setSplitRange(e.target.value)}
                      placeholder="例如：1-3, 5"
                      className="mt-1.5 w-full rounded-[2px] border border-[#D8D2C6] bg-[#FAF9F6] px-3.5 py-2.5 font-mono text-sm font-bold text-[#11151C]"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRunSplitPdf}
                    className="inline-flex min-h-[44px] flex-none items-center justify-center gap-2 rounded-[2px] bg-[#11151C] px-6 py-2.5 text-xs font-semibold text-[#F6F4EF] hover:bg-[#0E223D] disabled:opacity-50"
                  >
                    <Scissors className="h-4 w-4 text-[#D1B27A]" />
                    <span>提取选中页面并下载（{parsePageRanges(splitRange, splitFile.pages).length} 页）</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error & Success Feedback */}
        {errorMsg && (
          <div className="mt-5 border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {errorMsg}
          </div>
        )}
        {lastOutputInfo && (
          <div
            className={`mt-5 space-y-3 border px-5 py-4 text-xs ${
              lastSplitResult && !lastSplitResult.result.allWithinLimit
                ? 'border-amber-300 bg-amber-50 text-amber-950'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong>
                  {lastSplitResult && !lastSplitResult.result.allWithinLimit
                    ? `⚠ 已生成分卷（含单页超限提醒）：${lastOutputInfo.name}`
                    : `✅ 已生成并下载：${lastOutputInfo.name}`}
                </strong>
                <span className="ml-3 font-num">
                  共 {lastOutputInfo.pages} 页 · 原始总体积 {formatPdfBytes(lastOutputInfo.size, byteLimitUnit)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {lastSplitResult
                    ? lastSplitResult.result.allWithinLimit
                      ? `✓ 全部 ${lastSplitResult.result.volumes.length} 卷实测均在 ${lastSplitResult.maxMb}${lastSplitResult.result.limitUnit === 'decimal_mb' ? 'MB（10⁶字节）' : 'MiB'} 以内`
                      : `⚠ 共 ${lastSplitResult.result.volumes.length} 卷，其中 ${lastSplitResult.result.oversizeVolumes.length} 卷单页本身超出 ${lastSplitResult.maxMb}MB 上限`
                    : targetLimitMb === 0
                    ? '✓ 高清完整单文件已导出（不限体积）'
                    : lastOutputInfo.size <= resolveLimitBytes(targetLimitMb, byteLimitUnit)
                    ? `✓ 实测体积在 ${targetLimitMb}${byteLimitUnit === 'decimal_mb' ? 'MB（10⁶字节）' : 'MiB'} 以内，可直接提交`
                    : `提示：体积超过 ${targetLimitMb}MB`}
                </span>
                {!lastOutputInfo.volumes &&
                  lastOutputBytes &&
                  targetLimitMb > 0 &&
                  lastOutputInfo.size > resolveLimitBytes(targetLimitMb, byteLimitUnit) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const base = lastOutputInfo.name.replace(/\.pdf$/i, '');
                          const res = await runVerifiedVolumeSplit(
                            lastOutputBytes,
                            base,
                            targetLimitMb,
                            byteLimitUnit
                          );
                          setLastOutputInfo({
                            ...lastOutputInfo,
                            name: `${base}-第1至${res.volumes.length}卷.pdf`,
                            volumes: res.volumes.length,
                          });
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="rounded bg-[#0E223D] px-2.5 py-1 text-[11px] font-bold text-[#F6F4EF]"
                    >
                      立即按 {targetLimitMb}MB 分卷下载
                    </button>
                  )}
              </div>
            </div>

            {lastSplitResult && !lastSplitResult.result.allWithinLimit && (
              <div className="rounded border border-amber-400 bg-white/90 p-3 text-[11px] leading-5 text-amber-950 space-y-2">
                <div className="flex items-start gap-2 font-bold text-rose-800">
                  <AlertTriangle className="h-4 w-4 flex-none mt-0.5" />
                  <span>
                    以下分卷已退化为「单页独立成卷」，但因该页原图/扫描流本身超过 {lastSplitResult.maxMb}
                    {lastSplitResult.result.limitUnit === 'decimal_mb' ? 'MB' : 'MiB'}，直接上传网上立案平台仍可能被拒：
                  </span>
                </div>
                <ul className="list-disc pl-5 space-y-0.5 font-mono text-[11px]">
                  {lastSplitResult.result.oversizeVolumes.map((v) => (
                    <li key={v.volIndex}>
                      第 {v.volIndex} 卷（原卷第 {v.pageStart} 页）· 实测{' '}
                      {formatPdfBytes(v.byteLength, lastSplitResult.result.limitUnit)}（{v.byteLength.toLocaleString()} 字节）
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-slate-700">
                    建议：将该超限页导出为图片后重新放入「证据合并 & 截图压图转 PDF」压缩，或使用打印为低分辨率 PDF。
                  </span>
                  {tab === 'merge_build' && quality !== 'compact' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleBuildMergedPdf('compact')}
                      className="rounded bg-[#0E223D] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#17345C]"
                    >
                      切换「极限瘦身」档重新压缩生成
                    </button>
                  )}
                </div>
              </div>
            )}

            {lastSplitResult && lastSplitResult.result.volumes.length > 0 && (
              <div className="border-t border-black/10 pt-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold">
                    分卷核验清单（共 {lastSplitResult.result.volumes.length} 卷，超 3 卷时已自动打包为单个 .zip 防止浏览器拦截多文件下载）：
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      downloadZipBundle(
                        lastSplitResult.result.volumes.map((v) => ({ name: v.fileName, data: v.bytes })),
                        `${lastSplitResult.baseName}-共${lastSplitResult.result.volumes.length}卷.zip`
                      )
                    }
                    className="inline-flex items-center gap-1 rounded border border-[#0E223D] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0E223D] hover:bg-[#FAF9F6]"
                  >
                    <Archive className="h-3.5 w-3.5" /> 一键打包全部切分卷 (.zip)
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {lastSplitResult.result.volumes.map((vol) => (
                    <button
                      key={vol.volIndex}
                      type="button"
                      onClick={() => triggerDownload(vol.bytes, vol.fileName)}
                      className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-mono ${
                        vol.exceedsLimit
                          ? 'border-rose-400 bg-rose-50 text-rose-900 font-bold'
                          : 'border-emerald-300 bg-white text-emerald-950 hover:bg-emerald-100/50'
                      }`}
                    >
                      <Download className="h-3 w-3" />
                      <span>
                        第{vol.volIndex}卷(P{vol.pageStart}-{vol.pageEnd}) ·{' '}
                        {formatPdfBytes(vol.byteLength, lastSplitResult.result.limitUnit)}
                        {vol.exceedsLimit ? ' ⚠超限' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
