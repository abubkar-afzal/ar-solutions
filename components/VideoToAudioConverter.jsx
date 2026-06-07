// components/VideoToAudioConverter.jsx
import { useState, useRef, useEffect } from 'react';

export default function VideoToAudioConverter() {
  const [videoSrc, setVideoSrc] = useState(null);
  const [outputUrl, setOutputUrl] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [videoReady, setVideoReady] = useState(false);

  const videoRef = useRef(null);
  const recorderRef = useRef(null);

  // Clean object URL on unmount
  useEffect(() => {
    return () => {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
    };
  }, [videoSrc]);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setOutputUrl(null);
    setError(null);
    setProcessing(false);
    setVideoReady(false);
  };

  const handleLoadedMetadata = () => {
    setVideoReady(true);
    setError(null);
  };

  const startExtraction = async () => {
    const video = videoRef.current;
    if (!video || !videoReady) {
      setError('Video not ready. Please wait or re‑upload.');
      return;
    }

    // Check for audio track
    if (!video.captureStream) {
      setError('Your browser does not support captureStream.');
      return;
    }

    setProcessing(true);
    setError(null);
    setOutputUrl(null);

    try {
      const stream = video.captureStream();
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error('No audio track found in this video.');
      }

      const audioStream = new MediaStream([audioTrack]);
      const recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
      recorderRef.current = recorder;
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setOutputUrl(URL.createObjectURL(blob));
        setProcessing(false);
        video.pause();
        recorderRef.current = null;
      };

      recorder.onerror = (err) => {
        setError('Recorder error: ' + err.message);
        setProcessing(false);
        video.pause();
        recorderRef.current = null;
      };

      recorder.start();
      video.currentTime = 0;
      video.play();

      // Stop when video ends
      const onEnded = () => {
        if (recorder.state === 'recording') recorder.stop();
        video.removeEventListener('ended', onEnded);
      };
      video.addEventListener('ended', onEnded);

      // Also handle pause/error during playback
      const onPause = () => {
        if (processing && recorder.state === 'recording') {
          // If paused manually, we stop extraction
          recorder.stop();
        }
      };
      video.addEventListener('pause', onPause);

      // Cleanup listeners on stop
      const cleanup = () => {
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('pause', onPause);
      };
      recorder.addEventListener('stop', cleanup, { once: true });
    } catch (err) {
      setError('Failed to start extraction: ' + err.message);
      setProcessing(false);
    }
  };

  const stopExtraction = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  return (
    <div className="p-6 flex flex-col items-center gap-4">
      <h2 className="text-xl font-bold text-primary">🎵 Video to Audio Converter</h2>
      <input type="file" accept="video/*" onChange={handleFile} className="mb-4" />

      {videoSrc && (
        <>
          <video
            ref={videoRef}
            src={videoSrc}
            className="hidden"
            onLoadedMetadata={handleLoadedMetadata}
            controls={false}
          />
          {!videoReady && <p className="text-muted">Loading video metadata…</p>}
          {videoReady && !processing && (
            <p className="text-muted">Video ready. Click "Extract Audio" to begin.</p>
          )}

          <div className="flex gap-4">
            <button
              onClick={startExtraction}
              disabled={!videoReady || processing}
              className="px-6 py-3 bg-primary text-white rounded-xl disabled:opacity-50"
            >
              {processing ? 'Extracting Audio...' : 'Extract Audio'}
            </button>
            {processing && (
              <button onClick={stopExtraction} className="px-4 py-2 bg-red-600 text-white rounded-xl">
                ⏹ Stop
              </button>
            )}
          </div>

          {error && <div className="bg-red-900/80 text-white p-3 rounded-xl max-w-xl text-center">⚠️ {error}</div>}

          {outputUrl && (
            <div className="flex flex-col items-center gap-2 w-full max-w-xl">
              <audio controls src={outputUrl} className="w-full" />
              <a href={outputUrl} download="extracted_audio.webm" className="text-accent underline">
                ⬇ Download Audio (.webm)
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}