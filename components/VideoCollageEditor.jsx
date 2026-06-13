"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";

const CANVAS_PRESETS = {
  "1:1 (1080x1080)": { width: 1080, height: 1080 },
  "16:9 (1920x1080)": { width: 1920, height: 1080 },
  "9:16 (1080x1920)": { width: 1080, height: 1920 },
  "4:5 (1080x1350)": { width: 1080, height: 1350 },
  "21:9 (2560x1080)": { width: 2560, height: 1080 },
};

const DEFAULT_CANVAS = { width: 1280, height: 720 };
const FPS = 30;
const FRAME_MS = 1000 / FPS;

const generateId = () => Math.random().toString(36).substr(2, 9);

const PRESETS = [
  { name: "2 Grid H", frames: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] },
  { name: "2 Grid V", frames: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }] },
  { name: "3 Grid", frames: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }] },
  { name: "4 Grid", frames: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { name: "PIP Bottom Right", frames: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.65, y: 0.65, w: 0.3, h: 0.3 }] },
  { name: "3 Vertical", frames: [{ x: 0, y: 0, w: 1/3, h: 1 }, { x: 1/3, y: 0, w: 1/3, h: 1 }, { x: 2/3, y: 0, w: 1/3, h: 1 }] },
  { name: "Sidebar", frames: [{ x: 0, y: 0, w: 0.7, h: 1 }, { x: 0.7, y: 0, w: 0.3, h: 0.5 }, { x: 0.7, y: 0.5, w: 0.3, h: 0.5 }] },
  { name: "3 Equal Horizontal", frames: [{ x: 0, y: 0, w: 1, h: 1/3 }, { x: 0, y: 1/3, w: 1, h: 1/3 }, { x: 0, y: 2/3, w: 1, h: 1/3 }] },
  { name: "6 Grid", frames: Array.from({ length: 6 }, (_, i) => ({ x: (i % 3) / 3, y: Math.floor(i / 3) / 2, w: 1/3, h: 1/2 })) },
  { name: "9 Grid", frames: Array.from({ length: 9 }, (_, i) => ({ x: (i % 3) / 3, y: Math.floor(i / 3) / 3, w: 1/3, h: 1/3 })) },
];

export default function VideoCollageEditor() {
  // State (identical to previous)
  const [sourceVideos, setSourceVideos] = useState([]);
  const [elements, setElements] = useState([]);
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [preset, setPreset] = useState(PRESETS[0]);
  const [layoutMode, setLayoutMode] = useState(false);
  const [panZoom, setPanZoom] = useState({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [projectDuration, setProjectDuration] = useState(0);
  const [backgroundAudio, setBackgroundAudio] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [isDraggingPan, setIsDraggingPan] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [canvasSizeKey, setCanvasSizeKey] = useState("16:9 (1920x1080)");
  const canvasSize = CANVAS_PRESETS[canvasSizeKey] || DEFAULT_CANVAS;
  const [swapMode, setSwapMode] = useState(false);
  const swapFirstFrameRef = useRef(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(5);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportDone, setExportDone] = useState(false);
  const [exportBlob, setExportBlob] = useState(null);
  const [exportError, setExportError] = useState(null);
  const cancelledRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const bgAudioElRef = useRef(null);            // <audio> for preview
  const exportAudioElRef = useRef(null);         // separate <audio> for export (avoids conflict)

  const canvasRef = useRef(null);
  const videoElementsRef = useRef(new Map());
  const animationFrameRef = useRef(null);
  const playStartTimeRef = useRef(0);
  const isExportingRef = useRef(false);

  // ---------- helpers (identical to before, omitted for brevity but fully present) ----------
  const getSourceVideo = (id) => sourceVideos.find(v => v.id === id);

  const clearVideoElement = useCallback((sourceVideoId) => {
    if (videoElementsRef.current.has(sourceVideoId)) {
      const old = videoElementsRef.current.get(sourceVideoId);
      old.pause();
      old.src = "";
      videoElementsRef.current.delete(sourceVideoId);
    }
  }, []);

  const getVideoElement = useCallback((sourceVideoId) => {
    if (!sourceVideoId) return null;
    if (videoElementsRef.current.has(sourceVideoId)) return videoElementsRef.current.get(sourceVideoId);
    const src = getSourceVideo(sourceVideoId)?.url;
    if (!src) return null;
    const video = document.createElement("video");
    video.src = src;
    video.preload = "auto";
    video.playsInline = true;
    video.muted = true;
    video.playbackRate = 1;
    videoElementsRef.current.set(sourceVideoId, video);
    return video;
  }, [sourceVideos]);

  const getPanZoom = (frameIdx) => panZoom[frameIdx] || { offsetX: 0, offsetY: 0, zoom: 1 };

  useEffect(() => { setPanZoom({}); }, [canvasSizeKey]);

  useEffect(() => {
    if (sourceVideos.length === 0) { setElements([]); return; }
    const newElements = preset.frames.map((frame, idx) => {
      const vid = sourceVideos[idx % sourceVideos.length];
      return {
        id: generateId(),
        sourceVideoId: vid ? vid.id : null,
        frameIdx: idx,
        transform: { ...frame },
        trimStart: 0,
        trimEnd: vid ? vid.duration : 5,
        muted: true,
      };
    });
    setElements(newElements);
    setPanZoom({});
  }, [sourceVideos, preset]);

  useEffect(() => {
    let max = 0;
    elements.forEach(el => { if (el.sourceVideoId) max = Math.max(max, el.trimEnd - el.trimStart); });
    setProjectDuration(max);
  }, [elements]);

  useEffect(() => {
    if (selectedFrame !== null) {
      const el = elements.find(e => e.frameIdx === selectedFrame);
      if (el?.sourceVideoId) {
        setTrimStart(el.trimStart);
        setTrimEnd(el.trimEnd);
      }
    }
  }, [selectedFrame, elements]);

  const handleTrimChange = (type, value) => {
    if (selectedFrame === null) return;
    const src = getSourceVideo(elements.find(e => e.frameIdx === selectedFrame)?.sourceVideoId);
    if (!src) return;
    const max = src.duration;
    setElements(prev => prev.map(el => {
      if (el.frameIdx !== selectedFrame) return el;
      if (type === 'start') return { ...el, trimStart: Math.max(0, Math.min(value, el.trimEnd - 0.1)) };
      else return { ...el, trimEnd: Math.min(max, Math.max(value, el.trimStart + 0.1)) };
    }));
  };

  // ---------- canvas drawing ----------
  const drawOnCanvas = useCallback((canvas, hideOverlay = false) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { width, height } = canvasSize;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    elements.forEach(el => {
      if (!el.sourceVideoId) return;
      const video = getVideoElement(el.sourceVideoId);
      if (!video || video.readyState < 2) return;

      const f = el.transform;
      const x = f.x * width, y = f.y * height, w = f.w * width, h = f.h * height;
      const pz = getPanZoom(el.frameIdx);
      const zoom = pz.zoom, ox = pz.offsetX, oy = pz.offsetY;

      const vw = video.videoWidth || width, vh = video.videoHeight || height;
      const vAspect = vw / vh, fAspect = w / h;
      let bw, bh;
      if (vAspect > fAspect) { bh = h; bw = vw * (h / vh); }
      else { bw = w; bh = vh * (w / vw); }
      const dw = bw * zoom, dh = bh * zoom;
      const cx = x + w / 2, cy = y + h / 2;
      const dx = cx - dw / 2 + ox, dy = cy - dh / 2 + oy;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.drawImage(video, dx, dy, dw, dh);
      ctx.restore();

      if (!hideOverlay && !isExportingRef.current && selectedFrame === el.frameIdx) {
        ctx.strokeStyle = "#00f";
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);
      }
    });
  }, [elements, getVideoElement, selectedFrame, panZoom, canvasSize]);

  const drawStaticPreview = useCallback(() => drawOnCanvas(canvasRef.current, false), [drawOnCanvas]);
  useEffect(() => { drawStaticPreview(); }, [drawStaticPreview]);

  // Video ready listener
  useEffect(() => {
    const handler = () => drawStaticPreview();
    sourceVideos.forEach(v => {
      const el = getVideoElement(v.id);
      if (el) { el.addEventListener("loadeddata", handler); el.addEventListener("canplay", handler); }
    });
    return () => {
      sourceVideos.forEach(v => {
        const el = getVideoElement(v.id);
        if (el) { el.removeEventListener("loadeddata", handler); el.removeEventListener("canplay", handler); }
      });
    };
  }, [sourceVideos, drawStaticPreview, getVideoElement]);

  // ---------- background audio (preview) ----------
  useEffect(() => {
    if (backgroundAudio && !bgAudioElRef.current) {
      const a = new Audio(backgroundAudio.url);
      a.loop = false;
      bgAudioElRef.current = a;
    } else if (!backgroundAudio && bgAudioElRef.current) {
      bgAudioElRef.current.pause();
      bgAudioElRef.current.src = "";
      bgAudioElRef.current = null;
    }
    return () => { if (bgAudioElRef.current) { bgAudioElRef.current.pause(); bgAudioElRef.current.src = ""; bgAudioElRef.current = null; } };
  }, [backgroundAudio]);

  useEffect(() => {
    const audio = bgAudioElRef.current;
    if (!audio || !backgroundAudio) return;
    if (isPlaying) { audio.currentTime = backgroundAudio.trimStart || 0; audio.play().catch(() => {}); }
    else audio.pause();
  }, [isPlaying, backgroundAudio]);

  // ---------- playback ----------
  const stopPlayback = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    videoElementsRef.current.forEach(v => v.pause());
    if (bgAudioElRef.current) bgAudioElRef.current.pause();
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (elements.length === 0) return;
    stopPlayback();
    const start = currentTime >= projectDuration ? 0 : currentTime;
    setCurrentTime(start);
    playStartTimeRef.current = performance.now() / 1000;

    elements.forEach(el => {
      if (!el.sourceVideoId) return;
      const v = getVideoElement(el.sourceVideoId);
      if (!v) return;
      v.currentTime = el.trimStart;
      v.playbackRate = 1;
      v.play().catch(() => {});
    });
    setIsPlaying(true);

    const animate = () => {
      const now = performance.now() / 1000;
      const elapsed = now - playStartTimeRef.current;
      const newTime = start + elapsed;
      setCurrentTime(newTime);

      elements.forEach(el => {
        if (!el.sourceVideoId) return;
        const v = getVideoElement(el.sourceVideoId);
        if (!v) return;
        const local = el.trimStart + newTime;
        if (local <= el.trimEnd) {
          if (Math.abs(v.currentTime - local) > 0.2) v.currentTime = local;
          if (v.paused) v.play().catch(() => {});
        } else v.pause();
      });

      if (bgAudioElRef.current && backgroundAudio) {
        const dur = backgroundAudio.trimEnd - backgroundAudio.trimStart;
        if (elapsed > dur && !bgAudioElRef.current.paused) bgAudioElRef.current.pause();
      }

      drawStaticPreview();

      if (newTime >= projectDuration) {
        stopPlayback();
        return;
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [currentTime, projectDuration, elements, getVideoElement, drawStaticPreview, stopPlayback, backgroundAudio]);

  // ---------- mouse handlers (resize, swap, context menu, delete, replace) ----------
  const handleCanvasMouseDown = (e) => {
    if (layoutMode || swapMode || selectedFrame === null) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
    const el = elements.find(el => el.frameIdx === selectedFrame);
    if (!el) return;
    const f = el.transform;
    const fx = f.x * canvas.width, fy = f.y * canvas.width, fw = f.w * canvas.width, fh = f.h * canvas.height;
    if (mx >= fx && mx <= fx + fw && my >= fy && my <= fy + fh) {
      setIsDraggingPan(true);
      dragStartRef.current = { x: mx, y: my };
      e.preventDefault();
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (!isDraggingPan) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
    const dx = mx - dragStartRef.current.x, dy = my - dragStartRef.current.y;
    setPanZoom(prev => {
      const curr = prev[selectedFrame] || { offsetX: 0, offsetY: 0, zoom: 1 };
      return { ...prev, [selectedFrame]: { ...curr, offsetX: curr.offsetX + dx, offsetY: curr.offsetY + dy } };
    });
    dragStartRef.current = { x: mx, y: my };
  };

  const handleCanvasMouseUp = () => setIsDraggingPan(false);

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
    let hitIdx = null;
    elements.forEach(el => {
      const f = el.transform;
      if (mx >= f.x * canvas.width && mx <= (f.x + f.w) * canvas.width &&
          my >= f.y * canvas.height && my <= (f.y + f.h) * canvas.height) hitIdx = el.frameIdx;
    });

    if (swapMode && hitIdx !== null) {
      if (swapFirstFrameRef.current === null) {
        swapFirstFrameRef.current = hitIdx;
        setSelectedFrame(hitIdx);
      } else if (swapFirstFrameRef.current !== hitIdx) {
        const frameA = swapFirstFrameRef.current, frameB = hitIdx;
        setElements(prev => {
          const newEls = prev.map(el => ({ ...el }));
          const a = newEls.find(el => el.frameIdx === frameA), b = newEls.find(el => el.frameIdx === frameB);
          if (a && b) {
            [a.sourceVideoId, b.sourceVideoId] = [b.sourceVideoId, a.sourceVideoId];
            [a.muted, b.muted] = [b.muted, a.muted];
            [a.trimStart, b.trimStart] = [b.trimStart, a.trimStart];
            [a.trimEnd, b.trimEnd] = [b.trimEnd, a.trimEnd];
          }
          return newEls;
        });
        setPanZoom(prev => { const n = { ...prev }; delete n[frameA]; delete n[frameB]; return n; });
        swapFirstFrameRef.current = null;
        setSelectedFrame(null);
        setSwapMode(false);
      }
      return;
    }
    setSelectedFrame(hitIdx);
    swapFirstFrameRef.current = null;
  };

  const handleCanvasContextMenu = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
    let hitIdx = null;
    elements.forEach(el => {
      const f = el.transform;
      if (mx >= f.x * canvas.width && mx <= (f.x + f.w) * canvas.width &&
          my >= f.y * canvas.height && my <= (f.y + f.h) * canvas.height) hitIdx = el.frameIdx;
    });
    if (hitIdx !== null) {
      setSelectedFrame(hitIdx);
      setContextMenu({ x: e.clientX, y: e.clientY, frameIdx: hitIdx });
    }
  };

  const deleteFrameClip = () => {
    if (!contextMenu) return;
    setElements(prev => prev.map(el => el.frameIdx === contextMenu.frameIdx ? { ...el, sourceVideoId: null } : el));
    setContextMenu(null);
  };

  const replaceFrameClip = () => {
    if (!contextMenu) return;
    const input = document.createElement("input");
    input.type = "file"; input.accept = "video/*";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.src = url; video.preload = "metadata";
      video.onloadedmetadata = () => {
        const newId = generateId();
        const newObj = { id: newId, file, url, duration: video.duration, videoWidth: video.videoWidth, videoHeight: video.videoHeight };
        const oldEl = elements.find(el => el.frameIdx === contextMenu.frameIdx);
        if (oldEl?.sourceVideoId) clearVideoElement(oldEl.sourceVideoId);
        setSourceVideos(prev => [...prev, newObj]);
        setElements(prev => prev.map(el => el.frameIdx === contextMenu.frameIdx ? { ...el, sourceVideoId: newId, trimStart: 0, trimEnd: video.duration } : el));
        setContextMenu(null);
        const newVe = getVideoElement(newId);
        if (newVe) newVe.addEventListener("canplay", () => drawStaticPreview(), { once: true });
      };
    };
    input.click();
  };

  const handleVideoUpload = (e) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.src = url; video.preload = "metadata";
      video.onloadedmetadata = () => setSourceVideos(prev => [...prev, { id: generateId(), file, url, duration: video.duration, videoWidth: video.videoWidth, videoHeight: video.videoHeight }]);
    });
  };

  const handleBgAudioUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    fetch(url).then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b)).then(decoded => {
      setBackgroundAudio({ file, url, duration: decoded.duration, waveform: decoded.getChannelData(0), trimStart: 0, trimEnd: decoded.duration });
    }).catch(() => setBackgroundAudio({ file, url, duration: 0, waveform: null, trimStart: 0, trimEnd: 0 }));
  };

  // ========== ROBUST EXPORT (offscreen canvas, exact duration) ==========
  const exportVideo = async () => {
    if (elements.length === 0 || projectDuration <= 0) {
      setExportError("Add at least one video with duration.");
      setExporting(true); setExportDone(true); return;
    }
    cancelledRef.current = false;
    setExporting(true); setExportProgress(0); setExportDone(false); setExportBlob(null); setExportError(null);

    // Hide overlay
    isExportingRef.current = true;
    drawStaticPreview();

    // 1. Wait for all videos to be ready
    await Promise.all(elements.map(el => {
      if (!el.sourceVideoId) return Promise.resolve();
      const v = getVideoElement(el.sourceVideoId);
      if (!v) return Promise.resolve();
      return new Promise(resolve => {
        if (v.readyState >= 3) resolve();
        else { v.addEventListener("canplay", resolve, { once: true }); setTimeout(resolve, 3000); }
      });
    }));

    // 2. Start all source videos at trimStart (they will be updated by the export loop)
    elements.forEach(el => {
      if (!el.sourceVideoId) return;
      const v = getVideoElement(el.sourceVideoId);
      if (!v) return;
      v.currentTime = el.trimStart;
      v.playbackRate = 1;
      v.muted = true;
      v.play().catch(() => {});
    });

    // 3. Background audio – create a fresh <audio> element for export to avoid conflicts
    if (backgroundAudio && bgAudioElRef.current) {
      // Pause the preview audio and create a new one for export
      bgAudioElRef.current.pause();
      const exportAudio = new Audio(backgroundAudio.url);
      exportAudio.loop = false;
      exportAudio.currentTime = backgroundAudio.trimStart || 0;
      exportAudioElRef.current = exportAudio;
      await exportAudio.play().catch(() => {});
    }

    // 4. Offscreen canvas
    const offscreen = document.createElement("canvas");
    offscreen.width = canvasSize.width;
    offscreen.height = canvasSize.height;

    const canvasStream = offscreen.captureStream(FPS);
    let combinedStream = canvasStream;

    // 5. Mix background audio into stream if present
    let audioCtx = null, sourceNode = null;
    if (exportAudioElRef.current) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        sourceNode = audioCtx.createMediaElementSource(exportAudioElRef.current);
        const dest = audioCtx.createMediaStreamDestination();
        sourceNode.connect(dest);
        const vt = canvasStream.getVideoTracks()[0];
        const at = dest.stream.getAudioTracks()[0];
        combinedStream = new MediaStream([vt, at]);
      } catch (err) { console.warn("Audio mix failed", err); }
    }

    const mime = MediaRecorder.isTypeSupported('video/webm; codecs=vp9') ? 'video/webm; codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(combinedStream, { mimeType: mime, videoBitsPerSecond: 5000000 });
    mediaRecorderRef.current = recorder;
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

    recorder.onstop = () => {
      if (chunks.length === 0) {
        setExportError("No data recorded.");
        cleanupExport(); return;
      }
      setExportBlob(new Blob(chunks, { type: mime }));
      setExportDone(true); setExporting(false); cleanupExport();
    };

    const cleanupExport = () => {
      elements.forEach(el => { if (el.sourceVideoId) getVideoElement(el.sourceVideoId)?.pause(); });
      if (exportAudioElRef.current) {
        exportAudioElRef.current.pause();
        exportAudioElRef.current.src = "";
        exportAudioElRef.current = null;
      }
      if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
      if (audioCtx) { audioCtx.close(); audioCtx = null; }
      isExportingRef.current = false;
      drawStaticPreview();
    };

    recorder.start();

    // 6. Frame-accurate drawing loop
    const startTime = performance.now() / 1000;
    const drawInterval = setInterval(() => {
      if (cancelledRef.current) {
        clearInterval(drawInterval);
        recorder.stop();
        cleanupExport();
        return;
      }

      const now = performance.now() / 1000;
      const elapsed = now - startTime;
      setExportProgress(Math.min(100, Math.round((elapsed / projectDuration) * 100)));

      // Update video positions to keep them in sync with elapsed time
      elements.forEach(el => {
        if (!el.sourceVideoId) return;
        const v = getVideoElement(el.sourceVideoId);
        if (!v) return;
        const local = el.trimStart + elapsed;
        if (local <= el.trimEnd) {
          if (Math.abs(v.currentTime - local) > 0.2) v.currentTime = local;
          if (v.paused) v.play().catch(() => {});
        } else v.pause();
      });

      // Draw onto offscreen canvas (always hide overlay)
      drawOnCanvas(offscreen, true);

      // Stop exactly after projectDuration, but draw one more frame + flush
      if (elapsed >= projectDuration) {
        drawOnCanvas(offscreen, true);
        if (recorder.state === 'recording') recorder.requestData();
        clearInterval(drawInterval);
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, 100);
      }
    }, FRAME_MS);

    // Safety timeout (1.5x project duration)
    setTimeout(() => {
      if (recorder.state === 'recording') {
        clearInterval(drawInterval);
        drawOnCanvas(offscreen, true);
        recorder.requestData();
        recorder.stop();
      }
    }, projectDuration * 1500);
  };

  const cancelExport = () => {
    cancelledRef.current = true;
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setExporting(false); setExportDone(false);
  };

  const downloadBlob = () => {
    if (!exportBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(exportBlob);
    a.download = "video-collage.webm";
    a.click();
  };

  const closeModal = () => { setExporting(false); setExportDone(false); setExportBlob(null); setExportError(null); };

  // ---------- UI rendering ----------
  const selectedPanZoom = selectedFrame !== null ? getPanZoom(selectedFrame) : { offsetX: 0, offsetY: 0, zoom: 1 };
  const selectedElement = selectedFrame !== null ? elements.find(e => e.frameIdx === selectedFrame) : null;
  const selectedSourceVideo = selectedElement ? getSourceVideo(selectedElement.sourceVideoId) : null;

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white" onContextMenu={(e) => e.preventDefault()}>
      {/* Toolbar */}
      <div className="p-3 bg-gray-800 flex flex-wrap gap-3 items-center border-b border-gray-700">
        <input type="file" accept="video/*" multiple onChange={handleVideoUpload} className="hidden" id="video-upload" />
        <label htmlFor="video-upload" className="px-3 py-1 bg-blue-600 rounded text-sm cursor-pointer">Add Videos</label>

        <select value={preset?.name} onChange={(e) => setPreset(PRESETS.find(p => p.name === e.target.value) || PRESETS[0])} className="bg-gray-700 rounded px-2 py-1 text-sm">
          {PRESETS.map(p => (<option key={p.name}>{p.name}</option>))}
        </select>

        <select value={canvasSizeKey} onChange={(e) => setCanvasSizeKey(e.target.value)} className="bg-gray-700 rounded px-2 py-1 text-sm">
          {Object.keys(CANVAS_PRESETS).map(k => (<option key={k}>{k}</option>))}
        </select>

        <button onClick={() => setLayoutMode(!layoutMode)} className={`px-3 py-1 rounded text-sm ${layoutMode ? 'bg-green-600' : 'bg-gray-600'}`}>
          {layoutMode ? "Layout Mode" : "Layout"}
        </button>
        <button onClick={() => { setSwapMode(!swapMode); swapFirstFrameRef.current = null; if (!swapMode) setSelectedFrame(null); }} className={`px-3 py-1 rounded text-sm ${swapMode ? 'bg-yellow-600' : 'bg-gray-600'}`}>
          {swapMode ? "Swapping (click two frames)" : "Swap Media"}
        </button>

        <div className="ml-auto flex gap-2">
          <input type="file" accept="audio/*" onChange={handleBgAudioUpload} className="hidden" id="bg-audio-upload" />
          <label htmlFor="bg-audio-upload" className="px-3 py-1 bg-gray-600 rounded text-sm cursor-pointer">Background Audio</label>
          <button onClick={exportVideo} className="px-3 py-1 bg-yellow-600 rounded text-sm">Export</button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center bg-black relative">
        <canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} className="max-w-full max-h-full object-contain"
          onMouseDown={handleCanvasMouseDown} onMouseMove={handleCanvasMouseMove} onMouseUp={handleCanvasMouseUp} onMouseLeave={handleCanvasMouseUp}
          onClick={handleCanvasClick} onContextMenu={handleCanvasContextMenu} />
      </div>

      {/* Playback controls */}
      <div className="p-2 bg-gray-800 border-t border-gray-700 flex items-center gap-4">
        <button onClick={isPlaying ? stopPlayback : startPlayback} className="px-4 py-1 bg-green-600 rounded text-sm">{isPlaying ? "Pause" : "Play"}</button>
        <span className="text-sm">{currentTime.toFixed(2)}s / {projectDuration.toFixed(2)}s</span>
        <input type="range" min={0} max={projectDuration || 0} step={0.01} value={currentTime} onChange={(e) => {
          const t = Number(e.target.value); setCurrentTime(t);
          if (!isPlaying) {
            elements.forEach(el => { if (!el.sourceVideoId) return; const v = getVideoElement(el.sourceVideoId); if (v) v.currentTime = el.trimStart + t; });
            drawStaticPreview();
          }
        }} className="flex-1" />
      </div>

      {/* Background Audio Timeline + Trim */}
      {backgroundAudio && backgroundAudio.waveform && (
        <div className="bg-gray-800 p-2 border-t border-gray-700">
          <div className="flex items-center gap-2 text-xs mb-1">
            <span className="truncate max-w-[150px]">{backgroundAudio.file.name}</span>
            <label>Start: <input type="range" min={0} max={backgroundAudio.duration} step={0.1} value={backgroundAudio.trimStart} onChange={(e) => { const v = Number(e.target.value); setBackgroundAudio(prev => ({ ...prev, trimStart: Math.min(v, prev.trimEnd - 0.1) })); }} className="w-20" /> {backgroundAudio.trimStart.toFixed(1)}s</label>
            <label>End: <input type="range" min={0} max={backgroundAudio.duration} step={0.1} value={backgroundAudio.trimEnd} onChange={(e) => { const v = Number(e.target.value); setBackgroundAudio(prev => ({ ...prev, trimEnd: Math.max(v, prev.trimStart + 0.1) })); }} className="w-20" /> {backgroundAudio.trimEnd.toFixed(1)}s</label>
            <span className="text-gray-400">({backgroundAudio.duration.toFixed(1)}s total)</span>
          </div>
          <div className="relative h-6 bg-gray-700 rounded overflow-hidden">
            <AudioWaveform waveformData={backgroundAudio.waveform} width={800} height={24} />
            <div className="absolute top-0 bottom-0 bg-yellow-500/30" style={{ left: `${(backgroundAudio.trimStart / backgroundAudio.duration) * 100}%`, width: `${((backgroundAudio.trimEnd - backgroundAudio.trimStart) / backgroundAudio.duration) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Trim panel */}
      {selectedFrame !== null && !layoutMode && !swapMode && selectedSourceVideo && (
        <div className="bg-gray-800 p-2 flex flex-wrap gap-4 items-center text-xs border-t border-gray-700">
          <span className="truncate max-w-[150px]">{selectedSourceVideo.file?.name}</span>
          <label>Start: <input type="range" min={0} max={selectedSourceVideo.duration} step={0.1} value={trimStart} onChange={(e) => { const v = Number(e.target.value); setTrimStart(v); handleTrimChange('start', v); }} className="w-24 ml-1" /> {trimStart.toFixed(1)}s</label>
          <label>End: <input type="range" min={0} max={selectedSourceVideo.duration} step={0.1} value={trimEnd} onChange={(e) => { const v = Number(e.target.value); setTrimEnd(v); handleTrimChange('end', v); }} className="w-24 ml-1" /> {trimEnd.toFixed(1)}s</label>
          <span className="text-gray-400">({selectedSourceVideo.duration.toFixed(1)}s full)</span>
        </div>
      )}

      {/* Pan/zoom panel */}
      {selectedFrame !== null && !layoutMode && !swapMode && (
        <div className="bg-gray-800 p-2 flex flex-wrap gap-4 items-center text-xs border-t border-gray-700">
          <span>Pan: drag inside frame</span>
          <label>Zoom: <input type="range" min={0.5} max={3} step={0.01} value={selectedPanZoom.zoom} onChange={(e) => setPanZoom(prev => ({ ...prev, [selectedFrame]: { ...prev[selectedFrame], zoom: parseFloat(e.target.value) } }))} className="w-32 ml-2" /> {selectedPanZoom.zoom.toFixed(2)}x</label>
          <button onClick={() => setPanZoom(prev => ({ ...prev, [selectedFrame]: { offsetX: 0, offsetY: 0, zoom: 1 } }))} className="px-2 py-1 bg-gray-600 rounded">Reset</button>
        </div>
      )}

      {/* Layout controls */}
      {layoutMode && selectedFrame !== null && (
        <div className="bg-gray-800 p-2 flex flex-wrap gap-2 text-xs border-t border-gray-700">
          <label>Left % <input type="number" value={Math.round((elements.find(e => e.frameIdx === selectedFrame)?.transform.x || 0) * 100)} onChange={(e) => setElements(prev => prev.map(el => el.frameIdx === selectedFrame ? { ...el, transform: { ...el.transform, x: Number(e.target.value) / 100 } } : el))} className="w-16 bg-gray-700 p-1 rounded" /></label>
          <label>Top % <input type="number" value={Math.round((elements.find(e => e.frameIdx === selectedFrame)?.transform.y || 0) * 100)} onChange={(e) => setElements(prev => prev.map(el => el.frameIdx === selectedFrame ? { ...el, transform: { ...el.transform, y: Number(e.target.value) / 100 } } : el))} className="w-16 bg-gray-700 p-1 rounded" /></label>
          <label>Width % <input type="number" value={Math.round((elements.find(e => e.frameIdx === selectedFrame)?.transform.w || 0) * 100)} onChange={(e) => setElements(prev => prev.map(el => el.frameIdx === selectedFrame ? { ...el, transform: { ...el.transform, w: Number(e.target.value) / 100 } } : el))} className="w-16 bg-gray-700 p-1 rounded" /></label>
          <label>Height % <input type="number" value={Math.round((elements.find(e => e.frameIdx === selectedFrame)?.transform.h || 0) * 100)} onChange={(e) => setElements(prev => prev.map(el => el.frameIdx === selectedFrame ? { ...el, transform: { ...el.transform, h: Number(e.target.value) / 100 } } : el))} className="w-16 bg-gray-700 p-1 rounded" /></label>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed bg-gray-700 border border-gray-600 rounded shadow-lg py-1 text-sm z-50" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={deleteFrameClip} className="block w-full text-left px-4 py-1 hover:bg-gray-600">Delete Clip</button>
          <button onClick={replaceFrameClip} className="block w-full text-left px-4 py-1 hover:bg-gray-600">Replace Clip</button>
        </div>
      )}

      {/* Export Modal */}
      {(exporting || exportDone || exportError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70">
          <div className="bg-gray-800 rounded-xl p-6 w-96 max-w-full text-center space-y-4">
            {exportError ? (
              <>
                <h3 className="text-lg font-semibold text-red-400">Export Error</h3>
                <p className="text-sm">{exportError}</p>
                <button onClick={closeModal} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm">Close</button>
              </>
            ) : exportDone && exportBlob ? (
              <>
                <h3 className="text-lg font-semibold text-green-400">Export Complete</h3>
                <p className="text-sm">Preview:</p>
                <video src={URL.createObjectURL(exportBlob)} controls className="w-full rounded" style={{ maxHeight: '200px' }} />
                <div className="flex flex-col gap-2">
                  <button onClick={downloadBlob} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm">Download Video</button>
                  <button onClick={closeModal} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm">Close</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">Exporting Video</h3>
                <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
                  <div className="bg-blue-500 h-4 rounded-full transition-all" style={{ width: `${exportProgress}%` }} />
                </div>
                <p className="text-sm">{exportProgress}%</p>
                <button onClick={cancelExport} className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm">Cancel Export</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Audio Waveform Component ──────────────────────────────
function AudioWaveform({ waveformData, width, height }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData) return;
    const ctx = canvas.getContext('2d');
    canvas.width = width; canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    const step = Math.ceil(waveformData.length / width);
    for (let i = 0; i < width; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const idx = i * step + j;
        if (idx < waveformData.length) {
          const v = waveformData[idx];
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      const y1 = ((min + 1) / 2) * height, y2 = ((max + 1) / 2) * height;
      ctx.moveTo(i, y1); ctx.lineTo(i, y2);
    }
    ctx.strokeStyle = '#00ff00';
    ctx.stroke();
  }, [waveformData, width, height]);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}