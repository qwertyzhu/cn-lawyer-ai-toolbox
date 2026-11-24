import type { AiImageAttachment } from '../types/toolbox';

const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.84;

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('无法读取本地图片文件'));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('浏览器无法解码该图片格式（请尝试 JPG / PNG / WebP 截图）'));
    img.src = src;
  });
}

/**
 * Compresses a screenshot/photo purely inside local browser memory via <canvas>
 * so legal text stays crisp (max 1600px edge) while keeping API payload lightweight.
 */
export async function compressImageFileToAttachment(file: File): Promise<AiImageAttachment> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`「${file.name}」不是受支持的图片格式`);
  }
  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadHtmlImage(rawDataUrl);

  let targetW = img.naturalWidth || img.width || 1200;
  let targetH = img.naturalHeight || img.height || 1200;

  if (targetW > MAX_EDGE_PX || targetH > MAX_EDGE_PX) {
    const scale = Math.min(MAX_EDGE_PX / targetW, MAX_EDGE_PX / targetH);
    targetW = Math.max(1, Math.round(targetW * scale));
    targetH = Math.max(1, Math.round(targetH * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('当前浏览器不支持本地画布压缩');
  }
  // Paint white background first so transparent PNG screenshots stay crisp on JPEG conversion
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const compressedUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const b64Part = compressedUrl.split(',')[1] || '';
  const byteSize = Math.ceil((b64Part.length * 3) / 4);

  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: file.name || '现场截图.jpg',
    dataUrl: compressedUrl,
    mimeType: 'image/jpeg',
    width: targetW,
    height: targetH,
    sizeKb: Math.max(1, Math.round(byteSize / 1024)),
  };
}
