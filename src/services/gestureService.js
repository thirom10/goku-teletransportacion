export const GESTURE_STATES = {
  DISABLED: 'Gesto desactivado',
  SEARCHING: 'Buscando mano',
  DETECTED: 'Gesto detectado',
  CONFIRMED: 'Gesto confirmado',
};

const HAND_LANDMARKS = {
  indexMcp: 5,
  indexPip: 6,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleTip: 12,
  ringPip: 14,
  ringTip: 16,
  pinkyPip: 18,
  pinkyTip: 20,
};

const FACE_FOREHEAD_INDEX = 10;

function toPixel(landmark, width, height) {
  return {
    x: landmark.x * width,
    y: landmark.y * height,
  };
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function isFingerExtended(landmarks, tipIndex, pipIndex, mcpIndex) {
  const tip = landmarks[tipIndex];
  const pip = landmarks[pipIndex];
  const mcp = landmarks[mcpIndex];

  if (!tip || !pip || !mcp) {
    return false;
  }

  return tip.y < pip.y - 0.015 && pip.y <= mcp.y + 0.04;
}

function isFingerFolded(landmarks, tipIndex, pipIndex) {
  const tip = landmarks[tipIndex];
  const pip = landmarks[pipIndex];

  if (!tip || !pip) {
    return false;
  }

  return tip.y > pip.y - 0.02;
}

function findForehead(faceResults, width, height) {
  const face = faceResults?.faceLandmarks?.[0];
  const forehead = face?.[FACE_FOREHEAD_INDEX];

  if (!forehead) {
    return null;
  }

  const point = toPixel(forehead, width, height);

  return {
    x: point.x,
    y: point.y - height * 0.025,
  };
}

function findTwoFingerPose(handResults, width, height) {
  const hands = handResults?.landmarks || [];

  for (const landmarks of hands) {
    const indexExtended = isFingerExtended(
      landmarks,
      HAND_LANDMARKS.indexTip,
      HAND_LANDMARKS.indexPip,
      HAND_LANDMARKS.indexMcp,
    );
    const middleExtended = isFingerExtended(
      landmarks,
      HAND_LANDMARKS.middleTip,
      HAND_LANDMARKS.middlePip,
      HAND_LANDMARKS.middleMcp,
    );
    const ringFolded = isFingerFolded(landmarks, HAND_LANDMARKS.ringTip, HAND_LANDMARKS.ringPip);
    const pinkyFolded = isFingerFolded(landmarks, HAND_LANDMARKS.pinkyTip, HAND_LANDMARKS.pinkyPip);

    if (!indexExtended || !middleExtended || !ringFolded || !pinkyFolded) {
      continue;
    }

    const indexTip = toPixel(landmarks[HAND_LANDMARKS.indexTip], width, height);
    const middleTip = toPixel(landmarks[HAND_LANDMARKS.middleTip], width, height);

    return {
      x: (indexTip.x + middleTip.x) / 2,
      y: (indexTip.y + middleTip.y) / 2,
    };
  }

  return null;
}

export function hasTwoFingerPose(handResults, width, height) {
  return findTwoFingerPose(handResults, width, height) !== null;
}

export class GestureService {
  constructor({ confirmationMs = 550, maxDistancePx = 82 } = {}) {
    this.confirmationMs = confirmationMs;
    this.maxDistancePx = maxDistancePx;
    this.confirmationStartedAt = null;
    this.waitingForRelease = false;
  }

  reset() {
    this.confirmationStartedAt = null;
    this.waitingForRelease = false;
  }

  update({ handResults, faceResults, width, height, now }) {
    const hands = handResults?.landmarks || [];

    if (hands.length === 0) {
      this.confirmationStartedAt = null;
      this.waitingForRelease = false;
      return {
        shouldToggle: false,
        phase: 'searching',
        status: GESTURE_STATES.SEARCHING,
        detail: 'Mostrá la mano con índice y medio extendidos.',
      };
    }

    const twoFingerPoint = findTwoFingerPose(handResults, width, height);

    if (!twoFingerPoint) {
      this.confirmationStartedAt = null;
      // A visible hand in any other pose does NOT count as withdrawn.
      return {
        shouldToggle: false,
        phase: 'searching',
        status: GESTURE_STATES.SEARCHING,
        detail: 'Extendé índice y medio; el resto de los dedos doblados.',
      };
    }

    if (this.waitingForRelease) {
      return {
        shouldToggle: false,
        phase: 'confirmed',
        status: GESTURE_STATES.CONFIRMED,
        detail: 'Sacá la mano del encuadre para reactivar el gesto.',
      };
    }

    const foreheadPoint = findForehead(faceResults, width, height);

    if (!foreheadPoint) {
      this.confirmationStartedAt = null;
      return {
        shouldToggle: false,
        phase: 'detected',
        status: GESTURE_STATES.DETECTED,
        detail: 'Mostrá el rostro para estimar la frente.',
      };
    }

    const proximity = distance(twoFingerPoint, foreheadPoint);

    if (proximity > this.maxDistancePx) {
      this.confirmationStartedAt = null;
      return {
        shouldToggle: false,
        phase: 'detected',
        status: GESTURE_STATES.DETECTED,
        detail: 'Acercá los dedos a la frente.',
      };
    }

    if (!this.confirmationStartedAt) {
      this.confirmationStartedAt = now;
    }

    const elapsed = now - this.confirmationStartedAt;

    if (elapsed < this.confirmationMs) {
      const percent = Math.round((elapsed / this.confirmationMs) * 100);
      return {
        shouldToggle: false,
        phase: 'detected',
        status: GESTURE_STATES.DETECTED,
        detail: `Mantené el gesto (${percent}%).`,
      };
    }

    this.confirmationStartedAt = null;
    this.waitingForRelease = true;

    return {
      shouldToggle: true,
      phase: 'confirmed',
      status: GESTURE_STATES.CONFIRMED,
      detail: 'Alternando visibilidad una sola vez.',
    };
  }
}
