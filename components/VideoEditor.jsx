// components/VideoEditor.jsx (Part 1 of 2)

import { useState, useRef, useEffect, useCallback } from 'react';

const DEFAULT_PPS = 80;
const MIN_PPS = 20;
const MAX_PPS = 300;
const TRACK_HEIGHT = 56;
const TRACK_LABEL_WIDTH = 80;
const TIME_RULER_HEIGHT = 24;
const FPS = 30;

let idCounter = 1;
const uid = () => idCounter++;

const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

const ASPECT_RATIOS = {
  '1:1 (Instagram)':   { width: 1080, height: 1080 },
  '9:16 (TikTok)':      { width: 1080, height: 1920 },
  '16:9 (YouTube)':     { width: 1920, height: 1080 },
};

export default function VideoEditor() {
  // ─── State ─────────────────────────────────
  const [mediaLibrary, setMediaLibrary] = useState([]);
  const [tracks, setTracks] = useState([
    { id: uid(), type: 'video', muted: false, solo: false, clips: [] },
    { id: uid(), type: 'video', muted: false, solo: false, clips: [] },
    { id: uid(), type: 'audio', muted: false, solo: false, clips: [] },
  ]);
  const [selected, setSelected] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [filter, setFilter] = useState('none');

  const [selectedAspect, setSelectedAspect] = useState('16:9 (YouTube)');
  const outputSize = ASPECT_RATIOS[selectedAspect];
  const [exportWidth, exportHeight] = [outputSize.width, outputSize.height];

  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState(null);
  const [appliedCropMap, setAppliedCropMap] = useState({});

  const [appliedTransformMap, setAppliedTransformMap] = useState({});
  const [transformDrag, setTransformDrag] = useState(null);
  const [cropDragActive, setCropDragActive] = useState(null);

  const [audioGain, setAudioGain] = useState(1);
  const [audioFilterFreq, setAudioFilterFreq] = useState(1000);
  const [audioEffectsMap, setAudioEffectsMap] = useState({});
  const [processing, setProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState(null);
  const [progress, setProgress] = useState(0);
  const [pps, setPps] = useState(DEFAULT_PPS);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [contextMenu, setContextMenu] = useState(null);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportElapsed, setExportElapsed] = useState(0);
  const [exportTotalFrames, setExportTotalFrames] = useState(0);
  const exportCancelRef = useRef(false);
  const exportStartTimeRef = useRef(0);

  // Refs
  const canvasRef = useRef(null);
  const timelineScrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const mediaCache = useRef({});
  const audioBufferCache = useRef({});
  const animFrameRef = useRef(null);
  const dragInfo = useRef(null);
  const lastUIUpdateRef = useRef(0);
  const thumbnailCache = useRef({});
  const playheadLineRef = useRef(null);
  const audioContextRef = useRef(null);
  const activeAudioSourcesRef = useRef([]);
  const scheduledAudioTimeoutRef = useRef(null);
  const frameCacheRef = useRef({});         // stores { canvas, crop, transform, time }
  const lastGoodFrameRef = useRef({});      // fallback: canvas per mediaId
  const seekingRef = useRef({});
  const exportIntervalRef = useRef(null);

  const [clipMutedMap, setClipMutedMap] = useState({});
  const [fitToFrame, setFitToFrame] = useState(false);

  const duration = tracks.reduce((max, t) => {
    t.clips.forEach(c => { if (c.end > max) max = c.end; });
    return max;
  }, 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = exportWidth;
      canvas.height = exportHeight;
    }
  }, [exportWidth, exportHeight]);

  // ─── Helpers ───────────────────────────────
  const getClip = (trackId, clipId) => tracks.find(t => t.id === trackId)?.clips.find(c => c.id === clipId);
  const getMedia = (mediaId) => mediaLibrary.find(m => m.id === mediaId);
  const getTrackIndex = (trackId) => tracks.findIndex(t => t.id === trackId);

  const getFilterString = useCallback(() => {
    switch (filter) {
      case 'grayscale': return 'grayscale(1)';
      case 'sepia':    return 'sepia(0.8)';
      case 'invert':   return 'invert(1)';
      default:         return 'none';
    }
  }, [filter]);

  const getMediaElement = (mediaId, type) => {
    if (!mediaCache.current[mediaId]) {
      const media = getMedia(mediaId);
      if (!media) return null;
      if (type === 'video') {
        const el = document.createElement('video');
        el.src = media.url;
        el.preload = 'auto';
        el.muted = true;
        mediaCache.current[mediaId] = el;
      } else if (type === 'image') {
        const img = new Image();
        img.src = media.url;
        mediaCache.current[mediaId] = img;
      }
    }
    return mediaCache.current[mediaId];
  };

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  const decodeAudioForMedia = useCallback(async (mediaId, url) => {
    if (audioBufferCache.current[mediaId]) return audioBufferCache.current[mediaId];
    const ctx = getAudioContext();
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    audioBufferCache.current[mediaId] = audioBuffer;
    return audioBuffer;
  }, []);

  const getThumbnailStrip = useCallback(async (mediaId, clipDuration) => {
    if (thumbnailCache.current[mediaId]) return thumbnailCache.current[mediaId];
    const media = getMedia(mediaId);
    if (!media || media.type === 'audio') return null;
    if (media.type === 'image') {
      thumbnailCache.current[mediaId] = media.url;
      return media.url;
    }
    const video = getMediaElement(mediaId, 'video');
    if (!video) return null;
    return new Promise((resolve) => {
      const handle = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const thumbWidth = 60;
        const thumbHeight = 40;
        const count = Math.min(20, Math.ceil(clipDuration * 2));
        canvas.width = thumbWidth * count;
        canvas.height = thumbHeight;
        let captured = 0;
        const step = clipDuration / count;
        const capture = () => {
          if (captured >= count) {
            const dataURL = canvas.toDataURL();
            thumbnailCache.current[mediaId] = dataURL;
            resolve(dataURL);
            return;
          }
          video.currentTime = captured * step;
          video.addEventListener('seeked', () => {
            ctx.drawImage(video, captured * thumbWidth, 0, thumbWidth, thumbHeight);
            captured++;
            capture();
          }, { once: true });
        };
        capture();
      };
      if (video.readyState >= 2) handle();
      else video.addEventListener('loadeddata', handle, { once: true });
    });
  }, [getMedia, getMediaElement]);

  const snapToGrid = (time, excludeClipId = null) => {
    if (!snapEnabled) return time;
    const snapThreshold = 0.15;
    let best = time;
    const nearestSec = Math.round(time);
    if (Math.abs(nearestSec - time) < snapThreshold) best = nearestSec;
    if (Math.abs(playheadRef.current - time) < snapThreshold) best = playheadRef.current;
    tracks.forEach(track => {
      track.clips.forEach(c => {
        if (c.id === excludeClipId) return;
        if (Math.abs(c.start - time) < snapThreshold) best = c.start;
        if (Math.abs(c.end - time) < snapThreshold) best = c.end;
      });
    });
    return best;
  };

  const areAllMediaReady = () => {
    const usedMediaIds = new Set();
    tracks.forEach(t => t.clips.forEach(c => usedMediaIds.add(c.mediaId)));
    return [...usedMediaIds].every(id => {
      const m = getMedia(id);
      return m && m.ready;
    });
  };

  // ─── Upload & auto‑place ────────────────────
  const handleMediaUpload = (e) => {
    const files = e.target.files;
    if (!files.length) return;
    const newMedia = [];
    Array.from(files).forEach(file => {
      const id = uid();
      const url = URL.createObjectURL(file);
      const type = file.type.startsWith('video') ? 'video'
               : file.type.startsWith('audio') ? 'audio'
               : 'image';
      const media = { id, type, url, file, duration: 0, width: 0, height: 0, waveform: null, audioBuffer: null, ready: false };
      newMedia.push(media);

      if (type === 'video' || type === 'audio') {
        const el = document.createElement(type === 'audio' ? 'audio' : 'video');
        el.src = url;
        el.preload = 'auto';
        el.onloadedmetadata = () => {
          const dur = el.duration || 5;
          setMediaLibrary(prev => prev.map(m => m.id === id ? {
            ...m, duration: dur,
            width: type === 'video' ? el.videoWidth : 0,
            height: type === 'video' ? el.videoHeight : 0
          } : m));
          autoPlaceClip(id, type, dur);
        };
        el.addEventListener('canplaythrough', () => {
          setMediaLibrary(prev => prev.map(m => m.id === id ? { ...m, ready: true } : m));
        }, { once: true });
        decodeAudioForMedia(id, url).then(buffer => {
          setMediaLibrary(prev => prev.map(m => m.id === id ? { ...m, audioBuffer: buffer } : m));
        }).catch(() => {});
        if (type === 'audio') {
          fetch(url)
            .then(res => res.arrayBuffer())
            .then(buf => {
              const ctx = getAudioContext();
              ctx.decodeAudioData(buf, (audioBuffer) => {
                const channelData = audioBuffer.getChannelData(0);
                setMediaLibrary(prev => prev.map(m => m.id === id ? { ...m, waveform: channelData } : m));
              });
            })
            .catch(() => {});
        }
      } else {
        const dur = 5;
        const img = new Image();
        img.src = url;
        img.onload = () => {
          setMediaLibrary(prev => prev.map(m => m.id === id ? {
            ...m, duration: dur, width: img.width, height: img.height, ready: true
          } : m));
          autoPlaceClip(id, 'image', dur);
        };
        img.onerror = () => {
          setMediaLibrary(prev => prev.map(m => m.id === id ? {
            ...m, duration: dur, width: 100, height: 100, ready: true
          } : m));
          autoPlaceClip(id, 'image', dur);
        };
      }
    });
    setMediaLibrary(prev => [...prev, ...newMedia]);
  };

  const autoPlaceClip = (mediaId, type, clipDuration) => {
    const targetType = type === 'audio' ? 'audio' : 'video';
    const candidateTracks = tracks.filter(t => t.type === targetType);
    if (!candidateTracks.length) return;
    let latestEnd = 0;
    tracks.forEach(t => t.clips.forEach(c => { if (c.end > latestEnd) latestEnd = c.end; }));
    const start = latestEnd;
    const end = start + clipDuration;
    const track = candidateTracks[0];
    const newClip = { id: uid(), mediaId, start, end, sourceStart: 0 };
    setTracks(prev => prev.map(t => t.id === track.id ? { ...t, clips: [...t.clips, newClip] } : t));
  };

  // ─── Track management ──────────────────────
  const addTrack = (type) => {
    setTracks(prev => [...prev, { id: uid(), type, muted: false, solo: false, clips: [] }]);
  };
  const removeTrack = (trackId) => {
    setTracks(prev => prev.filter(t => t.id !== trackId));
    if (selected?.trackId === trackId) setSelected(null);
  };
  const toggleMute = (trackId) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, muted: !t.muted } : t));
  };
  const toggleSolo = (trackId) => {
    setTracks(prev => {
      const newTracks = prev.map(t => t.id === trackId ? { ...t, solo: !t.solo } : t);
      const anySolo = newTracks.some(t => t.solo);
      return newTracks.map(t => ({ ...t, muted: anySolo ? !t.solo : t.muted }));
    });
  };

  const updateClip = (trackId, clipId, updates) => {
    setTracks(prev => prev.map(t => t.id === trackId ? {
      ...t, clips: t.clips.map(c => c.id === clipId ? { ...c, ...updates } : c)
    } : t));
  };

  const removeClip = (trackId, clipId) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, clips: t.clips.filter(c => c.id !== clipId) } : t));
    if (selected?.trackId === trackId && selected?.clipId === clipId) setSelected(null);
    closeContextMenu();
  };

  const splitClip = () => {
    if (!selected) return;
    const clip = getClip(selected.trackId, selected.clipId);
    if (!clip || playheadRef.current <= clip.start || playheadRef.current >= clip.end) return;
    const originalEnd = clip.end;
    updateClip(selected.trackId, selected.clipId, { end: playheadRef.current });
    const newClip = {
      id: uid(),
      mediaId: clip.mediaId,
      start: playheadRef.current,
      end: originalEnd,
      sourceStart: (clip.sourceStart || 0) + (playheadRef.current - clip.start)
    };
    setTracks(prev => prev.map(t => t.id === selected.trackId ? { ...t, clips: [...t.clips, newClip] } : t));
  };
  // components/VideoEditor.jsx (Part 2 of 2)

  // ─── Clip interaction on timeline ──────────
  const handleClipMouseDown = (e, trackId, clipId) => {
    e.stopPropagation();
    e.preventDefault();
    const clip = getClip(trackId, clipId);
    if (!clip) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origStart = clip.start;
    const origEnd = clip.end;
    const dur = origEnd - origStart;
    dragInfo.current = { type: 'move', trackId, clipId, origStart, origEnd, startX, startY, targetTrackId: null };
    const onMouseMove = (ev) => {
      if (!dragInfo.current) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const deltaTime = dx / pps;
      let newStart = Math.max(0, origStart + deltaTime);
      newStart = snapToGrid(newStart, clipId);
      const trackIndex = getTrackIndex(trackId);
      const newTrackIndex = clamp(Math.round(trackIndex + dy / TRACK_HEIGHT), 0, tracks.length - 1);
      const targetTrack = tracks[newTrackIndex];
      if (targetTrack && targetTrack.type === tracks.find(t => t.id === trackId).type) {
        dragInfo.current.targetTrackId = targetTrack.id;
      }
      updateClip(trackId, clipId, { start: newStart, end: newStart + dur });
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (dragInfo.current?.targetTrackId && dragInfo.current.targetTrackId !== trackId) {
        const { targetTrackId, clipId: cid } = dragInfo.current;
        const clip = getClip(trackId, cid);
        if (clip) {
          setTracks(prev => prev.map(t => {
            if (t.id === trackId) return { ...t, clips: t.clips.filter(c => c.id !== cid) };
            if (t.id === targetTrackId) return { ...t, clips: [...t.clips, clip] };
            return t;
          }));
        }
      }
      dragInfo.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleTrimStart = (e, trackId, clipId) => {
    e.stopPropagation();
    const clip = getClip(trackId, clipId);
    if (!clip) return;
    const startX = e.clientX;
    const origStart = clip.start;
    const origSourceStart = clip.sourceStart || 0;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const delta = dx / pps;
      let newStart = Math.max(0, origStart + delta);
      newStart = snapToGrid(newStart, clipId);
      if (newStart < clip.end) {
        const timeShift = newStart - origStart;
        updateClip(trackId, clipId, { start: newStart, sourceStart: origSourceStart + timeShift });
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleTrimEnd = (e, trackId, clipId) => {
    e.stopPropagation();
    const clip = getClip(trackId, clipId);
    if (!clip) return;
    const startX = e.clientX;
    const origEnd = clip.end;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const delta = dx / pps;
      let newEnd = Math.max(clip.start + 0.1, origEnd + delta);
      newEnd = snapToGrid(newEnd, clipId);
      updateClip(trackId, clipId, { end: newEnd });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ─── Per‑clip mute ─────────────────────────
  const toggleClipMute = (clipId) => {
    setClipMutedMap(prev => ({ ...prev, [clipId]: !prev[clipId] }));
    closeContextMenu();
  };

  // ─── Crop logic (source crop) ─────────────────
  const enterCropMode = () => {
    if (!selected) return;
    const clip = getClip(selected.trackId, selected.clipId);
    const media = clip && getMedia(clip.mediaId);
    if (!media || media.type === 'audio') return;
    const crop = appliedCropMap[clip.id] || { x: 0, y: 0, w: media.width, h: media.height };
    setCropRect(crop);
    setCropMode(true);
  };

  const applyCrop = () => {
    if (!selected) return;
    setAppliedCropMap(prev => ({ ...prev, [selected.clipId]: cropRect }));
    setAppliedTransformMap(prev => {
      const next = { ...prev };
      delete next[selected.clipId];
      return next;
    });
    setCropMode(false);
  };

  const cancelCrop = () => setCropMode(false);

  const resetCrop = () => {
    if (!selected) return;
    const clip = getClip(selected.trackId, selected.clipId);
    const media = clip && getMedia(clip.mediaId);
    if (!media || media.type === 'audio') return;
    const full = { x: 0, y: 0, w: media.width, h: media.height };
    setCropRect(full);
    setAppliedCropMap(prev => ({ ...prev, [clip.id]: full }));
    setAppliedTransformMap(prev => {
      const next = { ...prev };
      delete next[clip.id];
      return next;
    });
    setCropMode(false);
  };

  const updateCropFromInputs = () => {
    if (!selected || !cropRect) return;
    const clip = getClip(selected.trackId, selected.clipId);
    const media = clip && getMedia(clip.mediaId);
    if (!media) return;
    const x = clamp(cropRect.x, 0, media.width - 1);
    const y = clamp(cropRect.y, 0, media.height - 1);
    const w = clamp(cropRect.w, 10, media.width - x);
    const h = clamp(cropRect.h, 10, media.height - y);
    setCropRect({ x, y, w, h });
  };

  const applyPreset = (rw, rh) => {
    if (!selected) return;
    const clip = getClip(selected.trackId, selected.clipId);
    const media = clip && getMedia(clip.mediaId);
    if (!media) return;
    const mw = media.width, mh = media.height;
    let nw, nh;
    if (mw / mh > rw / rh) {
      nh = mh; nw = mh * (rw / rh);
    } else {
      nw = mw; nh = mw / (rw / rh);
    }
    const margin = 0.10;
    nw = Math.round(nw * (1 - margin * 2));
    nh = Math.round(nh * (1 - margin * 2));
    const nx = Math.round((mw - nw) / 2);
    const ny = Math.round((mh - nh) / 2);
    setCropRect({ x: nx, y: ny, w: nw, h: nh });
  };

  // ─── Transform per clip ────────────────────
  const getDefaultTransform = (srcWidth, srcHeight) => {
    if (!fitToFrame) {
      return {
        x: Math.round((exportWidth - srcWidth) / 2),
        y: Math.round((exportHeight - srcHeight) / 2),
        w: srcWidth, h: srcHeight,
      };
    }
    const srcAspect = srcWidth / srcHeight;
    const dstAspect = exportWidth / exportHeight;
    let drawWidth, drawHeight, drawX, drawY;
    if (srcAspect > dstAspect) {
      drawWidth = exportWidth; drawHeight = exportWidth / srcAspect;
      drawX = 0; drawY = (exportHeight - drawHeight) / 2;
    } else {
      drawHeight = exportHeight; drawWidth = exportHeight * srcAspect;
      drawY = 0; drawX = (exportWidth - drawWidth) / 2;
    }
    return { x: drawX, y: drawY, w: drawWidth, h: drawHeight };
  };

  const getClipTransform = (clipId, cropW, cropH) => {
    if (appliedTransformMap[clipId]) return appliedTransformMap[clipId];
    return getDefaultTransform(cropW, cropH);
  };

  const updateTransform = (clipId, transform) => {
    setAppliedTransformMap(prev => ({ ...prev, [clipId]: transform }));
  };

  // ─── Canvas mouse handlers (crop + transform) ──
  const handleCanvasMouseDown = (e) => {
    if (!selected) return;
    const clip = getClip(selected.trackId, selected.clipId);
    if (!clip) return;
    const media = getMedia(clip.mediaId);
    if (!media) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    if (cropMode) {
      if (!cropRect) return;
      const srcAspect = cropRect.w / cropRect.h;
      const dstAspect = canvas.width / canvas.height;
      let drawWidth, drawHeight, drawX, drawY;
      if (srcAspect > dstAspect) {
        drawWidth = canvas.width; drawHeight = canvas.width / srcAspect;
        drawX = 0; drawY = (canvas.height - drawHeight) / 2;
      } else {
        drawHeight = canvas.height; drawWidth = canvas.height * srcAspect;
        drawY = 0; drawX = (canvas.width - drawWidth) / 2;
      }
      const corners = [
        { x: drawX, y: drawY, key: 'tl' },
        { x: drawX + drawWidth, y: drawY, key: 'tr' },
        { x: drawX, y: drawY + drawHeight, key: 'bl' },
        { x: drawX + drawWidth, y: drawY + drawHeight, key: 'br' },
      ];
      const threshold = 15;
      for (const corner of corners) {
        if (Math.hypot(mouseX - corner.x, mouseY - corner.y) < threshold) {
          setCropDragActive({ corner: corner.key, startX: e.clientX, startY: e.clientY });
          return;
        }
      }
      if (mouseX >= drawX && mouseX <= drawX + drawWidth &&
          mouseY >= drawY && mouseY <= drawY + drawHeight) {
        setCropDragActive({ corner: 'move', startX: e.clientX, startY: e.clientY });
        return;
      }
    } else {
      const crop = appliedCropMap[clip.id] || { x: 0, y: 0, w: media.width, h: media.height };
      const transform = getClipTransform(clip.id, crop.w, crop.h);
      const corners = [
        { x: transform.x, y: transform.y, key: 'tl' },
        { x: transform.x + transform.w, y: transform.y, key: 'tr' },
        { x: transform.x, y: transform.y + transform.h, key: 'bl' },
        { x: transform.x + transform.w, y: transform.y + transform.h, key: 'br' },
      ];
      const threshold = 15;
      for (const corner of corners) {
        if (Math.hypot(mouseX - corner.x, mouseY - corner.y) < threshold) {
          setTransformDrag({ corner: corner.key, startX: e.clientX, startY: e.clientY });
          return;
        }
      }
      if (mouseX >= transform.x && mouseX <= transform.x + transform.w &&
          mouseY >= transform.y && mouseY <= transform.y + transform.h) {
        setTransformDrag({ corner: 'move', startX: e.clientX, startY: e.clientY });
      }
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (cropDragActive && cropMode && selected && cropRect) {
      const clip = getClip(selected.trackId, selected.clipId);
      const media = clip && getMedia(clip.mediaId);
      if (!media) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = media.width / canvas.width;
      const scaleY = media.height / canvas.height;
      const dx = (e.clientX - cropDragActive.startX) * scaleX;
      const dy = (e.clientY - cropDragActive.startY) * scaleY;
      let newRect = { ...cropRect };
      const corner = cropDragActive.corner;
      if (corner === 'tl') {
        newRect.x = clamp(cropRect.x + dx, 0, media.width - 10);
        newRect.y = clamp(cropRect.y + dy, 0, media.height - 10);
        newRect.w = cropRect.w - (newRect.x - cropRect.x);
        newRect.h = cropRect.h - (newRect.y - cropRect.y);
      } else if (corner === 'tr') {
        newRect.y = clamp(cropRect.y + dy, 0, media.height - 10);
        newRect.w = clamp(cropRect.w + dx, 10, media.width - newRect.x);
        newRect.h = cropRect.h - (newRect.y - cropRect.y);
      } else if (corner === 'bl') {
        newRect.x = clamp(cropRect.x + dx, 0, media.width - 10);
        newRect.w = cropRect.w - (newRect.x - cropRect.x);
        newRect.h = clamp(cropRect.h + dy, 10, media.height - newRect.y);
      } else if (corner === 'br') {
        newRect.w = clamp(cropRect.w + dx, 10, media.width - newRect.x);
        newRect.h = clamp(cropRect.h + dy, 10, media.height - newRect.y);
      } else if (corner === 'move') {
        newRect.x = clamp(cropRect.x + dx, 0, media.width - cropRect.w);
        newRect.y = clamp(cropRect.y + dy, 0, media.height - cropRect.h);
      }
      setCropRect(newRect);
      setCropDragActive({ ...cropDragActive, startX: e.clientX, startY: e.clientY });
    } else if (transformDrag && !cropMode && selected) {
      const clip = getClip(selected.trackId, selected.clipId);
      if (!clip) return;
      const crop = appliedCropMap[clip.id] || { x: 0, y: 0, w: getMedia(clip.mediaId)?.width || 1, h: getMedia(clip.mediaId)?.height || 1 };
      const transform = getClipTransform(clip.id, crop.w, crop.h);
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const dx = (e.clientX - transformDrag.startX) * (canvas.width / rect.width);
      const dy = (e.clientY - transformDrag.startY) * (canvas.height / rect.height);
      let newTransform = { ...transform };
      switch (transformDrag.corner) {
        case 'tl':
          newTransform.x = clamp(transform.x + dx, 0, exportWidth - 10);
          newTransform.y = clamp(transform.y + dy, 0, exportHeight - 10);
          newTransform.w = transform.w - (newTransform.x - transform.x);
          newTransform.h = transform.h - (newTransform.y - transform.y);
          break;
        case 'tr':
          newTransform.y = clamp(transform.y + dy, 0, exportHeight - 10);
          newTransform.w = clamp(transform.w + dx, 10, exportWidth - newTransform.x);
          newTransform.h = transform.h - (newTransform.y - transform.y);
          break;
        case 'bl':
          newTransform.x = clamp(transform.x + dx, 0, exportWidth - 10);
          newTransform.w = transform.w - (newTransform.x - transform.x);
          newTransform.h = clamp(transform.h + dy, 10, exportHeight - newTransform.y);
          break;
        case 'br':
          newTransform.w = clamp(transform.w + dx, 10, exportWidth - newTransform.x);
          newTransform.h = clamp(transform.h + dy, 10, exportHeight - newTransform.y);
          break;
        case 'move':
          newTransform.x = clamp(transform.x + dx, 0, exportWidth - transform.w);
          newTransform.y = clamp(transform.y + dy, 0, exportHeight - transform.h);
          break;
      }
      updateTransform(clip.id, newTransform);
      setTransformDrag({ ...transformDrag, startX: e.clientX, startY: e.clientY });
    }
  };

  const handleCanvasMouseUp = () => {
    setTransformDrag(null);
    setCropDragActive(null);
  };

  // ─── Audio effects ──────────────────────────
  useEffect(() => {
    if (selected) {
      const clip = getClip(selected.trackId, selected.clipId);
      const media = clip && getMedia(clip.mediaId);
      if (media && media.type === 'audio') {
        const eff = audioEffectsMap[clip.id] || { gain: 1, filterFreq: 1000 };
        setAudioGain(eff.gain);
        setAudioFilterFreq(eff.filterFreq);
      }
    }
  }, [selected, audioEffectsMap]);

  const applyAudioEffects = () => {
    if (!selected) return;
    const clipId = selected.clipId;
    setAudioEffectsMap(prev => ({ ...prev, [clipId]: { gain: audioGain, filterFreq: audioFilterFreq } }));
  };

  // ─── Audio scheduling ──────────────────────
  const stopAllAudio = useCallback(() => {
    activeAudioSourcesRef.current.forEach(src => { try { src.stop(); } catch(e) {} });
    activeAudioSourcesRef.current = [];
    if (scheduledAudioTimeoutRef.current) {
      clearTimeout(scheduledAudioTimeoutRef.current);
      scheduledAudioTimeoutRef.current = null;
    }
  }, []);

  const doSchedule = useCallback((ctx, startTime, destination) => {
    const now = ctx.currentTime;
    const playheadSec = startTime;
    const anySolo = tracks.some(t => t.solo);
    tracks.forEach(track => {
      if (track.muted) return;
      if (anySolo && !track.solo) return;
      track.clips.forEach(clip => {
        if (clipMutedMap[clip.id]) return;
        if (clip.end <= playheadSec) return;
        const media = getMedia(clip.mediaId);
        if (!media || !media.audioBuffer) return;
        const buffer = media.audioBuffer;
        const clipStart = clip.start;
        const clipEnd = clip.end;
        const sourceStart = clip.sourceStart || 0;
        const offset = sourceStart + Math.max(0, playheadSec - clipStart);
        const duration = Math.min(buffer.duration - offset, clipEnd - Math.max(playheadSec, clipStart));
        if (duration <= 0) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        let gainNode = ctx.createGain();
        if (media.type === 'audio' && audioEffectsMap[clip.id]) {
          gainNode.gain.value = audioEffectsMap[clip.id].gain || 1;
        }
        source.connect(gainNode);
        gainNode.connect(destination || ctx.destination);
        const delay = clipStart - playheadSec;
        if (delay < 0) {
          source.start(now, offset, duration);
        } else {
          source.start(now + delay, offset, duration);
        }
        activeAudioSourcesRef.current.push(source);
        source.onended = () => {
          activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter(s => s !== source);
        };
      });
    });
    const nextEventTime = tracks.reduce((minTime, track) => {
      track.clips.forEach(clip => {
        if (clip.start > playheadSec && clip.start < minTime) minTime = clip.start;
        if (clip.end > playheadSec && clip.end < minTime) minTime = clip.end;
      });
      return minTime;
    }, duration);
    if (nextEventTime > playheadSec && nextEventTime < duration) {
      scheduledAudioTimeoutRef.current = setTimeout(() => {
        scheduleAudioFromTime(playheadRef.current, destination);
      }, (nextEventTime - playheadSec) * 1000);
    }
  }, [tracks, getMedia, audioEffectsMap, stopAllAudio, clipMutedMap]);

  const scheduleAudioFromTime = useCallback((startTime, destination = null) => {
    const ctx = getAudioContext();
    stopAllAudio();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => doSchedule(ctx, startTime, destination));
    } else {
      doSchedule(ctx, startTime, destination);
    }
  }, [doSchedule, stopAllAudio]);

  // ─── Canvas drawing (NO MORE BLINKING) ─────
  const drawFrameOnCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, exportWidth, exportHeight);
    const currentTime = playheadRef.current;

    for (const track of tracks) {
      if (track.type !== 'video' || track.muted) continue;
      const anySolo = tracks.some(t => t.solo);
      if (anySolo && !track.solo) continue;
      const activeClip = track.clips.find(c => currentTime >= c.start && currentTime < c.end);
      if (!activeClip) continue;
      const media = getMedia(activeClip.mediaId);
      if (!media) continue;
      const localTime = currentTime - activeClip.start;
      const crop = appliedCropMap[activeClip.id] || { x: 0, y: 0, w: media.width, h: media.height };
      const transform = getClipTransform(activeClip.id, crop.w, crop.h);

      if (media.type === 'image') {
        const img = getMediaElement(activeClip.mediaId, 'image');
        if (img && img.complete) {
          ctx.filter = getFilterString();
          ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, transform.x, transform.y, transform.w, transform.h);
          ctx.filter = 'none';
        }
      } else if (media.type === 'video') {
        const video = getMediaElement(activeClip.mediaId, 'video');
        if (video && video.readyState >= 3) {
          const timeDiff = Math.abs(video.currentTime - localTime);
          if (timeDiff > 0.1) {
            // need to seek – use last good frame while seeking
            if (!seekingRef.current[activeClip.mediaId]) {
              seekingRef.current[activeClip.mediaId] = true;
              video.currentTime = localTime;
              video.addEventListener('seeked', () => {
                seekingRef.current[activeClip.mediaId] = false;
                // after seek, capture new good frame
                const offCanvas = document.createElement('canvas');
                offCanvas.width = crop.w;
                offCanvas.height = crop.h;
                const offCtx = offCanvas.getContext('2d');
                offCtx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
                frameCacheRef.current[activeClip.mediaId] = {
                  canvas: offCanvas,
                  crop: { ...crop },
                  transform: { ...transform },
                  time: localTime
                };
                lastGoodFrameRef.current[activeClip.mediaId] = offCanvas;
              }, { once: true });
            }
            // use the cached frame if available, else use last good frame
            const cached = frameCacheRef.current[activeClip.mediaId];
            const sourceCanvas = (cached && cached.canvas) ? cached.canvas : lastGoodFrameRef.current[activeClip.mediaId];
            if (sourceCanvas) {
              ctx.filter = getFilterString();
              ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, transform.x, transform.y, transform.w, transform.h);
              ctx.filter = 'none';
            }
            // if no fallback at all, just skip drawing this track (will be black)
          } else {
            // time is close enough – draw directly and update caches
            ctx.filter = getFilterString();
            ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, transform.x, transform.y, transform.w, transform.h);
            ctx.filter = 'none';
            const offCanvas = document.createElement('canvas');
            offCanvas.width = crop.w;
            offCanvas.height = crop.h;
            const offCtx = offCanvas.getContext('2d');
            offCtx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
            frameCacheRef.current[activeClip.mediaId] = {
              canvas: offCanvas,
              crop: { ...crop },
              transform: { ...transform },
              time: localTime
            };
            lastGoodFrameRef.current[activeClip.mediaId] = offCanvas;
          }
        }
      }
    }

    // Blue transform box (unchanged)
    if (selected && !cropMode) {
      const clip = getClip(selected.trackId, selected.clipId);
      if (clip) {
        const media = getMedia(clip.mediaId);
        if (media && media.type !== 'audio') {
          const crop = appliedCropMap[clip.id] || { x: 0, y: 0, w: media.width, h: media.height };
          const transform = getClipTransform(clip.id, crop.w, crop.h);
          ctx.strokeStyle = '#00f';
          ctx.lineWidth = 2;
          ctx.strokeRect(transform.x, transform.y, transform.w, transform.h);
          const hsize = 8;
          const corners = [
            [transform.x, transform.y],
            [transform.x + transform.w, transform.y],
            [transform.x, transform.y + transform.h],
            [transform.x + transform.w, transform.y + transform.h],
          ];
          ctx.fillStyle = '#0ff';
          corners.forEach(([cx, cy]) => ctx.fillRect(cx - hsize/2, cy - hsize/2, hsize, hsize));
        }
      }
    }

    // Green crop overlay (unchanged)
    if (cropMode && selected && cropRect) {
      const clip = getClip(selected.trackId, selected.clipId);
      const media = clip && getMedia(clip.mediaId);
      if (media && media.type !== 'audio') {
        const scaleX = exportWidth / media.width;
        const scaleY = exportHeight / media.height;
        const overlay = {
          x: cropRect.x * scaleX, y: cropRect.y * scaleY,
          w: cropRect.w * scaleX, h: cropRect.h * scaleY,
        };
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.strokeRect(overlay.x, overlay.y, overlay.w, overlay.h);
        const hsize = 8;
        const corners = [
          [overlay.x, overlay.y],
          [overlay.x + overlay.w, overlay.y],
          [overlay.x, overlay.y + overlay.h],
          [overlay.x + overlay.w, overlay.y + overlay.h],
        ];
        ctx.fillStyle = '#ff0';
        corners.forEach(([cx, cy]) => ctx.fillRect(cx - hsize/2, cy - hsize/2, hsize, hsize));
      }
    }
  }, [tracks, mediaLibrary, appliedCropMap, appliedTransformMap, cropMode, selected, cropRect, getFilterString, exportWidth, exportHeight, fitToFrame, getClipTransform]);

  const updatePlayheadLine = useCallback(() => {
    if (playheadLineRef.current) {
      playheadLineRef.current.style.left = `${playheadRef.current * pps}px`;
    }
  }, [pps]);

  // ─── Playback engine (unchanged, still pre‑buffers) ──
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const startPlayback = useCallback(async () => {
    if (isPlayingRef.current) return;
    if (!areAllMediaReady()) {
      alert('Some media is still loading. Please wait...');
      return;
    }
    const videoIds = new Set();
    tracks.filter(t => t.type === 'video').forEach(t => {
      t.clips.forEach(c => videoIds.add(c.mediaId));
    });
    const preloads = [];
    videoIds.forEach(mid => {
      const el = getMediaElement(mid, 'video');
      if (el && el.readyState < 3) {
        preloads.push(new Promise(resolve => {
          el.addEventListener('canplaythrough', resolve, { once: true });
          el.load();
        }));
      }
    });
    if (preloads.length > 0) {
      await Promise.all(preloads);
    }
    setIsPlaying(true);
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    scheduleAudioFromTime(playheadRef.current);
    const startTime = performance.now() - playheadRef.current * 1000;
    const tick = (now) => {
      if (!isPlayingRef.current) return;
      const elapsed = (now - startTime) / 1000;
      playheadRef.current = Math.min(elapsed, duration);
      drawFrameOnCanvas();
      updatePlayheadLine();
      if (now - lastUIUpdateRef.current > 100) {
        lastUIUpdateRef.current = now;
        setPlayhead(playheadRef.current);
      }
      if (elapsed < duration) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
        playheadRef.current = duration;
        setPlayhead(duration);
        drawFrameOnCanvas();
        updatePlayheadLine();
        stopAllAudio();
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, [duration, drawFrameOnCanvas, updatePlayheadLine, scheduleAudioFromTime, stopAllAudio, areAllMediaReady, tracks, getMediaElement]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    stopAllAudio();
  }, [stopAllAudio]);

  const togglePlay = () => { if (isPlaying) stopPlayback(); else startPlayback(); };

  const seekTo = (time) => {
    playheadRef.current = clamp(time, 0, duration);
    setPlayhead(playheadRef.current);
    Object.keys(seekingRef.current).forEach(key => { seekingRef.current[key] = false; });
    drawFrameOnCanvas();
    updatePlayheadLine();
    if (isPlayingRef.current) {
      scheduleAudioFromTime(playheadRef.current);
    }
  };

  const stop = () => { stopPlayback(); seekTo(0); };
  const rewind = () => { seekTo(playheadRef.current - 1); };
  const fastForward = () => { seekTo(playheadRef.current + 1); };

  useEffect(() => { drawFrameOnCanvas(); }, [drawFrameOnCanvas]);
  useEffect(() => {
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); stopAllAudio(); };
  }, [stopAllAudio]);

  // ─── Export (same non‑blinking logic) ──────
  const startExport = async () => {
    if (processing) return;
    if (!areAllMediaReady()) {
      alert('Some media is still loading. Please wait...');
      return;
    }
    setProcessing(true);
    setOutputUrl(null);
    setProgress(0);
    exportCancelRef.current = false;
    document.body.style.overflow = 'hidden';
    stopPlayback();

    const requiredMediaIds = new Set();
    tracks.forEach(t => t.clips.forEach(c => requiredMediaIds.add(c.mediaId)));
    const loadPromises = [];
    requiredMediaIds.forEach(mid => {
      const media = getMedia(mid);
      if (!media || media.type === 'audio') return;
      const el = getMediaElement(mid, media.type);
      if (media.type === 'video') {
        if (el.readyState < 3) {
          loadPromises.push(new Promise(resolve => {
            el.addEventListener('canplaythrough', resolve, { once: true });
            el.load();
          }));
        }
      } else if (media.type === 'image' && !el.complete) {
        loadPromises.push(new Promise(resolve => {
          el.onload = resolve;
          if (el.complete) resolve();
        }));
      }
    });
    await Promise.all(loadPromises);

    const totalFrames = Math.ceil(duration * FPS);
    setExportTotalFrames(totalFrames);
    setExportModalOpen(true);
    exportStartTimeRef.current = performance.now();

    const hiddenCanvas = document.createElement('canvas');
    hiddenCanvas.width = exportWidth;
    hiddenCanvas.height = exportHeight;
    hiddenCanvas.style.position = 'absolute';
    hiddenCanvas.style.left = '-9999px';
    hiddenCanvas.style.top = '-9999px';
    document.body.appendChild(hiddenCanvas);
    const hiddenCtx = hiddenCanvas.getContext('2d');

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const audioDestination = ctx.createMediaStreamDestination();
    scheduleAudioFromTime(0, audioDestination);

    const videoStream = hiddenCanvas.captureStream(FPS);
    const audioTrack = audioDestination.stream.getAudioTracks()[0];
    const combinedStream = new MediaStream([...videoStream.getVideoTracks(), audioTrack]);
    const chunks = [];
    const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      setOutputUrl(URL.createObjectURL(blob));
      setProcessing(false);
      document.body.removeChild(hiddenCanvas);
    };
    recorder.start();

    // Export drawing – same anti‑blink logic
    const drawExportFrame = (t) => {
      hiddenCtx.fillStyle = '#000';
      hiddenCtx.fillRect(0, 0, exportWidth, exportHeight);
      for (const track of tracks) {
        if (track.type !== 'video' || track.muted) continue;
        const anySolo = tracks.some(tr => tr.solo);
        if (anySolo && !track.solo) continue;
        const activeClip = track.clips.find(c => t >= c.start && t < c.end);
        if (!activeClip) continue;
        const media = getMedia(activeClip.mediaId);
        if (!media) continue;
        const localTime = t - activeClip.start;
        const crop = appliedCropMap[activeClip.id] || { x: 0, y: 0, w: media.width, h: media.height };
        const transform = getClipTransform(activeClip.id, crop.w, crop.h);

        if (media.type === 'image') {
          const img = getMediaElement(activeClip.mediaId, 'image');
          if (img && img.complete) {
            hiddenCtx.filter = getFilterString();
            hiddenCtx.drawImage(img, crop.x, crop.y, crop.w, crop.h, transform.x, transform.y, transform.w, transform.h);
            hiddenCtx.filter = 'none';
          }
        } else if (media.type === 'video') {
          const video = getMediaElement(activeClip.mediaId, 'video');
          if (video && video.readyState >= 3) {
            const timeDiff = Math.abs(video.currentTime - localTime);
            if (timeDiff > 0.1) {
              if (!seekingRef.current[activeClip.mediaId]) {
                seekingRef.current[activeClip.mediaId] = true;
                video.currentTime = localTime;
                video.addEventListener('seeked', () => {
                  seekingRef.current[activeClip.mediaId] = false;
                  const offCanvas = document.createElement('canvas');
                  offCanvas.width = crop.w;
                  offCanvas.height = crop.h;
                  const offCtx = offCanvas.getContext('2d');
                  offCtx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
                  frameCacheRef.current[activeClip.mediaId] = {
                    canvas: offCanvas,
                    crop: { ...crop },
                    transform: { ...transform },
                    time: localTime
                  };
                  lastGoodFrameRef.current[activeClip.mediaId] = offCanvas;
                }, { once: true });
              }
              const cached = frameCacheRef.current[activeClip.mediaId];
              const sourceCanvas = (cached && cached.canvas) ? cached.canvas : lastGoodFrameRef.current[activeClip.mediaId];
              if (sourceCanvas) {
                hiddenCtx.filter = getFilterString();
                hiddenCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, transform.x, transform.y, transform.w, transform.h);
                hiddenCtx.filter = 'none';
              }
            } else {
              hiddenCtx.filter = getFilterString();
              hiddenCtx.drawImage(video, crop.x, crop.y, crop.w, crop.h, transform.x, transform.y, transform.w, transform.h);
              hiddenCtx.filter = 'none';
              const offCanvas = document.createElement('canvas');
              offCanvas.width = crop.w;
              offCanvas.height = crop.h;
              const offCtx = offCanvas.getContext('2d');
              offCtx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
              frameCacheRef.current[activeClip.mediaId] = {
                canvas: offCanvas,
                crop: { ...crop },
                transform: { ...transform },
                time: localTime
              };
              lastGoodFrameRef.current[activeClip.mediaId] = offCanvas;
            }
          }
        }
      }
    };

    const FRAME_INTERVAL = 1000 / FPS;
    let frameIndex = 0;

    const exportInterval = setInterval(() => {
      if (exportCancelRef.current) {
        clearInterval(exportInterval);
        recorder.stop();
        stopAllAudio();
        return;
      }
      const elapsed = (performance.now() - exportStartTimeRef.current) / 1000;
      const t = Math.min(elapsed, duration);
      playheadRef.current = t;
      drawExportFrame(t);
      frameIndex++;
      const percent = Math.min((frameIndex / totalFrames) * 100, 100);
      setProgress(percent);
      setExportElapsed(elapsed);
      if (t >= duration) {
        clearInterval(exportInterval);
        setTimeout(() => {
          recorder.stop();
          stopAllAudio();
          setProgress(100);
        }, FRAME_INTERVAL * 2);
      }
    }, FRAME_INTERVAL);

    exportIntervalRef.current = exportInterval;
  };

  const cancelExport = () => {
    exportCancelRef.current = true;
    if (exportIntervalRef.current) {
      clearInterval(exportIntervalRef.current);
      exportIntervalRef.current = null;
    }
  };

  const closeExportModal = () => {
    setExportModalOpen(false);
    setProcessing(false);
    document.body.style.overflow = '';
  };

  // ─── Drag & drop from library ──────────────
  const handleTimelineDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleTimelineDrop = (e) => {
    e.preventDefault();
    const mediaId = parseInt(e.dataTransfer.getData('application/x-media-id'), 10);
    if (!mediaId) return;
    const media = getMedia(mediaId);
    if (!media) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (timelineScrollRef.current?.scrollLeft || 0);
    const y = e.clientY - rect.top + (timelineScrollRef.current?.scrollTop || 0) - TIME_RULER_HEIGHT;
    const dropTime = x / pps;
    const trackIndex = Math.floor(y / TRACK_HEIGHT);
    if (trackIndex < 0 || trackIndex >= tracks.length) return;
    const targetTrack = tracks[trackIndex];
    if (targetTrack.type !== media.type && !(targetTrack.type === 'video' && media.type === 'image')) return;
    const clipDuration = media.duration || 5;
    const start = snapToGrid(dropTime);
    const newClip = { id: uid(), mediaId: media.id, start, end: start + clipDuration, sourceStart: 0 };
    setTracks(prev => prev.map(t => t.id === targetTrack.id ? { ...t, clips: [...t.clips, newClip] } : t));
  };

  const handleMediaDragStart = (e, media) => {
    e.dataTransfer.setData('application/x-media-id', media.id.toString());
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleClipContextMenu = (e, trackId, clipId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, trackId, clipId });
  };
  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    const handleClickOutside = () => closeContextMenu();
    if (contextMenu) window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [contextMenu]);

  const handleReplaceMedia = (file) => {
    if (!file || !contextMenu) return;
    const { trackId, clipId } = contextMenu;
    const clip = getClip(trackId, clipId);
    if (!clip) return;
    const oldMedia = getMedia(clip.mediaId);
    if (oldMedia && oldMedia.url) URL.revokeObjectURL(oldMedia.url);
    const id = uid();
    const url = URL.createObjectURL(file);
    const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image';
    const newMedia = { id, type, url, file, duration: 0, width: 0, height: 0, waveform: null, audioBuffer: null, ready: false };
    setMediaLibrary(prev => [...prev, newMedia]);
    updateClip(trackId, clipId, { mediaId: id, sourceStart: 0 });
    if (type === 'video' || type === 'audio') {
      const el = document.createElement(type);
      el.src = url;
      el.preload = 'auto';
      el.onloadedmetadata = () => {
        const dur = el.duration || 5;
        setMediaLibrary(prev => prev.map(m => m.id === id ? { ...m, duration: dur, width: type === 'video' ? el.videoWidth : 0, height: type === 'video' ? el.videoHeight : 0 } : m));
        const clip = getClip(trackId, clipId);
        if (clip) { const newEnd = Math.min(clip.start + dur, clip.end); updateClip(trackId, clipId, { end: newEnd }); }
      };
      el.addEventListener('canplaythrough', () => {
        setMediaLibrary(prev => prev.map(m => m.id === id ? { ...m, ready: true } : m));
      }, { once: true });
      decodeAudioForMedia(id, url).then(buffer => {
        setMediaLibrary(prev => prev.map(m => m.id === id ? { ...m, audioBuffer: buffer } : m));
      }).catch(() => {});
    } else {
      const dur = 5;
      const img = new Image();
      img.src = url;
      img.onload = () => setMediaLibrary(prev => prev.map(m => m.id === id ? { ...m, duration: dur, width: img.width, height: img.height, ready: true } : m));
      img.onerror = () => setMediaLibrary(prev => prev.map(m => m.id === id ? { ...m, duration: dur, width: 100, height: 100, ready: true } : m));
    }
    closeContextMenu();
  };

  const timelineWidth = Math.max(duration * pps + 200, 800);
  const extendedTimelineWidth = Math.max(timelineWidth, (duration + 10) * pps + 200);
  const timelineHeight = tracks.length * TRACK_HEIGHT + TIME_RULER_HEIGHT;

  // ─── JSX (unchanged) ─────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-900 text-white" onContextMenu={(e) => e.preventDefault()}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-800 border-b border-gray-700">
        <input ref={fileInputRef} type="file" accept="video/*,image/*,audio/*" multiple onChange={handleMediaUpload} className="hidden" />
        <button onClick={() => fileInputRef.current.click()} className="px-3 py-1 bg-blue-600 rounded text-sm">Add Media</button>

        <select value={selectedAspect} onChange={e => setSelectedAspect(e.target.value)} className="bg-gray-700 rounded px-2 py-1 text-sm">
          {Object.keys(ASPECT_RATIOS).map(key => (
            <option key={key} value={key}>{key}</option>
          ))}
        </select>

        <select value={filter} onChange={e => setFilter(e.target.value)} className="bg-gray-700 rounded px-2 py-1 text-sm">
          <option value="none">No Filter</option>
          <option value="grayscale">Grayscale</option>
          <option value="sepia">Sepia</option>
          <option value="invert">Invert</option>
        </select>

        <label className="flex items-center gap-1 text-xs ml-2">
          <input type="checkbox" checked={fitToFrame} onChange={e => setFitToFrame(e.target.checked)} />
          Fit to frame
        </label>

        <div className="flex gap-2 ml-auto">
          {!cropMode && <button onClick={enterCropMode} disabled={!selected} className="px-3 py-1 bg-gray-600 rounded text-sm disabled:opacity-50">✂ Crop</button>}
          {cropMode && <button onClick={applyCrop} className="px-3 py-1 bg-green-600 rounded text-sm">Apply Crop</button>}
          {cropMode && <button onClick={cancelCrop} className="px-3 py-1 bg-red-600 rounded text-sm">Cancel</button>}
          <button onClick={resetCrop} disabled={!selected} className="px-3 py-1 bg-gray-600 rounded text-sm disabled:opacity-50">Reset Crop</button>
          <button onClick={splitClip} disabled={!selected} className="px-3 py-1 bg-gray-600 rounded text-sm disabled:opacity-50">Split</button>
        </div>
        <button onClick={startExport} disabled={processing} className="px-4 py-2 bg-yellow-600 rounded text-sm">
          {processing ? `Exporting ${progress.toFixed(0)}%` : 'Export'}
        </button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-48 bg-gray-800 border-r border-gray-700 p-2 overflow-y-auto flex flex-col gap-2">
          <h3 className="text-xs font-bold text-gray-400 mb-1">Media Library</h3>
          {mediaLibrary.map(media => (
            <div key={media.id}
                 className={`bg-gray-700 p-1 rounded cursor-pointer hover:bg-gray-600 text-xs truncate ${!media.ready ? 'opacity-60' : ''}`}
                 draggable={media.ready}
                 onDragStart={media.ready ? (e) => handleMediaDragStart(e, media) : undefined}>
              {!media.ready && <span className="mr-1 inline-block">⏳</span>}
              {media.type === 'video' && '🎬 '}{media.type === 'audio' && '🔊 '}{media.type === 'image' && '🖼 '}
              {media.file?.name || 'Media'}
            </div>
          ))}
          <button onClick={() => fileInputRef.current.click()} className="mt-2 px-2 py-1 bg-blue-600 rounded text-xs">+ Add Media</button>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex items-center justify-center bg-black relative min-h-0"
               onMouseDown={handleCanvasMouseDown} onMouseMove={handleCanvasMouseMove} onMouseUp={handleCanvasMouseUp} onMouseLeave={handleCanvasMouseUp}>
            <canvas ref={canvasRef} className="max-w-full max-h-full object-contain" />
            {selected && !cropMode && <div className="absolute top-2 left-2 bg-blue-500 text-white p-2 rounded text-xs">Drag blue corners to move / resize</div>}
            {cropMode && <div className="absolute top-2 left-2 bg-yellow-500 text-black p-2 rounded text-xs">Drag green corners to crop</div>}
          </div>

          {cropMode && selected && (
            <div className="bg-gray-800 p-2 flex flex-wrap gap-2 items-center text-xs border-t border-gray-700">
              <label>X <input type="number" value={cropRect?.x || 0} onChange={e => setCropRect(prev => ({ ...prev, x: +e.target.value }))} onBlur={updateCropFromInputs} className="w-16 bg-gray-700 p-1 rounded" /></label>
              <label>Y <input type="number" value={cropRect?.y || 0} onChange={e => setCropRect(prev => ({ ...prev, y: +e.target.value }))} onBlur={updateCropFromInputs} className="w-16 bg-gray-700 p-1 rounded" /></label>
              <label>W <input type="number" value={cropRect?.w || 0} onChange={e => setCropRect(prev => ({ ...prev, w: +e.target.value }))} onBlur={updateCropFromInputs} className="w-16 bg-gray-700 p-1 rounded" /></label>
              <label>H <input type="number" value={cropRect?.h || 0} onChange={e => setCropRect(prev => ({ ...prev, h: +e.target.value }))} onBlur={updateCropFromInputs} className="w-16 bg-gray-700 p-1 rounded" /></label>
              <button onClick={updateCropFromInputs} className="px-2 py-1 bg-blue-600 rounded">Apply</button>
              <div className="flex gap-1 ml-4">
                {[[16,9],[4,3],[1,1],[9,16],[21,9]].map(([w,h]) => (
                  <button key={`${w}-${h}`} onClick={() => applyPreset(w,h)} className="px-2 py-1 bg-gray-600 rounded">{w}:{h}</button>
                ))}
              </div>
            </div>
          )}

          {selected && tracks.find(t => t.id === selected.trackId)?.type === 'audio' && (
            <div className="bg-gray-800 p-2 flex flex-wrap gap-3 items-center text-xs border-t border-gray-700">
              <label>Gain: <input type="range" min={0} max={2} step={0.1} value={audioGain} onChange={e => setAudioGain(+e.target.value)} /><span className="ml-1">{audioGain.toFixed(1)}</span></label>
              <label>Lowpass Hz: <input type="range" min={20} max={8000} step={1} value={audioFilterFreq} onChange={e => setAudioFilterFreq(+e.target.value)} /><span className="ml-1">{audioFilterFreq}</span></label>
              <button onClick={applyAudioEffects} className="px-2 py-1 bg-blue-600 rounded">Apply</button>
            </div>
          )}
        </div>
      </div>

      {/* Transport + zoom */}
      <div className="flex items-center gap-3 p-2 bg-gray-800 border-t border-gray-700 flex-wrap">
        <button onClick={stop} className="px-3 py-1 bg-gray-600 rounded text-sm">⏹</button>
        <button onClick={rewind} className="px-3 py-1 bg-gray-600 rounded text-sm">⏪</button>
        <button onClick={togglePlay} className="px-3 py-1 bg-blue-600 rounded text-sm">{isPlaying ? '⏸' : '▶'}</button>
        <button onClick={fastForward} className="px-3 py-1 bg-gray-600 rounded text-sm">⏩</button>
        <span className="text-sm">{playhead.toFixed(1)}s / {duration.toFixed(1)}s</span>
        <input type="range" min={0} max={duration || 0} step={0.01} value={playhead} onChange={e => seekTo(+e.target.value)} className="flex-1" />

        <div className="flex items-center gap-2 ml-4">
          <span className="text-xs text-gray-400">Zoom:</span>
          <button onClick={() => setPps(clamp(pps - 20, MIN_PPS, MAX_PPS))} className="px-2 py-1 bg-gray-600 rounded">−</button>
          <input type="range" min={MIN_PPS} max={MAX_PPS} value={pps} onChange={e => setPps(+e.target.value)} className="w-24" />
          <button onClick={() => setPps(clamp(pps + 20, MIN_PPS, MAX_PPS))} className="px-2 py-1 bg-gray-600 rounded">+</button>
          <span className="text-xs text-gray-400">{pps}px/s</span>
        </div>

        <label className="flex items-center gap-1 text-xs ml-4"><input type="checkbox" checked={snapEnabled} onChange={e => setSnapEnabled(e.target.checked)} /> Snap</label>

        <button onClick={() => addTrack('video')} className="px-2 py-1 bg-gray-600 rounded text-xs ml-auto">+ Video Track</button>
        <button onClick={() => addTrack('audio')} className="px-2 py-1 bg-gray-600 rounded text-xs">+ Audio Track</button>
      </div>

      {/* Timeline */}
      <div className="h-56 overflow-auto bg-gray-800 border-t border-gray-700 select-none" ref={timelineScrollRef}
        onDragOver={handleTimelineDragOver} onDrop={handleTimelineDrop} onContextMenu={(e) => e.preventDefault()}>
        <div className="relative" style={{ width: `${extendedTimelineWidth}px`, height: `${timelineHeight}px` }}>
          <div className="absolute top-0 left-0 right-0 bg-gray-700 border-b border-gray-600 flex items-end" style={{ height: TIME_RULER_HEIGHT }}
            onMouseDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const scrollLeft = timelineScrollRef.current?.scrollLeft || 0;
              const x = e.clientX - rect.left + scrollLeft;
              const time = x / pps;
              seekTo(time);
            }}>
            {Array.from({ length: Math.ceil(extendedTimelineWidth / pps) || 1 }).map((_, i) => (
              <div key={i} className="absolute h-full border-l border-gray-500" style={{ left: `${i * pps}px` }}>
                <span className="text-xs text-gray-400 ml-1">{i}s</span>
              </div>
            ))}
            <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10" ref={playheadLineRef}
              style={{ left: `${playhead * pps}px`, pointerEvents: 'none' }} />
          </div>

          {tracks.map((track, idx) => (
            <div key={track.id} className="absolute left-0 right-0 border-b border-gray-600"
              style={{ top: `${TIME_RULER_HEIGHT + idx * TRACK_HEIGHT}px`, height: TRACK_HEIGHT }}>
              <div className="absolute left-0 top-0 h-full bg-gray-700 flex flex-col items-center justify-center gap-1 text-xs text-gray-400 border-r border-gray-600"
                style={{ width: TRACK_LABEL_WIDTH }}>
                <span className="uppercase">{track.type}</span>
                <div className="flex gap-1">
                  <button onClick={() => toggleMute(track.id)} className={`px-1 rounded ${track.muted ? 'bg-red-600' : 'bg-gray-500'}`} title="Mute">M</button>
                  <button onClick={() => toggleSolo(track.id)} className={`px-1 rounded ${track.solo ? 'bg-yellow-600' : 'bg-gray-500'}`} title="Solo">S</button>
                  <button onClick={() => removeTrack(track.id)} className="px-1 bg-gray-500 rounded" title="Delete track">×</button>
                </div>
              </div>
              <div className="ml-20 h-full relative" style={{ marginLeft: TRACK_LABEL_WIDTH }}>
                {track.clips.map(clip => {
                  const media = getMedia(clip.mediaId);
                  const isSelected = selected?.trackId === track.id && selected?.clipId === clip.id;
                  return (
                    <ClipItem key={clip.id} clip={clip} trackId={track.id} trackType={track.type} isSelected={isSelected}
                      pps={pps} media={media} getThumbnail={getThumbnailStrip}
                      onMouseDown={(e) => handleClipMouseDown(e, track.id, clip.id)}
                      onTrimStart={(e) => handleTrimStart(e, track.id, clip.id)}
                      onTrimEnd={(e) => handleTrimEnd(e, track.id, clip.id)}
                      onClick={() => setSelected({ trackId: track.id, clipId: clip.id })}
                      onContextMenu={(e) => handleClipContextMenu(e, track.id, clip.id)}
                      onRemove={() => removeClip(track.id, clip.id)} />
                  );
                })}
              </div>
            </div>
          ))}
          <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
            style={{ left: `${playhead * pps}px` }} />
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed bg-gray-800 border border-gray-600 rounded shadow-lg z-50 py-1 min-w-[120px]"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}>
          <button className="block w-full text-left px-3 py-1 text-sm hover:bg-gray-700 text-white"
            onClick={() => removeClip(contextMenu.trackId, contextMenu.clipId)}>🗑 Delete</button>
          <label className="block w-full text-left px-3 py-1 text-sm hover:bg-gray-700 text-white cursor-pointer">
            📁 Replace
            <input type="file" accept="video/*,image/*" className="hidden"
              onChange={(e) => { if (e.target.files[0]) handleReplaceMedia(e.target.files[0]); }}
              ref={replaceInputRef} />
          </label>
          <button
            className="block w-full text-left px-3 py-1 text-sm hover:bg-gray-700 text-white"
            onClick={() => toggleClipMute(contextMenu.clipId)}
          >
            {clipMutedMap[contextMenu.clipId] ? '🔇 Unmute' : '🔊 Mute'}
          </button>
        </div>
      )}

      {/* Export Modal */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70">
          <div className="bg-gray-800 rounded-lg p-6 w-96 shadow-2xl border border-gray-600">
            <h2 className="text-lg font-bold mb-4 text-white">
              {processing ? 'Exporting Video' : outputUrl ? 'Export Complete' : 'Export Cancelled'}
            </h2>
            {processing && (
              <>
                <div className="w-full bg-gray-700 rounded-full h-4 mb-2 overflow-hidden">
                  <div className="bg-blue-500 h-full transition-all duration-100" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between text-sm text-gray-300 mb-2">
                  <span>{progress.toFixed(0)}%</span>
                  <span>{exportTotalFrames > 0 && progress > 0 ? `Remaining: ${((exportElapsed / (progress / 100)) - exportElapsed).toFixed(0)}s` : 'Calculating...'}</span>
                </div>
                <button onClick={cancelExport} className="w-full px-4 py-2 bg-red-600 rounded text-sm font-medium mt-3">Stop Export</button>
              </>
            )}
            {!processing && outputUrl && (
              <div className="flex flex-col gap-3">
                <p className="text-green-400 text-sm">Export finished successfully!</p>
                <a href={outputUrl} download="output.webm" className="px-4 py-2 bg-green-600 rounded text-sm text-center font-medium hover:bg-green-700">Download Video</a>
                <button onClick={closeExportModal} className="px-4 py-2 bg-gray-600 rounded text-sm">Close</button>
              </div>
            )}
            {!processing && !outputUrl && (
              <div className="flex flex-col gap-3">
                <p className="text-yellow-400 text-sm">Export was cancelled.</p>
                <button onClick={closeExportModal} className="px-4 py-2 bg-gray-600 rounded text-sm">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ClipItem component (unchanged) ──────────
function ClipItem({ clip, trackId, trackType, isSelected, pps, media, getThumbnail, onMouseDown, onTrimStart, onTrimEnd, onClick, onContextMenu, onRemove }) {
  const [thumbUrl, setThumbUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (trackType === 'video' || (media?.type === 'image')) {
      getThumbnail(clip.mediaId, clip.end - clip.start).then(url => { if (!cancelled) setThumbUrl(url); });
    }
    return () => { cancelled = true; };
  }, [clip.mediaId, clip.end, clip.start, trackType, media?.type, getThumbnail]);

  const left = clip.start * pps;
  const width = (clip.end - clip.start) * pps;
  return (
    <div className={`absolute top-1 h-10 rounded flex items-center overflow-hidden text-xs cursor-pointer border ${isSelected ? 'bg-blue-600 border-blue-400' : 'bg-gray-600 border-gray-500'}`}
      style={{ left: `${left}px`, width: `${width}px` }}
      onClick={onClick} onMouseDown={onMouseDown} onContextMenu={onContextMenu}>
      <div className="absolute left-0 top-0 w-2 h-full cursor-col-resize bg-white/20 hover:bg-white/50 z-10" onMouseDown={onTrimStart} />
      <div className="absolute right-0 top-0 w-2 h-full cursor-col-resize bg-white/20 hover:bg-white/50 z-10" onMouseDown={onTrimEnd} />
      {media && !media.ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-xs z-10">Loading...</div>
      )}
      {trackType === 'audio' && media?.waveform ? (
        <AudioWaveform waveformData={media.waveform} width={width} height={TRACK_HEIGHT - 8} />
      ) : thumbUrl ? (
        <img src={thumbUrl} alt="" className="w-full h-full object-cover opacity-80" style={{ pointerEvents: 'none' }} />
      ) : (
        <span className="truncate px-1">{media?.file?.name || 'clip'}</span>
      )}
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute top-0 right-0 text-red-400 hover:text-red-300 text-lg leading-none z-20">&times;</button>
    </div>
  );
}

// Audio waveform component (unchanged)
function AudioWaveform({ waveformData, width, height }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData) return;
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    const step = Math.ceil(waveformData.length / width);
    for (let i = 0; i < width; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const idx = i * step + j;
        if (idx < waveformData.length) {
          const val = waveformData[idx];
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
      const y1 = ((min + 1) / 2) * height;
      const y2 = ((max + 1) / 2) * height;
      ctx.moveTo(i, y1);
      ctx.lineTo(i, y2);
    }
    ctx.strokeStyle = '#00ff00';
    ctx.stroke();
  }, [waveformData, width, height]);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ width: '100%', height: '100%' }} />;
}