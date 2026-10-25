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
import { TeleportEffect } from './services/teleportEffect.js';
import { TeleportAudioService } from './services/audioService.js';
import CameraPanel from './components/CameraPanel.jsx';
import CalibrationPanel from './components/CalibrationPanel.jsx';
import VisibilityPanel from './components/VisibilityPanel.jsx';
import GesturePanel from './components/GesturePanel.jsx';
import PreviewGrid from './components/PreviewGrid.jsx';
import StatusGrid from './components/StatusGrid.jsx';

const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;
const SEGMENT_INTERVAL_MS = 380;
const SEGMENT_INTERVAL_ACTIVE_MS = 110;
const GESTURE_INTERVAL_MS = 150;
const FACE_INTERVAL_MS = 240;
const DEFAULT_TRANSITION_MS = 520;
const DEFAULT_VOLUME = 0.7;

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

function getMaskAnchor(mask) {
  if (!mask?.bbox) {
    return null;
  }

  const scaleX = FRAME_WIDTH / mask.width;
  const scaleY = FRAME_HEIGHT / mask.height;
  const { x0, y0, x1, y1 } = mask.bbox;

  return {
    x: x0 * scaleX,
    y: y0 * scaleY,
    width: (x1 - x0 + 1) * scaleX,
    height: (y1 - y0 + 1) * scaleY,
  };
}

function getFallbackAnchor() {
  return {
    x: FRAME_WIDTH * 0.25,
    y: FRAME_HEIGHT * 0.08,
    width: FRAME_WIDTH * 0.5,
    height: FRAME_HEIGHT * 0.84,
  };
}

export default function App() {
  const videoRef = useRef(null);
  const processedCanvasRef = useRef(null);
  const outputContextRef = useRef(null);
  const compositorRef = useRef(null);
  const segmenterRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const gestureServiceRef = useRef(new GestureService());
  const effectRef = useRef(new TeleportEffect());
  const audioServiceRef = useRef(null);
  const volumeRef = useRef(DEFAULT_VOLUME);
  const latestMaskRef = useRef(null);
  const backgroundRef = useRef(null);
  const transitionRef = useRef({ from: 0, to: 0, startedAt: 0, duration: DEFAULT_TRANSITION_MS });
  const isInvisibleRef = useRef(false);
  const gestureEnabledRef = useRef(false);
  const effectEnabledRef = useRef(true);
  const segmentForceRef = useRef(false);
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
  const [effectEnabled, setEffectEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [audioStatus, setAudioStatus] = useState({
    ready: 0,
    total: 2,
    missing: [],
    missingPaths: [],
    isComplete: false,
  });
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
    effectEnabledRef.current = effectEnabled;
  }, [effectEnabled]);

  useEffect(() => {
    volumeRef.current = volume;
    audioServiceRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    audioServiceRef.current?.setEnabled(soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    const service = new TeleportAudioService({ onStatusChange: setAudioStatus });
    audioServiceRef.current = service;
    service.setVolume(volumeRef.current);
    service.setEnabled(soundEnabled);
    service.init();

    // El navegador exige una interaccion del usuario antes de dejar sonar.
    const unlock = () => {
      service.unlock();
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audioServiceRef.current = null;

      if (service.context) {
        service.context.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    compositorRef.current = new CompositorService(FRAME_WIDTH, FRAME_HEIGHT);
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

  // Fase 0..1 del efecto anime. Corre en sentido contrario al progreso de
  // visibilidad para que al aparecer las bandas se reconstruyan al reves.
  const getEffectPhase = useCallback((now) => {
    const transition = transitionRef.current;

    if (transition.from === transition.to) {
      return transition.to;
    }

    const elapsed = Math.min(1, (now - transition.startedAt) / transition.duration);

    return transition.to > transition.from ? elapsed : 1 - elapsed;
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

    audioServiceRef.current?.play(nextInvisible ? 'disappear' : 'appear');

    // El efecto se ancla donde esta la persona detectada.
    const anchor = getMaskAnchor(latestMaskRef.current) || getFallbackAnchor();
    effectRef.current.begin(anchor, Math.floor(Math.random() * 0xffffffff), FRAME_WIDTH);

    // Fuerza una segmentacion inmediata para trabajar con la mascara al dia.
    segmentForceRef.current = true;
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
    effectRef.current.active = false;
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
    let lastFaceAt = 0;
    let lastFaceResults = null;
    let cancelled = false;

    function handleSegmentationResult(result, now) {
      const extractedMask = extractPersonMask(result, now);
      latestMaskRef.current = extractedMask;

      return Boolean(extractedMask);
    }

    function runSegmentation(video, now, isTransitionActive) {
      const segmenter = segmenterRef.current;

      if (!segmenter) {
        return;
      }

      const interval = isTransitionActive ? SEGMENT_INTERVAL_ACTIVE_MS : SEGMENT_INTERVAL_MS;
      const forced = segmentForceRef.current;

      if (!forced && now - lastSegmentAt < interval) {
        return;
      }

      lastSegmentAt = now;
      segmentForceRef.current = false;

      const startedAt = performance.now();
      let hasPerson = false;

      try {
        let callbackHandled = false;
        const maybeResult = segmenter.segmentForVideo(video, now, (result) => {
          callbackHandled = true;
          hasPerson = handleSegmentationResult(result, now);
        });

        if (!callbackHandled && maybeResult) {
          hasPerson = handleSegmentationResult(maybeResult, now);
        }
      } catch (error) {
        setStatusIfChanged(segmentationStatusRef, setSegmentationStatus, `Error de segmentación: ${formatVisionError(error)}`);
        return;
      }

      const elapsed = Math.round(performance.now() - startedAt);
      const bucket = elapsed < 20 ? 'rápido' : elapsed < 45 ? 'medio' : elapsed < 90 ? 'lento' : 'muy lento';

      setStatusIfChanged(
        segmentationStatusRef,
        setSegmentationStatus,
        `${hasPerson ? 'Máscara de persona activa' : 'Sin persona en el encuadre'} · ${bucket}`,
      );
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

        // Face Landmarker es caro: solo corre con la pose de dos dedos y a una
        // frecuencia menor, reutilizando el ultimo rostro detectado.
        if (hasTwoFingerPose(handResults, FRAME_WIDTH, FRAME_HEIGHT)) {
          if (!lastFaceResults || now - lastFaceAt >= FACE_INTERVAL_MS) {
            lastFaceAt = now;
            lastFaceResults = faceLandmarker.detectForVideo(video, now);
          }

          faceResults = lastFaceResults;
        } else {
          lastFaceResults = null;
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
        const transition = transitionRef.current;
        const isTransitionActive = transition.from !== transition.to;
        const invisibleProgress = getInvisibleProgress(now);
        const effectPhase = getEffectPhase(now);

        runSegmentation(video, now, isTransitionActive);
        runGesture(video, now);

        const latestMask = latestMaskRef.current;
        const maskIsStale = latestMask && now - latestMask.timestamp > MASK_STALE_MS;
        const usableMask = maskIsStale ? null : latestMask;
        const animeActive = effectEnabledRef.current && effectRef.current.active;

        if (animeActive && usableMask && isTransitionActive) {
          const anchor = getMaskAnchor(usableMask);
          effectRef.current.follow(anchor);
        }

        const bandFactors = animeActive && isTransitionActive ? effectRef.current.update(effectPhase) : null;
        // Con el efecto anime el recorte arranca antes que el fundido global,
        // asi que el corte temprano usa el maximo de ambos.
        const hideProgress = animeActive ? Math.max(invisibleProgress, effectPhase) : invisibleProgress;

        compositorRef.current.composeFrame({
          source: video,
          outputCanvas: processedCanvas,
          backgroundImageData: backgroundRef.current,
          bandFactors,
          invisibleProgress: hideProgress,
        });

        if (animeActive) {
          if (!outputContextRef.current) {
            outputContextRef.current = processedCanvas.getContext('2d');
          }

          effectRef.current.render(outputContextRef.current, FRAME_HEIGHT);
        }

        updateFps(now);
      }

      animationFrameId = requestAnimationFrame(render);
    }

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrameId);
    };
  }, [camera.isActive, getEffectPhase, getInvisibleProgress, toggleVisibility]);

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
          effectEnabled={effectEnabled}
          onEffectChange={setEffectEnabled}
          soundEnabled={soundEnabled}
          onSoundChange={setSoundEnabled}
          volume={volume}
          onVolumeChange={setVolume}
          audioStatus={audioStatus}
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
