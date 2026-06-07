// components/PhotoEditor.jsx
import { useState, useRef, useEffect, useCallback } from 'react';

const MAX_CANVAS_WIDTH = 1920;
const MAX_CANVAS_HEIGHT = 1080;

export default function PhotoEditor() {
  const [image, setImage] = useState(null);
  const [filterValues, setFilterValues] = useState({
    brightness: 100, contrast: 100, saturation: 100, blur: 0,
  });
  const [history, setHistory] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Crop state
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState(null);      // {x,y,w,h} in original image pixels
  const [appliedCrop, setAppliedCrop] = useState(null); // crop used for display/export
  const cropDragInfo = useRef(null);

  // Numeric inputs (synced with cropRect)
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropW, setCropW] = useState(0);
  const [cropH, setCropH] = useState(0);

  // Drawing brush
  const [drawing, setDrawing] = useState(false);
  const [brushColor, setBrushColor] = useState('#ff0000');
  const [brushSize, setBrushSize] = useState(4);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const ctxRef = useRef(null);
  const imageRef = useRef(null); // original Image object
  const canvasScale = useRef(1); // scale from image pixels to canvas pixels

  // ─── Sync numeric inputs from cropRect ──────────────────
  useEffect(() => {
    if (cropRect) {
      setCropX(cropRect.x);
      setCropY(cropRect.y);
      setCropW(cropRect.w);
      setCropH(cropRect.h);
    }
  }, [cropRect]);

  // ─── Load image from file ───────────────────────────────
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      imageRef.current = img;
      setImage(img);
      const full = { x: 0, y: 0, w: img.width, h: img.height };
      setCropRect(full);
      setAppliedCrop(full);
      setCropMode(false);
      setHistory([]);
      setRedoStack([]);
    };
  };

  // ─── Draw image with crop overlay ───────────────────────
  const drawImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;

    const img = imageRef.current;
    if (!img) return;

    const iw = img.width;
    const ih = img.height;
    let drawWidth, drawHeight, scale;

    if (cropMode) {
      // Scale the full image to fit within max dimensions
      scale = Math.min(MAX_CANVAS_WIDTH / iw, MAX_CANVAS_HEIGHT / ih, 1);
      drawWidth = Math.round(iw * scale);
      drawHeight = Math.round(ih * scale);
      canvasScale.current = scale;
    } else {
      // Show only the cropped region at native resolution
      const crop = appliedCrop || { x: 0, y: 0, w: iw, h: ih };
      scale = 1;
      drawWidth = crop.w;
      drawHeight = crop.h;
      canvasScale.current = 1;
    }

    canvas.width = drawWidth;
    canvas.height = drawHeight;

    ctx.filter = `brightness(${filterValues.brightness}%) contrast(${filterValues.contrast}%) saturate(${filterValues.saturation}%) blur(${filterValues.blur}px)`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (cropMode) {
      // Draw full image scaled
      ctx.drawImage(img, 0, 0, drawWidth, drawHeight);
    } else {
      // Draw only the cropped portion
      const crop = appliedCrop || { x: 0, y: 0, w: iw, h: ih };
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, drawWidth, drawHeight);
    }
    ctx.filter = 'none';

    // ─── Crop overlay (scaled) ────────────────────────────
    if (cropMode && cropRect) {
      const s = canvasScale.current;
      const cr = {
        x: cropRect.x * s,
        y: cropRect.y * s,
        w: cropRect.w * s,
        h: cropRect.h * s,
      };

      // Display-scale aware handle size
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width ? canvas.width / rect.width : 1;
      const scaleY = rect.height ? canvas.height / rect.height : 1;
      const avgDisplayScale = (scaleX + scaleY) / 2;
      const handleSize = Math.max(10 * avgDisplayScale, 4);
      canvas._cropScale = { handleCanvasSize: handleSize, hitCanvasRadius: handleSize * 1.2, imageToCanvasScale: s };

      // Green border
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 3 * avgDisplayScale;
      ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);

      // Yellow handles
      const corners = [
        [cr.x, cr.y],
        [cr.x + cr.w, cr.y],
        [cr.x, cr.y + cr.h],
        [cr.x + cr.w, cr.y + cr.h],
      ];
      ctx.fillStyle = '#ff0';
      corners.forEach(([cx, cy]) => {
        ctx.fillRect(cx - handleSize/2, cy - handleSize/2, handleSize, handleSize);
      });
    } else {
      if (canvas._cropScale) delete canvas._cropScale;
    }
  }, [filterValues, cropMode, cropRect, appliedCrop]);

  useEffect(() => {
    drawImage();
  }, [drawImage]);

  // ─── History management ─────────────────────────────────
  const saveHistory = () => {
    if (!canvasRef.current) return;
    const data = canvasRef.current.toDataURL();
    setHistory((prev) => [...prev, data]);
    setRedoStack([]);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prevState = history[history.length - 1];
    setRedoStack((r) => [canvasRef.current.toDataURL(), ...r]);
    setHistory((h) => h.slice(0, -1));
    const img = new Image();
    img.src = prevState;
    img.onload = () => {
      imageRef.current = img;
      setImage(img);
    };
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const nextState = redoStack[0];
    setHistory((h) => [...h, canvasRef.current.toDataURL()]);
    setRedoStack((r) => r.slice(1));
    const img = new Image();
    img.src = nextState;
    img.onload = () => {
      imageRef.current = img;
      setImage(img);
    };
  };

  // ─── Mouse helpers for crop drag ────────────────────────
  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const toImageCoords = (cx, cy) => {
    const s = canvasScale.current || 1;
    return { x: cx / s, y: cy / s };
  };

  const handleMouseDown = (e) => {
    const { x: mx, y: my } = getCanvasCoords(e);

    if (cropMode && cropRect) {
      const { x: ix, y: iy } = toImageCoords(mx, my);

      // Hit radius in image pixels
      const hitCanvasRadius = canvasRef.current._cropScale?.hitCanvasRadius || 20;
      const s = canvasScale.current || 1;
      const hitImageRadius = hitCanvasRadius / s;

      const handles = [
        { x: cropRect.x, y: cropRect.y },
        { x: cropRect.x + cropRect.w, y: cropRect.y },
        { x: cropRect.x, y: cropRect.y + cropRect.h },
        { x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h },
      ];
      let handle = null;
      for (const h of handles) {
        if (Math.abs(ix - h.x) < hitImageRadius && Math.abs(iy - h.y) < hitImageRadius) {
          handle = h;
          break;
        }
      }
      if (handle) {
        cropDragInfo.current = { type: 'handle', handle, startX: ix, startY: iy, origRect: { ...cropRect } };
        return;
      }

      // Inside rectangle → move
      if (ix >= cropRect.x && ix <= cropRect.x + cropRect.w &&
          iy >= cropRect.y && iy <= cropRect.y + cropRect.h) {
        cropDragInfo.current = { type: 'move', startX: ix, startY: iy, origX: cropRect.x, origY: cropRect.y };
        return;
      }

      // Click outside → start drawing a new rectangle? We'll keep the current logic (no drawing).
      // Instead, we'll do nothing; the user can use numbers or presets.
      return;
    }

    // Drawing mode (only when not cropping)
    if (!cropMode && ctxRef.current) {
      setDrawing(true);
      ctxRef.current.beginPath();
      ctxRef.current.moveTo(mx, my);
      ctxRef.current.strokeStyle = brushColor;
      ctxRef.current.lineWidth = brushSize;
    }
  };

  const handleMouseMove = (e) => {
    const { x: mx, y: my } = getCanvasCoords(e);

    if (cropMode && cropDragInfo.current) {
      const { x: ix, y: iy } = toImageCoords(mx, my);
      const info = cropDragInfo.current;
      const orig = info.origRect;
      let newRect = { ...cropRect };

      if (info.type === 'move') {
        const dx = ix - info.startX;
        const dy = iy - info.startY;
        const iw = imageRef.current.width;
        const ih = imageRef.current.height;
        newRect.x = Math.max(0, Math.min(info.origX + dx, iw - newRect.w));
        newRect.y = Math.max(0, Math.min(info.origY + dy, ih - newRect.h));
      } else if (info.type === 'handle') {
        const dx = ix - info.startX;
        const dy = iy - info.startY;
        const handle = info.handle;

        if (handle.x === orig.x) { // left
          newRect.x = Math.min(orig.x + orig.w - 10, orig.x + dx);
          newRect.w = orig.w - (newRect.x - orig.x);
        } else { // right
          newRect.w = Math.max(10, orig.w + dx);
        }
        if (handle.y === orig.y) { // top
          newRect.y = Math.min(orig.y + orig.h - 10, orig.y + dy);
          newRect.h = orig.h - (newRect.y - orig.y);
        } else { // bottom
          newRect.h = Math.max(10, orig.h + dy);
        }

        // Clamp
        const iw = imageRef.current.width;
        const ih = imageRef.current.height;
        newRect.x = Math.max(0, newRect.x);
        newRect.y = Math.max(0, newRect.y);
        if (newRect.x + newRect.w > iw) newRect.w = iw - newRect.x;
        if (newRect.y + newRect.h > ih) newRect.h = ih - newRect.y;
      }
      setCropRect(newRect);
      return;
    }

    // Drawing
    if (drawing && ctxRef.current) {
      ctxRef.current.lineTo(mx, my);
      ctxRef.current.stroke();
    }
  };

  const handleMouseUp = () => {
    if (cropDragInfo.current) {
      cropDragInfo.current = null;
      return;
    }
    if (drawing) {
      ctxRef.current?.closePath();
      setDrawing(false);
      saveHistory();
    }
  };

  // ─── Numeric input handling ─────────────────────────────
  const updateCropFromInputs = () => {
    const img = imageRef.current;
    if (!img) return;
    const iw = img.width;
    const ih = img.height;
    const x = Math.max(0, Math.min(cropX, iw - 1));
    const y = Math.max(0, Math.min(cropY, ih - 1));
    const w = Math.max(10, Math.min(cropW, iw - x));
    const h = Math.max(10, Math.min(cropH, ih - y));
    setCropRect({ x, y, w, h });
  };

  const applyPreset = (ratioW, ratioH) => {
    const img = imageRef.current;
    if (!img) return;
    const iw = img.width;
    const ih = img.height;
    let newW, newH;
    if (iw / ih > ratioW / ratioH) {
      newH = ih;
      newW = Math.round(ih * (ratioW / ratioH));
    } else {
      newW = iw;
      newH = Math.round(iw / (ratioW / ratioH));
    }
    const newX = Math.round((iw - newW) / 2);
    const newY = Math.round((ih - newH) / 2);
    setCropRect({ x: newX, y: newY, w: newW, h: newH });
  };

  // ─── Crop mode toggles ──────────────────────────────────
  const enterCropMode = () => {
    const img = imageRef.current;
    if (!img) return;
    saveHistory();
    const current = appliedCrop || { x: 0, y: 0, w: img.width, h: img.height };
    setCropRect(current);
    setCropMode(true);
  };

  const applyCrop = () => {
    saveHistory();
    setAppliedCrop(cropRect);
    setCropMode(false);
  };

  const cancelCrop = () => {
    setCropRect(appliedCrop);
    setCropMode(false);
  };

  const resetCrop = () => {
    const img = imageRef.current;
    if (!img) return;
    const full = { x: 0, y: 0, w: img.width, h: img.height };
    setCropRect(full);
    setAppliedCrop(full);
    setCropMode(false);
    drawImage(); // force full display
  };

  // ─── Download ───────────────────────────────────────────
  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'edited_image.png';
    link.href = canvas.toDataURL();
    link.click();
  };

  return (
    <div className="p-6 flex flex-col items-center gap-4">
      <input type="file" accept="image/*" onChange={handleFile} ref={fileInputRef} className="hidden" />
      <button onClick={() => fileInputRef.current.click()} className="px-6 py-3 bg-primary text-white rounded-xl">
        Upload Image
      </button>

      {image && (
        <>
          {/* Filter controls */}
          <div className="flex flex-wrap gap-4 justify-center">
            <label className="flex items-center gap-2">Brightness
              <input type="range" min="0" max="200" value={filterValues.brightness}
                onChange={(e) => { setFilterValues(f => ({...f, brightness: +e.target.value})); saveHistory(); }} />
            </label>
            <label className="flex items-center gap-2">Contrast
              <input type="range" min="0" max="200" value={filterValues.contrast}
                onChange={(e) => { setFilterValues(f => ({...f, contrast: +e.target.value})); saveHistory(); }} />
            </label>
            <label className="flex items-center gap-2">Saturation
              <input type="range" min="0" max="200" value={filterValues.saturation}
                onChange={(e) => { setFilterValues(f => ({...f, saturation: +e.target.value})); saveHistory(); }} />
            </label>
            <label className="flex items-center gap-2">Blur
              <input type="range" min="0" max="10" step="0.1" value={filterValues.blur}
                onChange={(e) => { setFilterValues(f => ({...f, blur: +e.target.value})); saveHistory(); }} />
            </label>
          </div>

          {/* Undo/Redo/Brush/Crop/Download */}
          <div className="flex flex-wrap gap-4 justify-center">
            <button onClick={undo} className="px-4 py-2 bg-surface rounded-lg">↩ Undo</button>
            <button onClick={redo} className="px-4 py-2 bg-surface rounded-lg">↪ Redo</button>
            {!cropMode && <button onClick={enterCropMode} className="px-4 py-2 bg-surface rounded-lg">✂ Crop</button>}
            {cropMode && <button onClick={applyCrop} className="px-4 py-2 bg-green-600 text-white rounded-lg">✅ Apply Crop</button>}
            {cropMode && <button onClick={cancelCrop} className="px-4 py-2 bg-red-500 text-white rounded-lg">❌ Cancel</button>}
            <button onClick={resetCrop} className="px-4 py-2 bg-surface rounded-lg">↺ Reset Crop</button>
            <label className="flex items-center gap-2">Brush:
              <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} />
              <input type="range" min="1" max="20" value={brushSize} onChange={(e) => setBrushSize(+e.target.value)} className="w-20" />
            </label>
            <button onClick={download} className="px-4 py-2 bg-green-600 text-white rounded-lg">💾 Download</button>
          </div>

          {/* Crop control panel (visible in crop mode) */}
          {cropMode && (
            <div className="bg-surface p-4 rounded-xl w-full max-w-xl space-y-3">
              <p className="font-semibold text-sm">Crop Area (pixels)</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col text-xs">X
                  <input type="number" value={cropX} onChange={(e) => setCropX(+e.target.value)} onBlur={updateCropFromInputs} className="bg-bg p-1 rounded" />
                </label>
                <label className="flex flex-col text-xs">Y
                  <input type="number" value={cropY} onChange={(e) => setCropY(+e.target.value)} onBlur={updateCropFromInputs} className="bg-bg p-1 rounded" />
                </label>
                <label className="flex flex-col text-xs">Width
                  <input type="number" value={cropW} onChange={(e) => setCropW(+e.target.value)} onBlur={updateCropFromInputs} className="bg-bg p-1 rounded" />
                </label>
                <label className="flex flex-col text-xs">Height
                  <input type="number" value={cropH} onChange={(e) => setCropH(+e.target.value)} onBlur={updateCropFromInputs} className="bg-bg p-1 rounded" />
                </label>
              </div>
              <button onClick={updateCropFromInputs} className="px-4 py-1 bg-secondary text-white rounded-lg text-sm">Apply Numbers</button>

              <p className="font-semibold text-sm pt-2">Preset Ratios</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => applyPreset(16, 9)} className="px-3 py-1 bg-bg rounded-lg text-sm">16:9</button>
                <button onClick={() => applyPreset(4, 3)} className="px-3 py-1 bg-bg rounded-lg text-sm">4:3</button>
                <button onClick={() => applyPreset(1, 1)} className="px-3 py-1 bg-bg rounded-lg text-sm">1:1</button>
                <button onClick={() => applyPreset(9, 16)} className="px-3 py-1 bg-bg rounded-lg text-sm">9:16</button>
                <button onClick={() => applyPreset(21, 9)} className="px-3 py-1 bg-bg rounded-lg text-sm">21:9</button>
              </div>
            </div>
          )}

          {/* Canvas */}
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="border-2 border-primary rounded-2xl max-w-full shadow-2xl"
            style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', cursor: cropMode ? 'default' : drawing ? 'crosshair' : 'default' }}
          />
        </>
      )}
    </div>
  );
}