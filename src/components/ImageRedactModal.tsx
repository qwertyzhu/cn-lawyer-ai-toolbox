import React, { useEffect, useRef, useState } from 'react';
import { Check, Eraser, Paintbrush, RotateCcw, ShieldCheck, Undo2, X } from 'lucide-react';
import type { AiImageAttachment } from '../types/toolbox';

interface ImageRedactModalProps {
  image: AiImageAttachment | null;
  onClose: () => void;
  onSave: (updated: AiImageAttachment) => void;
}

interface Stroke {
  points: { x: number; y: number }[];
  size: number;
  mode: 'black' | 'mosaic';
}

export const ImageRedactModal: React.FC<ImageRedactModalProps> = ({ image, onClose, onSave }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgObjRef = useRef<HTMLImageElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brushSize, setBrushSize] = useState<number>(28);
  const [brushMode, setBrushMode] = useState<'black' | 'mosaic'>('black');
  const [drawing, setDrawing] = useState(false);
  const currentStrokeRef = useRef<Stroke | null>(null);

  useEffect(() => {
    if (!image) return;
    setStrokes([]);
    const img = new Image();
    img.onload = () => {
      imgObjRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth || image.width || 800;
      canvas.height = img.naturalHeight || image.height || 800;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
    };
    img.src = image.dataUrl;
  }, [image]);

  const redrawAll = (list: Stroke[]) => {
    const canvas = canvasRef.current;
    const img = imgObjRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const s of list) {
      if (s.points.length === 0) continue;
      if (s.mode === 'black') {
        ctx.save();
        ctx.strokeStyle = '#11151C';
        ctx.fillStyle = '#11151C';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = s.size;
        if (s.points.length === 1) {
          ctx.beginPath();
          ctx.arc(s.points[0].x, s.points[0].y, s.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(s.points[0].x, s.points[0].y);
          for (let i = 1; i < s.points.length; i++) {
            ctx.lineTo(s.points[i].x, s.points[i].y);
          }
          ctx.stroke();
        }
        ctx.restore();
      } else {
        // Mosaic blocks along stroke
        const block = Math.max(10, Math.round(s.size * 0.45));
        for (const pt of s.points) {
          const half = Math.round(s.size / 2);
          const x0 = Math.max(0, Math.floor((pt.x - half) / block) * block);
          const y0 = Math.max(0, Math.floor((pt.y - half) / block) * block);
          const x1 = Math.min(canvas.width, pt.x + half);
          const y1 = Math.min(canvas.height, pt.y + half);
          for (let yy = y0; yy < y1; yy += block) {
            for (let xx = x0; xx < x1; xx += block) {
              const bw = Math.min(block, canvas.width - xx);
              const bh = Math.min(block, canvas.height - yy);
              if (bw <= 0 || bh <= 0) continue;
              const pixel = ctx.getImageData(
                Math.min(canvas.width - 1, xx + Math.floor(bw / 2)),
                Math.min(canvas.height - 1, yy + Math.floor(bh / 2)),
                1,
                1
              ).data;
              ctx.fillStyle = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;
              ctx.fillRect(xx, yy, bw, bh);
            }
          }
        }
      }
    }
  };

  useEffect(() => {
    redrawAll(strokes);
  }, [strokes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!image) return null;

  const toCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const scaleRatio = Math.max(1, canvas.width / Math.max(300, canvas.getBoundingClientRect().width));
    const pt = toCanvasPoint(e);
    const stroke: Stroke = {
      points: [pt],
      size: Math.round(brushSize * scaleRatio),
      mode: brushMode,
    };
    currentStrokeRef.current = stroke;
    setDrawing(true);
    redrawAll([...strokes, stroke]);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || !currentStrokeRef.current) return;
    const pt = toCanvasPoint(e);
    const pts = currentStrokeRef.current.points;
    const last = pts[pts.length - 1];
    if (Math.hypot(pt.x - last.x, pt.y - last.y) < 3) return;
    pts.push(pt);
    redrawAll([...strokes, currentStrokeRef.current]);
  };

  const finishStroke = () => {
    if (!drawing || !currentStrokeRef.current) return;
    const finished = currentStrokeRef.current;
    currentStrokeRef.current = null;
    setDrawing(false);
    setStrokes((prev) => [...prev, finished]);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    const b64Part = dataUrl.split(',')[1] || '';
    const sizeKb = Math.max(1, Math.round(((b64Part.length * 3) / 4) / 1024));
    onSave({
      ...image,
      dataUrl,
      mimeType: 'image/jpeg',
      width: canvas.width,
      height: canvas.height,
      sizeKb,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-xl border border-[#D1B27A]/40 bg-[#0E223D] text-[#F6F4EF] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/15">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="h-4 w-4 text-[#D1B27A] flex-none" />
            <div className="min-w-0">
              <div className="font-display text-sm font-bold text-white truncate">
                本地截图涂抹打码（100% 浏览器内存处理）
              </div>
              <div className="text-[11px] text-slate-300">
                用手指或鼠标在姓名、身份证号、银行卡或金额上划过即可永久遮盖
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#091628] border-b border-white/10 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setBrushMode('black')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-semibold ${
                brushMode === 'black' ? 'bg-[#B89254] text-[#11151C]' : 'bg-white/10 text-slate-200'
              }`}
            >
              <Paintbrush className="h-3 w-3" /> 纯黑涂抹
            </button>
            <button
              type="button"
              onClick={() => setBrushMode('mosaic')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-semibold ${
                brushMode === 'mosaic' ? 'bg-[#B89254] text-[#11151C]' : 'bg-white/10 text-slate-200'
              }`}
            >
              <Eraser className="h-3 w-3" /> 马赛克
            </button>
            <div className="flex items-center gap-1 ml-1 border-l border-white/15 pl-2">
              {[
                { label: '细', val: 16 },
                { label: '中', val: 28 },
                { label: '粗', val: 46 },
              ].map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => setBrushSize(b.val)}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    brushSize === b.val ? 'bg-white text-[#0E223D]' : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={strokes.length === 0}
              onClick={() => setStrokes((prev) => prev.slice(0, -1))}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px] text-slate-200 disabled:opacity-35"
            >
              <Undo2 className="h-3 w-3" /> 撤销
            </button>
            <button
              type="button"
              disabled={strokes.length === 0}
              onClick={() => setStrokes([])}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px] text-slate-200 disabled:opacity-35"
            >
              <RotateCcw className="h-3 w-3" /> 还原
            </button>
          </div>
        </div>

        {/* Interactive Canvas Area */}
        <div className="flex-1 overflow-auto bg-[#060D18] p-3 flex items-center justify-center">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            style={{ touchAction: 'none' }}
            className="max-w-full max-h-[56vh] rounded border border-white/20 cursor-crosshair bg-white shadow-lg"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[#091628] border-t border-white/15">
          <span className="text-[11px] text-slate-400">
            已涂抹 {strokes.length} 笔（保存后直接覆盖待发图片像素）
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-white/20 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded bg-[#B89254] hover:bg-[#C8A364] px-4 py-1.5 text-xs font-bold text-[#11151C]"
            >
              <Check className="h-3.5 w-3.5" /> 完成打码并保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
