import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  ImageSegmenter,
} from '@mediapipe/tasks-vision';

export const MODEL_PATHS = {
  imageSegmenter: '/models/deeplabv3.tflite',
  handLandmarker: '/models/hand_landmarker.task',
  faceLandmarker: '/models/face_landmarker.task',
};

const WASM_ROOT = '/wasm';
let visionFilesetPromise;

async function getVisionFileset() {
  if (!visionFilesetPromise) {
    visionFilesetPromise = FilesetResolver.forVisionTasks(WASM_ROOT);
  }

  return visionFilesetPromise;
}

export async function createImageSegmenter() {
  const vision = await getVisionFileset();

  return ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_PATHS.imageSegmenter,
    },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: true,
  });
}

export async function createHandLandmarker() {
  const vision = await getVisionFileset();

  return HandLandmarker.createFromOptions(vision, {
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

  return FaceLandmarker.createFromOptions(vision, {
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
