// components/VideoEditor.jsx
import { useState, useRef, useEffect, useCallback } from 'react';

export default function VideoEditor() {
  const [videoSrc, setVideoSrc] = useState(null);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(10);
  const [duration, setDuration] = useState(0);
  const [filter, setFilter] = useState('none');
  const [processing, setProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState(null);
  const [progress, setProgress] = useState(0);

  // Crop state – exactly like PhotoEditor
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState(null);       // { x, y, w, h } in video pixels
  const [appliedCrop, setAppliedCrop] = useState(null);  // crop used for display/export
  const cropDragInfo = useRef(null);                     // { type: 'move'|'handle', ... }

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const videoDimensions = useRef({ width: 0, height: 0 });

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
    cropDragInfo.current = null;
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
      setEndTime(Math.min(video.duration, 10));
      videoDimensions.current = {
        width: video.videoWidth,
        height: video.videoHeight,
      };
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

  // ─── Draw the canvas (works exactly like PhotoEditor) ────
  const drawFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    const vw = videoDimensions.current.width;
    const vh = videoDimensions.current.height;

    // During crop mode, canvas stays at full video size (like the original image in PhotoEditor)
    if (cropMode) {
      canvas.width = vw;
      canvas.height = vh;
    } else {
      // After crop applied, canvas shows only the cropped area
      const crop = appliedCrop || { x: 0, y: 0, w: vw, h: vh };
      canvas.width = crop.w;
      canvas.height = crop.h;
    }

    ctx.filter = getFilterString();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (cropMode) {
      // Full frame with overlay
      ctx.drawImage(video, 0, 0, vw, vh);
    } else {
      // Cropped view
      const crop = appliedCrop || { x: 0, y: 0, w: vw, h: vh };
      ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    }
    ctx.filter = 'none';

    // Crop overlay (only in crop mode and when a rectangle exists)
    if (cropMode && cropRect) {
      // Green rectangle
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 4;
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);

      // Yellow corner handles (16x16)
      const handles = [
        [cropRect.x, cropRect.y],
        [cropRect.x + cropRect.w, cropRect.y],
        [cropRect.x, cropRect.y + cropRect.h],
        [cropRect.x + cropRect.w, cropRect.y + cropRect.h],
      ];
      handles.forEach(([hx, hy]) => {
        ctx.fillStyle = '#ff0';
        ctx.fillRect(hx - 8, hy - 8, 16, 16);
      });
    }
  }, [filter, cropMode, cropRect, appliedCrop]);

  // Animation loop (while playing)
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

  // ─── Mouse helpers (identical to PhotoEditor) ────────────
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

  const handleMouseDown = (e) => {
    if (!cropMode || !cropRect) return;
    const { x: mx, y: my } = getCanvasCoords(e);

    // Check handles (hit radius = 20px for big handles)
    const handles = [
      { x: cropRect.x, y: cropRect.y },
      { x: cropRect.x + cropRect.w, y: cropRect.y },
      { x: cropRect.x, y: cropRect.y + cropRect.h },
      { x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h },
    ];
    let handle = null;
    for (const h of handles) {
      if (Math.abs(mx - h.x) < 20 && Math.abs(my - h.y) < 20) {
        handle = h;
        break;
      }
    }
    if (handle) {
      cropDragInfo.current = { type: 'handle', handle, startX: mx, startY: my, origRect: { ...cropRect } };
      return;
    }

    // Inside rectangle → move
    if (mx >= cropRect.x && mx <= cropRect.x + cropRect.w &&
        my >= cropRect.y && my <= cropRect.y + cropRect.h) {
      cropDragInfo.current = { type: 'move', startX: mx, startY: my, origX: cropRect.x, origY: cropRect.y };
      return;
    }

    // Click outside → start drawing a new rectangle (just like PhotoEditor!)
    // We'll set a flag to draw a new rectangle? Actually in PhotoEditor, you drag to draw,
    // but the current logic doesn't draw new rectangles on click; it only moves/resizes.
    // To be exactly like PhotoEditor: we need drawing mode. Let's add it.
    // However, the user hasn't complained about missing draw-new-rect in PhotoEditor,
    // but we can add a simple "draw new rectangle" behavior:
    // If no drag info was set, we start a new rectangle from this point.
    // For simplicity, we'll just reset the cropRect to a zero-size at mouse point.
    // But that would erase the existing rectangle instantly. Better: allow dragging from outside
    // to create a new rectangle. Let's implement the same drawing logic from earlier attempts.
    // I'll add a 'drawing' state similar to PhotoEditor (but PhotoEditor doesn't draw new rectangles either – it only moves/resizes). The user didn't mention drawing; they just want move/resize.
    // So we'll leave it as move/resize only, and if they want to change the rectangle drastically, they can click "Reset Crop" or re-enter crop mode.
    // However, the original PhotoEditor also allows drawing new rectangles? No, in the PhotoEditor, entering crop mode sets a default rectangle, and you can only move/resize. There's no drawing. So we'll stick with that.
    return;
  };

  const handleMouseMove = (e) => {
    if (!cropMode || !cropDragInfo.current) return;
    const { x: mx, y: my } = getCanvasCoords(e);
    const info = cropDragInfo.current;
    const orig = info.origRect;
    let newRect = { ...cropRect };

    if (info.type === 'move') {
      const dx = mx - info.startX;
      const dy = my - info.startY;
      const vw = videoDimensions.current.width;
      const vh = videoDimensions.current.height;
      newRect.x = Math.max(0, Math.min(info.origX + dx, vw - newRect.w));
      newRect.y = Math.max(0, Math.min(info.origY + dy, vh - newRect.h));
    } else if (info.type === 'handle') {
      const dx = mx - info.startX;
      const dy = my - info.startY;
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

  // ─── Crop control buttons ────────────────────────────────
  const enterCropMode = () => {
    if (!videoDimensions.current.width) {
      alert('Upload a video first');
      return;
    }
    setCropMode(true);
    // Use applied crop as starting rectangle, or full frame
    setCropRect(appliedCrop || { x: 0, y: 0, w: videoDimensions.current.width, h: videoDimensions.current.height });
    cropDragInfo.current = null;
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
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setProcessing(true);
    setProgress(0);

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
    const chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

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
        const prog = ((video.currentTime - startTime) / (endTime - startTime)) * 100;
        setProgress(prog);
        requestAnimationFrame(checkTime);
      }
    };

    const drawDuringExport = () => {
      const ctx = canvas.getContext('2d');
      const crop = appliedCrop || { x: 0, y: 0, w: videoDimensions.current.width, h: videoDimensions.current.height };
      canvas.width = crop.w;
      canvas.height = crop.h;
      ctx.filter = getFilterString();
      ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
      ctx.filter = 'none';
      if (recorder.state === 'recording') {
        animFrameRef.current = requestAnimationFrame(drawDuringExport);
      }
    };
    drawDuringExport();
    requestAnimationFrame(checkTime);
  };

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
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
              🟩 Drag the <b>yellow corners</b> to resize. Click inside the rectangle and drag to move.
            </div>
          )}

          <canvas
            ref={canvasRef}
            className="max-w-full rounded-xl border-2 border-primary shadow-2xl"
            style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
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

          <div className="flex flex-wrap gap-4 justify-center">
            {!cropMode && (
              <>
                <button onClick={enterCropMode} className="px-4 py-2 bg-surface rounded-lg">✂ Crop</button>
                <button onClick={resetCrop} className="px-4 py-2 bg-surface rounded-lg">↺ Reset Crop</button>
              </>
            )}
            {cropMode && (
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