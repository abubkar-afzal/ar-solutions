// components/VideoEditor.jsx
import { useState, useRef, useEffect, useCallback } from 'react';

const MAX_CANVAS_WIDTH = 1920;
const MAX_CANVAS_HEIGHT = 1080;

export default function VideoEditor() {
  const [videoSrc, setVideoSrc] = useState(null);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(10);
  const [duration, setDuration] = useState(0);
  const [filter, setFilter] = useState('none');
  const [processing, setProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState(null);
  const [progress, setProgress] = useState(0);

  // Crop state
  const [cropMode, setCropMode] = useState(false);
  // cropRect is the single source of truth (in original video pixels)
  const [cropRect, setCropRect] = useState(null);
  const [appliedCrop, setAppliedCrop] = useState(null);

  // Local numeric inputs (synced with cropRect when it changes)
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropW, setCropW] = useState(0);
  const [cropH, setCropH] = useState(0);

  const cropDragInfo = useRef(null);   // { type:'move'|'handle', handle, startX, startY, origRect }

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const videoDimensions = useRef({ width: 0, height: 0 });
  const canvasScale = useRef(1);       // scale factor video->canvas while in crop mode

  // ─── Sync numeric inputs from cropRect ──────────────────
  useEffect(() => {
    if (cropRect) {
      setCropX(cropRect.x);
      setCropY(cropRect.y);
      setCropW(cropRect.w);
      setCropH(cropRect.h);
    }
  }, [cropRect]);

  // ─── Load video ──────────────────────────────────────────
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setOutputUrl(null);
    setCropRect(null);
    setAppliedCrop(null);
    setCropMode(false);
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
      setEndTime(Math.min(video.duration, 10));
      videoDimensions.current = { width: video.videoWidth, height: video.videoHeight };
      const full = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
      setCropRect(full);
      setAppliedCrop(full);
    }
  };

  const getFilterString = () => {
    switch (filter) {
      case 'grayscale': return 'grayscale(1)';
      case 'sepia':    return 'sepia(0.8)';
      case 'invert':   return 'invert(1)';
      default:         return 'none';
    }
  };

  // ─── Draw frame (scaled to fit) ──────────────────────────
  const drawFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    const vw = videoDimensions.current.width;
    const vh = videoDimensions.current.height;
    let drawWidth, drawHeight, scale;

    if (cropMode) {
      scale = Math.min(MAX_CANVAS_WIDTH / vw, MAX_CANVAS_HEIGHT / vh, 1);
      drawWidth = Math.round(vw * scale);
      drawHeight = Math.round(vh * scale);
      canvasScale.current = scale;
    } else {
      const crop = appliedCrop || { x: 0, y: 0, w: vw, h: vh };
      scale = 1;
      drawWidth = crop.w;
      drawHeight = crop.h;
      canvasScale.current = 1;
    }

    canvas.width = drawWidth;
    canvas.height = drawHeight;

    ctx.filter = getFilterString();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (cropMode) {
      ctx.drawImage(video, 0, 0, drawWidth, drawHeight);
    } else {
      const crop = appliedCrop || { x: 0, y: 0, w: vw, h: vh };
      ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, drawWidth, drawHeight);
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

      // Compute display‑scale for consistent handle size
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width ? canvas.width / rect.width : 1;
      const scaleY = rect.height ? canvas.height / rect.height : 1;
      const avgDisplayScale = (scaleX + scaleY) / 2;
      const handleSize = Math.max(10 * avgDisplayScale, 4);

      // Store hit radius for mouse handlers
      canvas._cropScale = { handleCanvasSize: handleSize, hitCanvasRadius: handleSize * 1.2, videoToCanvasScale: s };

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
  }, [filter, cropMode, cropRect, appliedCrop]);

  // Animation loop
  const animationLoop = useCallback(() => {
    drawFrame();
    const video = videoRef.current;
    if (video && !video.paused && !video.ended) {
      animFrameRef.current = requestAnimationFrame(animationLoop);
    }
  }, [drawFrame]);

  useEffect(() => { drawFrame(); }, [drawFrame]);

  const handlePlay = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(animationLoop);
  };
  const handlePause = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    drawFrame();
  };
  const seekToStart = () => {
    if (videoRef.current) videoRef.current.currentTime = startTime;
  };

  // ─── Mouse helpers for drag ──────────────────────────────
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

  const toVideoCoords = (canvasX, canvasY) => {
    const s = canvasScale.current || 1;
    return { x: canvasX / s, y: canvasY / s };
  };

  const handleMouseDown = (e) => {
    if (!cropMode || !cropRect) return;
    e.preventDefault();
    const { x: mx, y: my } = getCanvasCoords(e);
    const { x: vx, y: vy } = toVideoCoords(mx, my);

    // Get hit radius in video pixels
    const hitCanvasRadius = canvasRef.current._cropScale?.hitCanvasRadius || 20;
    const s = canvasScale.current || 1;
    const hitVideoRadius = hitCanvasRadius / s;

    const handles = [
      { x: cropRect.x, y: cropRect.y },
      { x: cropRect.x + cropRect.w, y: cropRect.y },
      { x: cropRect.x, y: cropRect.y + cropRect.h },
      { x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h },
    ];
    let handle = null;
    for (const h of handles) {
      if (Math.abs(vx - h.x) < hitVideoRadius && Math.abs(vy - h.y) < hitVideoRadius) {
        handle = h;
        break;
      }
    }
    if (handle) {
      cropDragInfo.current = { type: 'handle', handle, startX: vx, startY: vy, origRect: { ...cropRect } };
      return;
    }

    // Inside rectangle → move
    if (vx >= cropRect.x && vx <= cropRect.x + cropRect.w &&
        vy >= cropRect.y && vy <= cropRect.y + cropRect.h) {
      cropDragInfo.current = { type: 'move', startX: vx, startY: vy, origX: cropRect.x, origY: cropRect.y };
      return;
    }
  };

  const handleMouseMove = (e) => {
    if (!cropMode || !cropDragInfo.current) return;
    const { x: mx, y: my } = getCanvasCoords(e);
    const { x: vx, y: vy } = toVideoCoords(mx, my);
    const info = cropDragInfo.current;
    const orig = info.origRect;
    let newRect = { ...cropRect };

    if (info.type === 'move') {
      const dx = vx - info.startX;
      const dy = vy - info.startY;
      const vw = videoDimensions.current.width;
      const vh = videoDimensions.current.height;
      newRect.x = Math.max(0, Math.min(info.origX + dx, vw - newRect.w));
      newRect.y = Math.max(0, Math.min(info.origY + dy, vh - newRect.h));
    } else if (info.type === 'handle') {
      const dx = vx - info.startX;
      const dy = vy - info.startY;
      const handle = info.handle;

      if (handle.x === orig.x) { // left side
        newRect.x = Math.min(orig.x + orig.w - 10, orig.x + dx);
        newRect.w = orig.w - (newRect.x - orig.x);
      } else { // right side
        newRect.w = Math.max(10, orig.w + dx);
      }
      if (handle.y === orig.y) { // top side
        newRect.y = Math.min(orig.y + orig.h - 10, orig.y + dy);
        newRect.h = orig.h - (newRect.y - orig.y);
      } else { // bottom side
        newRect.h = Math.max(10, orig.h + dy);
      }

      // Clamp to video bounds
      newRect.x = Math.max(0, newRect.x);
      newRect.y = Math.max(0, newRect.y);
      if (newRect.x + newRect.w > videoDimensions.current.width) newRect.w = videoDimensions.current.width - newRect.x;
      if (newRect.y + newRect.h > videoDimensions.current.height) newRect.h = videoDimensions.current.height - newRect.y;
    }
    setCropRect(newRect);
  };

  const handleMouseUp = () => {
    cropDragInfo.current = null;
  };

  // ─── Crop control from numeric inputs ────────────────────
  const updateCropFromInputs = () => {
    const vw = videoDimensions.current.width;
    const vh = videoDimensions.current.height;
    const x = Math.max(0, Math.min(cropX, vw - 1));
    const y = Math.max(0, Math.min(cropY, vh - 1));
    const w = Math.max(10, Math.min(cropW, vw - x));
    const h = Math.max(10, Math.min(cropH, vh - y));
    setCropRect({ x, y, w, h });
  };

  // Aspect ratio presets
  const applyPreset = (ratioW, ratioH) => {
    const vw = videoDimensions.current.width;
    const vh = videoDimensions.current.height;
    let newW, newH;
    if (vw / vh > ratioW / ratioH) {
      newH = vh;
      newW = Math.round(vh * (ratioW / ratioH));
    } else {
      newW = vw;
      newH = Math.round(vw / (ratioW / ratioH));
    }
    const newX = Math.round((vw - newW) / 2);
    const newY = Math.round((vh - newH) / 2);
    setCropRect({ x: newX, y: newY, w: newW, h: newH });
  };

  // ─── Crop mode buttons ──────────────────────────────────
  const enterCropMode = () => {
    if (!videoDimensions.current.width) {
      alert('Upload a video first');
      return;
    }
    const current = appliedCrop || { x: 0, y: 0, w: videoDimensions.current.width, h: videoDimensions.current.height };
    setCropRect(current);
    setAppliedCrop(current);
    setCropMode(true);
    videoRef.current?.pause();
  };

  const applyCrop = () => {
    setAppliedCrop(cropRect);
    setCropMode(false);
  };

  const cancelCrop = () => {
    setCropRect(appliedCrop);
    setCropMode(false);
  };

  const resetCrop = () => {
    const full = { x: 0, y: 0, w: videoDimensions.current.width, h: videoDimensions.current.height };
    setCropRect(full);
    setAppliedCrop(full);
    setCropMode(false);
  };

  // ─── Export ──────────────────────────────────────────────
  const exportVideo = async () => {
    const video = videoRef.current;
    if (!video) return;
    setProcessing(true);
    setProgress(0);

    const crop = appliedCrop || { x: 0, y: 0, w: videoDimensions.current.width, h: videoDimensions.current.height };
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = crop.w;
    exportCanvas.height = crop.h;
    const exportCtx = exportCanvas.getContext('2d');

    const stream = exportCanvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
    const chunks = [];

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      setOutputUrl(URL.createObjectURL(blob));
      setProcessing(false);
      setProgress(0);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };

    recorder.start();
    video.currentTime = startTime;
    video.play();

    const checkTime = () => {
      if (video.currentTime >= endTime || video.ended || video.paused) {
        video.pause();
        recorder.stop();
      } else {
        setProgress(((video.currentTime - startTime) / (endTime - startTime)) * 100);
        requestAnimationFrame(checkTime);
      }
    };

    const drawDuringExport = () => {
      exportCtx.filter = getFilterString();
      exportCtx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, exportCanvas.width, exportCanvas.height);
      exportCtx.filter = 'none';
      if (recorder.state === 'recording') requestAnimationFrame(drawDuringExport);
    };
    drawDuringExport();
    requestAnimationFrame(checkTime);
  };

  useEffect(() => {
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, []);

  return (
    <div className="p-6 flex flex-col items-center gap-4">
      <input type="file" accept="video/*" onChange={handleFile} className="mb-4" />

      {videoSrc && (
        <>
          <video
            ref={videoRef}
            src={videoSrc}
            className="hidden"
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={handlePlay}
            onPause={handlePause}
          />

          {cropMode && (
            <div className="bg-yellow-100 text-yellow-900 p-3 rounded-xl text-sm max-w-xl w-full text-center">
              🟩 Drag the <b>yellow corners</b> to resize, or drag inside to move. Use the panel below for exact numbers.
            </div>
          )}

          {/* Canvas – draggable in crop mode */}
          <canvas
            ref={canvasRef}
            className="max-w-full rounded-xl border-2 border-primary shadow-2xl"
            style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }}
            onMouseDown={cropMode ? handleMouseDown : undefined}
            onMouseMove={cropMode ? handleMouseMove : undefined}
            onMouseUp={cropMode ? handleMouseUp : undefined}
            onMouseLeave={cropMode ? handleMouseUp : undefined}
          />

          <div className="flex flex-wrap gap-4 justify-center items-center">
            <button onClick={() => videoRef.current?.play()} className="px-4 py-2 bg-accent text-white rounded-lg">▶ Play</button>
            <button onClick={() => videoRef.current?.pause()} className="px-4 py-2 bg-muted text-white rounded-lg">⏸ Pause</button>
            <button onClick={seekToStart} className="px-4 py-2 bg-secondary text-white rounded-lg">⏪ Seek Start</button>
          </div>

          <div className="flex flex-col gap-2 w-full max-w-xl">
            <label>Start (s):
              <input type="range" min={0} max={duration} step={0.1} value={startTime} onChange={(e) => setStartTime(+e.target.value)} />
              <span>{startTime.toFixed(1)}</span>
            </label>
            <label>End (s):
              <input type="range" min={0} max={duration} step={0.1} value={endTime} onChange={(e) => setEndTime(+e.target.value)} />
              <span>{endTime.toFixed(1)}</span>
            </label>
          </div>

          <label>Effect:
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-surface rounded-lg p-2 ml-2">
              <option value="none">None</option>
              <option value="grayscale">Grayscale</option>
              <option value="sepia">Sepia</option>
              <option value="invert">Invert</option>
            </select>
          </label>

          {/* ─── Crop control panel (visible only in crop mode) ─── */}
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

          {/* ─── Crop mode buttons ──────────────────────────── */}
          <div className="flex flex-wrap gap-4 justify-center">
            {!cropMode ? (
              <>
                <button onClick={enterCropMode} className="px-4 py-2 bg-surface rounded-lg">✂ Crop</button>
                <button onClick={resetCrop} className="px-4 py-2 bg-surface rounded-lg">↺ Reset Crop</button>
              </>
            ) : (
              <>
                <button onClick={applyCrop} className="px-4 py-2 bg-green-600 text-white rounded-lg">✅ Apply Crop</button>
                <button onClick={cancelCrop} className="px-4 py-2 bg-red-500 text-white rounded-lg">❌ Cancel</button>
              </>
            )}
          </div>

          <button onClick={exportVideo} disabled={processing} className="px-6 py-3 bg-primary text-white rounded-xl">
            {processing ? `Rendering... ${progress.toFixed(0)}%` : 'Render & Download'}
          </button>

          {outputUrl && (
            <a href={outputUrl} download="edited_video.webm" className="text-accent underline">⬇ Download Edited Video</a>
          )}
        </>
      )}
    </div>
  );
}