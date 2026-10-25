export const PERSON_CATEGORY_INDEX = 15;
export const MASK_STALE_MS = 900;

function closeMask(mask) {
  if (typeof mask?.close === 'function') {
    mask.close();
  }
}

function readMaskSize(mask, data) {
  const width = mask?.width || mask?.canvas?.width || 0;
  const height = mask?.height || mask?.canvas?.height || (width ? Math.floor(data.length / width) : 0);

  return { width, height };
}

function getMaskArray(mask, preferredKind) {
  if (preferredKind === 'confidence' && typeof mask?.getAsFloat32Array === 'function') {
    return mask.getAsFloat32Array();
  }

  if (preferredKind === 'category' && typeof mask?.getAsUint8Array === 'function') {
    return mask.getAsUint8Array();
  }

  if (typeof mask?.getAsImageData === 'function') {
    return mask.getAsImageData();
  }

  return null;
}

export function extractPersonMask(result, timestamp) {
  const confidenceMask = result?.confidenceMasks?.[PERSON_CATEGORY_INDEX];
  const categoryMask = result?.categoryMask;

  try {
    if (confidenceMask) {
      const confidenceValues = getMaskArray(confidenceMask, 'confidence');
      const { width, height } = readMaskSize(confidenceMask, confidenceValues || []);

      if (confidenceValues && width && height) {
        const data = new Uint8ClampedArray(confidenceValues.length);

        for (let index = 0; index < confidenceValues.length; index += 1) {
          data[index] = Math.max(0, Math.min(255, Math.round(confidenceValues[index] * 255)));
        }

        return {
          data,
          width,
          height,
          timestamp,
          source: 'confidence',
        };
      }
    }

    if (categoryMask) {
      const categoryValues = getMaskArray(categoryMask, 'category');
      const { width, height } = readMaskSize(categoryMask, categoryValues || []);

      if (categoryValues && width && height) {
        const data = new Uint8ClampedArray(categoryValues.length);

        for (let index = 0; index < categoryValues.length; index += 1) {
          data[index] = categoryValues[index] === PERSON_CATEGORY_INDEX ? 255 : 0;
        }

        return {
          data,
          width,
          height,
          timestamp,
          source: 'category',
        };
      }
    }
  } finally {
    closeMask(categoryMask);

    if (Array.isArray(result?.confidenceMasks)) {
      for (const mask of result.confidenceMasks) {
        closeMask(mask);
      }
    }
  }

  return null;
}

export class CompositorService {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.maskSourceCanvas = document.createElement('canvas');
    this.maskCanvas = document.createElement('canvas');
    this.blurCanvas = document.createElement('canvas');
    this.cachedMask = null;
    this.cachedBlurRadius = null;
    this.cachedAlpha = null;
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.maskCanvas.width = width;
    this.maskCanvas.height = height;
    this.blurCanvas.width = width;
    this.blurCanvas.height = height;
    this.cachedMask = null;
    this.cachedAlpha = null;
  }

  composeFrame({ sourceCanvas, outputCanvas, backgroundImageData, personMask, invisibleProgress, visualParams }) {
    if (!sourceCanvas || !outputCanvas) {
      return;
    }

    if (outputCanvas.width !== this.width || outputCanvas.height !== this.height) {
      outputCanvas.width = this.width;
      outputCanvas.height = this.height;
    }

    const outputContext = outputCanvas.getContext('2d');

    if (!backgroundImageData || !personMask || invisibleProgress <= 0.01) {
      outputContext.drawImage(sourceCanvas, 0, 0, this.width, this.height);
      return;
    }

    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const frame = sourceContext.getImageData(0, 0, this.width, this.height);
    const frameData = frame.data;
    const backgroundData = backgroundImageData.data;
    const alphaMask = this.getSmoothedMask(personMask, visualParams.blurRadius);
    const threshold = visualParams.maskThreshold;
    const softness = Math.max(0.01, visualParams.maskSoftness);

    for (let pixel = 0; pixel < alphaMask.length; pixel += 1) {
      const alpha = Math.max(0, Math.min(1, (alphaMask[pixel] / 255 - threshold) / softness));
      const blend = alpha * invisibleProgress;

      if (blend <= 0) {
        continue;
      }

      const offset = pixel * 4;
      frameData[offset] = frameData[offset] * (1 - blend) + backgroundData[offset] * blend;
      frameData[offset + 1] = frameData[offset + 1] * (1 - blend) + backgroundData[offset + 1] * blend;
      frameData[offset + 2] = frameData[offset + 2] * (1 - blend) + backgroundData[offset + 2] * blend;
      frameData[offset + 3] = 255;
    }

    outputContext.putImageData(frame, 0, 0);
  }

  getSmoothedMask(personMask, blurRadius) {
    if (this.cachedMask === personMask && this.cachedBlurRadius === blurRadius && this.cachedAlpha) {
      return this.cachedAlpha;
    }

    this.maskSourceCanvas.width = personMask.width;
    this.maskSourceCanvas.height = personMask.height;

    const sourceContext = this.maskSourceCanvas.getContext('2d', { willReadFrequently: true });
    const sourceImage = sourceContext.createImageData(personMask.width, personMask.height);

    for (let index = 0; index < personMask.data.length; index += 1) {
      const offset = index * 4;
      sourceImage.data[offset] = 255;
      sourceImage.data[offset + 1] = 255;
      sourceImage.data[offset + 2] = 255;
      sourceImage.data[offset + 3] = personMask.data[index];
    }

    sourceContext.putImageData(sourceImage, 0, 0);

    const maskContext = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    maskContext.clearRect(0, 0, this.width, this.height);
    maskContext.imageSmoothingEnabled = true;
    maskContext.drawImage(this.maskSourceCanvas, 0, 0, this.width, this.height);

    const blurContext = this.blurCanvas.getContext('2d', { willReadFrequently: true });
    blurContext.clearRect(0, 0, this.width, this.height);
    blurContext.filter = blurRadius > 0 ? `blur(${blurRadius}px)` : 'none';
    blurContext.drawImage(this.maskCanvas, 0, 0);
    blurContext.filter = 'none';

    const rgba = blurContext.getImageData(0, 0, this.width, this.height).data;
    const alpha = new Uint8ClampedArray(this.width * this.height);

    for (let pixel = 0, offset = 3; pixel < alpha.length; pixel += 1, offset += 4) {
      alpha[pixel] = rgba[offset];
    }

    this.cachedMask = personMask;
    this.cachedBlurRadius = blurRadius;
    this.cachedAlpha = alpha;

    return alpha;
  }
}
