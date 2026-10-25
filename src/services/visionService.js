import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  ImageSegmenter,
} from '@mediapipe/tasks-vision';
import { getCategoryValues } from './compositorService.js';

export const MODEL_PATHS = {
  imageSegmenter: '/models/deeplabv3.tflite',
  handLandmarker: '/models/hand_landmarker.task',
  faceLandmarker: '/models/face_landmarker.task',
};

const WASM_ROOT = '/wasm';
let visionFilesetPromise;

function getRequestedDelegate() {
  if (typeof window === 'undefined') {
    return 'CPU';
  }

  const requested = new URLSearchParams(window.location.search).get('delegate');

  if (requested === 'cpu') {
    return 'CPU';
  }

  if (requested === 'gpu') {
    return 'GPU';
  }

  return 'GPU';
}

export const PREFERRED_DELEGATE = getRequestedDelegate();

async function getVisionFileset() {
  if (!visionFilesetPromise) {
    visionFilesetPromise = FilesetResolver.forVisionTasks(WASM_ROOT);
  }

  return visionFilesetPromise;
}

/**
 * Crea una tarea de MediaPipe intentando primero el delegate de GPU.
 * Si el navegador/driver no lo soporta, se cae automaticamente a CPU.
 */
async function createTaskWithFallback(TaskClass, vision, options) {
  if (PREFERRED_DELEGATE === 'GPU') {
    try {
      return await TaskClass.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'GPU' },
      });
    } catch (gpuError) {
      console.warn('[vision] GPU delegate no disponible, se usa CPU.', gpuError);
    }
  }

  return TaskClass.createFromOptions(vision, {
    ...options,
    baseOptions: { ...options.baseOptions, delegate: 'CPU' },
  });
}

/**
 * Verifica que la mascara de categoria se pueda leer de verdad.
 * En algunos equipos el readback del texture con delegate GPU no esta
 * soportado, en ese caso hay que volver a CPU.
 */
function isSegmenterReadable(segmenter) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;

    const context = canvas.getContext('2d');
    context.fillStyle = '#2b6cb0';
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = '#e8b48c';
    context.beginPath();
    context.ellipse(64, 60, 22, 34, 0, 0, Math.PI * 2);
    context.fill();

    const result = segmenter.segmentForVideo(canvas, 0);
    const mask = result?.categoryMask;

    if (!mask) {
      return false;
    }

    const values = getCategoryValues(mask);
    mask.close();

    if (!values || !values.length) {
      return false;
    }

    for (let index = 0; index < values.length; index += 1) {
      if (values[index] !== 0) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.warn('[vision] No se pudo leer la máscara de categoría.', error);
    return false;
  }
}

export async function createImageSegmenter() {
  const vision = await getVisionFileset();

  const options = {
    baseOptions: {
      modelAssetPath: MODEL_PATHS.imageSegmenter,
    },
    runningMode: 'VIDEO',
    // Solo la mascara de categoria: generar los 21 confidence masks multiplica
    // por ~20 el costo de memoria y CPU en cada frame sin aporta nada extra.
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  };

  if (PREFERRED_DELEGATE === 'GPU') {
    try {
      const segmenter = await ImageSegmenter.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'GPU' },
      });

      if (isSegmenterReadable(segmenter)) {
        return segmenter;
      }

      segmenter.close();
      console.warn('[vision] El delegate GPU no devuelve máscaras usables, se usa CPU.');
    } catch (gpuError) {
      console.warn('[vision] GPU delegate no disponible, se usa CPU.', gpuError);
    }
  }

  return ImageSegmenter.createFromOptions(vision, {
    ...options,
    baseOptions: { ...options.baseOptions, delegate: 'CPU' },
  });
}

export async function createHandLandmarker() {
  const vision = await getVisionFileset();

  return createTaskWithFallback(HandLandmarker, vision, {
    baseOptions: {
      modelAssetPath: MODEL_PATHS.handLandmarker,
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
  });
}

export async function createFaceLandmarker() {
  const vision = await getVisionFileset();

  return createTaskWithFallback(FaceLandmarker, vision, {
    baseOptions: {
      modelAssetPath: MODEL_PATHS.faceLandmarker,
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

export function formatVisionError(error) {
  const rawMessage = error?.message || String(error);

  if (rawMessage.includes('404') || rawMessage.includes('Failed to fetch')) {
    return 'No se encontraron los assets locales. Ejecutá npm run assets y reiniciá el servidor.';
  }

  return rawMessage;
}
