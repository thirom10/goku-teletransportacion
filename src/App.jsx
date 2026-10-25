import { useCallback, useEffect, useRef, useState } from 'react';
import { useCamera } from './hooks/useCamera.js';
import { calibrateBackground } from './utils/backgroundCalibration.js';
import {
  CompositorService,
  MASK_STALE_MS,
  extractPersonMask,
} from './services/compositorService.js';
import {
  createFaceLandmarker,
  createHandLandmarker,
  createImageSegmenter,
  formatVisionError,
} from './services/visionService.js';
import { GESTURE_STATES, GestureService, hasTwoFingerPose } from './services/gestureService.js';
import CameraPanel from './components/CameraPanel.jsx';
import CalibrationPanel from './components/CalibrationPanel.jsx';
import VisibilityPanel from './components/VisibilityPanel.jsx';
import GesturePanel from './components/GesturePanel.jsx';
import PreviewGrid from './components/PreviewGrid.jsx';
import StatusGrid from './components/StatusGrid.jsx';

const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;
const SEGMENT_INTERVAL_MS = 180;
const GESTURE_INTERVAL_MS = 160;
const DEFAULT_TRANSITION_MS = 360;

const visualParams = {
  blurRadius: 3,
  maskThreshold: 0.3,
  maskSoftness: 0.35,
};

function easeInOut(value) {
  return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
}

function setStatusIfChanged(ref, setter, value) {
  if (ref.current !== value) {
    ref.current = value;
    setter(value);
  }
}

function closeTask(task) {
  if (typeof task?.close === 'function') {
    task.close();
  }
}

export default function App() {
  const videoRef = useRef(null);
  const processedCanvasRef = useRef(null);
  const frameCanvasRef = useRef(null);
  const compositorRef = useRef(null);
  const segmenterRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const gestureServiceRef = useRef(new GestureService());
  const latestMaskRef = useRef(null);
  const backgroundRef = useRef(null);
  const transitionRef = useRef({ from: 0, to: 0, startedAt: 0, duration: DEFAULT_TRANSITION_MS });
  const isInvisibleRef = useRef(false);
  const gestureEnabledRef = useRef(false);
  const calibrationAbortRef = useRef(null);
  const segmentationStatusRef = useRef('Cargando modelo de segmentación...');
  const gestureStatusRef = useRef(GESTURE_STATES.DISABLED);
  const gestureDetailRef = useRef('');
  const fpsWindowRef = useRef({ frames: 0, startedAt: performance.now() });

  const camera = useCamera(videoRef);
  const [segmentationReady, setSegmentationReady] = useState(false);
  const [segmentationStatus, setSegmentationStatus] = useState('Cargando modelo de segmentación...');
  const [gestureReady, setGestureReady] = useState(false);
  const [gestureLoading, setGestureLoading] = useState(false);
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [gestureStatus, setGestureStatus] = useState(GESTURE_STATES.DISABLED);
  const [gestureDetail, setGestureDetail] = useState('');
  const [backgroundImage, setBackgroundImage] = useState(null);
  const [calibrationStatus, setCalibrationStatus] = useState('Fondo no calibrado.');
  const [calibrationCountdown, setCalibrationCountdown] = useState(null);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isInvisible, setIsInvisible] = useState(false);
  const [transitionDuration, setTransitionDuration] = useState(DEFAULT_TRANSITION_MS);
  const [fps, setFps] = useState(0);
  const [appError, setAppError] = useState('');

  useEffect(() => {
    backgroundRef.current = backgroundImage;
  }, [backgroundImage]);

  useEffect(() => {
    gestureEnabledRef.current = gestureEnabled;
  }, [gestureEnabled]);

  useEffect(() => {
    isInvisibleRef.current = isInvisible;
  }, [isInvisible]);

  useEffect(() => {
    compositorRef.current = new CompositorService(FRAME_WIDTH, FRAME_HEIGHT);
    frameCanvasRef.current = document.createElement('canvas');
    frameCanvasRef.current.width = FRAME_WIDTH;
    frameCanvasRef.current.height = FRAME_HEIGHT;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSegmenter() {
      try {
        const segmenter = await createImageSegmenter();

        if (cancelled) {
          closeTask(segmenter);
          return;
        }

        segmenterRef.current = segmenter;
        setSegmentationReady(true);
        setStatusIfChanged(segmentationStatusRef, setSegmentationStatus, 'Segmentación lista.');
      } catch (error) {
        if (!cancelled) {
          setSegmentationReady(false);
          setStatusIfChanged(
            segmentationStatusRef,
            setSegmentationStatus,
            `Segmentación no disponible: ${formatVisionError(error)}`,
          );
        }
      }
    }

    loadSegmenter();

    return () => {
      cancelled = true;
      closeTask(segmenterRef.current);
      segmenterRef.current = null;
    };
  }, []);

  const getInvisibleProgress = useCallback((now) => {
    const transition = transitionRef.current;

    if (transition.from === transition.to) {
      return transition.to;
    }

    const progress = Math.min(1, (now - transition.startedAt) / transition.duration);
    const eased = easeInOut(progress);
    const value = transition.from + (transition.to - transition.from) * eased;

    if (progress >= 1) {
      transitionRef.current = {
        ...transition,
        from: transition.to,
      };
    }

    return value;
  }, []);

  const toggleVisibility = useCallback(() => {
    setAppError('');

    if (!backgroundRef.current) {
      setAppError('Calibrá el fondo antes de usar Desaparecer.');
      return;
    }

    if (!segmenterRef.current) {
      setAppError('La segmentación no está lista. Ejecutá npm run assets si faltan modelos locales.');
      return;
    }

    const now = performance.now();
    const currentProgress = getInvisibleProgress(now);
    const nextInvisible = !isInvisibleRef.current;

    transitionRef.current = {
      from: currentProgress,
      to: nextInvisible ? 1 : 0,
      startedAt: now,
      duration: transitionDuration,
    };

    isInvisibleRef.current = nextInvisible;
    setIsInvisible(nextInvisible);
  }, [getInvisibleProgress, transitionDuration]);

  const loadGestureModels = useCallback(async () => {
    if (gestureReady && handLandmarkerRef.current && faceLandmarkerRef.current) {
      return true;
    }

    setGestureLoading(true);
    setStatusIfChanged(gestureStatusRef, setGestureStatus, 'Cargando modelos de gesto...');

    try {
      const [handLandmarker, faceLandmarker] = await Promise.all([
        createHandLandmarker(),
        createFaceLandmarker(),
      ]);

      handLandmarkerRef.current = handLandmarker;
      faceLandmarkerRef.current = faceLandmarker;
      setGestureReady(true);
      return true;
    } catch (error) {
      closeTask(handLandmarkerRef.current);
      closeTask(faceLandmarkerRef.current);
      handLandmarkerRef.current = null;
      faceLandmarkerRef.current = null;
      setGestureReady(false);
      setStatusIfChanged(gestureStatusRef, setGestureStatus, `Gestos no disponibles: ${formatVisionError(error)}`);
      return false;
    } finally {
      setGestureLoading(false);
    }
  }, [gestureReady]);

  const handleGestureToggle = async (event) => {
    const shouldEnable = event.target.checked;

    if (!shouldEnable) {
      setGestureEnabled(false);
      gestureServiceRef.current.reset();
      setGestureDetail('');
      setStatusIfChanged(gestureStatusRef, setGestureStatus, GESTURE_STATES.DISABLED);
      return;
    }

    const loaded = await loadGestureModels();
    setGestureEnabled(loaded);

    if (loaded) {
      setStatusIfChanged(gestureStatusRef, setGestureStatus, GESTURE_STATES.SEARCHING);
    }
  };

  const handleStartCamera = async () => {
    setAppError('');
    await camera.startCamera(camera.selectedDeviceId);
  };

  const handleStopCamera = () => {
    calibrationAbortRef.current?.abort();
    calibrationAbortRef.current = null;
    latestMaskRef.current = null;
    setBackgroundImage(null);
    setCalibrationStatus('Fondo no calibrado.');
    setIsInvisible(false);
    isInvisibleRef.current = false;
    transitionRef.current = { from: 0, to: 0, startedAt: performance.now(), duration: transitionDuration };
    camera.stopCamera();
  };

  const handleDeviceChange = async (event) => {
    const deviceId = event.target.value;
    camera.setSelectedDeviceId(deviceId);

    if (camera.isActive) {
      await camera.startCamera(deviceId);
      setBackgroundImage(null);
      setCalibrationStatus('Fondo no calibrado. Recalibrá después de cambiar de cámara.');
    }
  };

  const handleCalibrate = async () => {
    setAppError('');

    if (!camera.isActive) {
      setCalibrationStatus('Activá la cámara antes de calibrar el fondo.');
      return;
    }

    calibrationAbortRef.current?.abort();
    const controller = new AbortController();
    calibrationAbortRef.current = controller;
    setIsCalibrating(true);
    setCalibrationStatus('Salí del encuadre: se capturará el fondo vacío.');

    try {
      const background = await calibrateBackground({
        video: videoRef.current,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        onCountdown: (second) => {
          setCalibrationCountdown(second > 0 ? second : null);
          if (second > 0) {
            setCalibrationStatus(`Calibración en ${second}...`);
          }
        },
        onProgress: (current, total) => {
          setCalibrationStatus(`Capturando fondo ${current}/${total}...`);
        },
        signal: controller.signal,
      });

      setBackgroundImage(background);
      setCalibrationStatus('Fondo calibrado. Podés desaparecer.');
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setCalibrationStatus(error?.message || 'No se pudo calibrar el fondo.');
      }
    } finally {
      setCalibrationCountdown(null);
      setIsCalibrating(false);
      calibrationAbortRef.current = null;
    }
  };

  useEffect(() => {
    if (!camera.isActive) {
      return undefined;
    }

    let animationFrameId = 0;
    let lastSegmentAt = 0;
    let lastGestureAt = 0;
    let cancelled = false;
    const frameCanvas = frameCanvasRef.current;
    const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });

    function handleSegmentationResult(result, now) {
      const extractedMask = extractPersonMask(result, now);

      if (!extractedMask) {
        setStatusIfChanged(segmentationStatusRef, setSegmentationStatus, 'Segmentación sin máscara de persona usable.');
        return;
      }

      latestMaskRef.current = extractedMask;
      const source = extractedMask.source === 'confidence' ? 'confianza' : 'categoría';
      setStatusIfChanged(segmentationStatusRef, setSegmentationStatus, `Máscara de persona activa (${source}).`);
    }

    function runSegmentation(video, now) {
      const segmenter = segmenterRef.current;

      if (!segmenter || now - lastSegmentAt < SEGMENT_INTERVAL_MS) {
        return;
      }

      lastSegmentAt = now;

      try {
        let callbackHandled = false;
        const maybeResult = segmenter.segmentForVideo(video, now, (result) => {
          callbackHandled = true;
          handleSegmentationResult(result, now);
        });

        if (!callbackHandled && maybeResult) {
          handleSegmentationResult(maybeResult, now);
        }
      } catch (error) {
        setStatusIfChanged(segmentationStatusRef, setSegmentationStatus, `Error de segmentación: ${formatVisionError(error)}`);
      }
    }

    function runGesture(video, now) {
      if (!gestureEnabledRef.current || now - lastGestureAt < GESTURE_INTERVAL_MS) {
        return;
      }

      lastGestureAt = now;

      const handLandmarker = handLandmarkerRef.current;
      const faceLandmarker = faceLandmarkerRef.current;

      if (!handLandmarker || !faceLandmarker) {
        setStatusIfChanged(gestureStatusRef, setGestureStatus, 'Modelos de gesto no disponibles.');
        return;
      }

      try {
        const handResults = handLandmarker.detectForVideo(video, now);
        let faceResults = null;

        // Face Landmarker is expensive; only run it when the two-finger pose exists.
        if (hasTwoFingerPose(handResults, FRAME_WIDTH, FRAME_HEIGHT)) {
          faceResults = faceLandmarker.detectForVideo(video, now);
        }

        const decision = gestureServiceRef.current.update({
          handResults,
          faceResults,
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
          now,
        });

        setStatusIfChanged(gestureStatusRef, setGestureStatus, decision.status);
        setStatusIfChanged(gestureDetailRef, setGestureDetail, decision.detail || '');

        if (decision.shouldToggle) {
          toggleVisibility();
        }
      } catch (error) {
        setStatusIfChanged(gestureStatusRef, setGestureStatus, `Error de gesto: ${formatVisionError(error)}`);
      }
    }

    function updateFps(now) {
      const fpsWindow = fpsWindowRef.current;
      fpsWindow.frames += 1;

      if (now - fpsWindow.startedAt >= 500) {
        setFps(Math.round((fpsWindow.frames * 1000) / (now - fpsWindow.startedAt)));
        fpsWindow.frames = 0;
        fpsWindow.startedAt = now;
      }
    }

    function render(now) {
      if (cancelled) {
        return;
      }

      const video = videoRef.current;
      const processedCanvas = processedCanvasRef.current;

      if (video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && processedCanvas) {
        frameContext.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        runSegmentation(video, now);
        runGesture(video, now);

        const latestMask = latestMaskRef.current;
        const maskIsStale = latestMask && now - latestMask.timestamp > MASK_STALE_MS;
        const invisibleProgress = getInvisibleProgress(now);
        const usableMask = maskIsStale ? null : latestMask;

        if (maskIsStale) {
          setStatusIfChanged(segmentationStatusRef, setSegmentationStatus, 'Máscara vencida; esperando segmentación actualizada.');
        }

        compositorRef.current.composeFrame({
          sourceCanvas: frameCanvas,
          outputCanvas: processedCanvas,
          backgroundImageData: backgroundRef.current,
          personMask: usableMask,
          invisibleProgress,
          visualParams,
        });

        updateFps(now);
      }

      animationFrameId = requestAnimationFrame(render);
    }

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrameId);
    };
  }, [camera.isActive, getInvisibleProgress, toggleVisibility]);

  useEffect(() => {
    return () => {
      calibrationAbortRef.current?.abort();
      closeTask(segmenterRef.current);
      closeTask(handLandmarkerRef.current);
      closeTask(faceLandmarkerRef.current);
    };
  }, []);

  const canToggleVisibility = camera.isActive && segmentationReady && !isCalibrating;
  const secureContextWarning = !camera.isSecure ? 'La cámara requiere HTTPS o localhost.' : '';
  const combinedError = appError || camera.error || secureContextWarning;

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Goku Cam Web</p>
          <h1>Teletransportación de cámara</h1>
          <p className="hero-copy">
            Calibrá un fondo vacío, activá la cámara y alterná entre aparecer y desaparecer en tiempo real.
          </p>
        </div>
        <div className="metric-card" aria-live="polite">
          <span>FPS</span>
          <strong>{fps}</strong>
        </div>
      </header>

      {combinedError ? <div className="error-banner">{combinedError}</div> : null}

      <section className="controls-grid" aria-label="Controles de cámara y composición">
        <CameraPanel
          devices={camera.devices}
          selectedDeviceId={camera.selectedDeviceId}
          onDeviceChange={handleDeviceChange}
          onStart={handleStartCamera}
          onStop={handleStopCamera}
          isActive={camera.isActive}
          isSupported={camera.isSupported}
          isSecure={camera.isSecure}
        />
        <CalibrationPanel
          onCalibrate={handleCalibrate}
          disabled={!camera.isActive || isCalibrating}
          hasBackground={Boolean(backgroundImage)}
          countdown={calibrationCountdown}
        />
        <VisibilityPanel
          onToggle={() => toggleVisibility()}
          disabled={!canToggleVisibility}
          isInvisible={isInvisible}
          transitionDuration={transitionDuration}
          onTransitionChange={setTransitionDuration}
        />
        <GesturePanel
          enabled={gestureEnabled}
          loading={gestureLoading}
          disabled={!camera.isActive || gestureLoading}
          onToggleChange={handleGestureToggle}
          detail={gestureDetail}
        />
      </section>

      <PreviewGrid
        videoRef={videoRef}
        processedCanvasRef={processedCanvasRef}
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
        cameraStatus={camera.status}
        isInvisible={isInvisible}
      />

      <StatusGrid
        cameraStatus={camera.status}
        calibrationStatus={calibrationStatus}
        segmentationStatus={segmentationStatus}
        gestureStatus={gestureStatus}
      />
    </main>
  );
}
