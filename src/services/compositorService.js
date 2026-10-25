export const PERSON_CATEGORY_INDEX = 15;
export const MASK_STALE_MS = 1500;
const MAX_CATEGORY_INDEX = 24;

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

/**
 * Lee los indices de categoria de la mascara.
 *
 * Con delegate CPU el Uint8Array ya trae los indices (0..20). Con delegate
 * GPU viene escalado (indice * 255), asi que hay que releer los floats
 * crudos del texture.
 */
export function getCategoryValues(mask) {
  if (!mask) {
    return null;
  }

  let bytes = null;

  if (typeof mask.getAsUint8Array === 'function') {
    try {
      bytes = mask.getAsUint8Array();
    } catch (error) {
      bytes = null;
    }
  }

  if (bytes && bytes.length) {
    let maxValue = 0;

    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] > maxValue) {
        maxValue = bytes[index];
      }
    }

    if (maxValue <= MAX_CATEGORY_INDEX) {
      return bytes;
    }
  }

  if (typeof mask.getAsFloat32Array === 'function') {
    try {
      const floats = mask.getAsFloat32Array();

      if (floats && floats.length) {
        const raw = new Uint8Array(floats.length);

        for (let index = 0; index < floats.length; index += 1) {
          raw[index] = Math.round(floats[index]);
        }

        return raw;
      }
    } catch (error) {
      return null;
    }
  }

  return bytes;
}

/**
 * Extrae la mascara binaria de persona a partir del category mask.
 * Devuelve ademas el bbox en pixeles de mascara, usado para anclar el
 * efecto de teletransportacion donde esta la persona.
 */
export function extractPersonMask(result, timestamp) {
  const categoryMask = result?.categoryMask;

  try {
    if (!categoryMask) {
      return null;
    }

    const categoryValues = getCategoryValues(categoryMask);
    const { width, height } = readMaskSize(categoryMask, categoryValues || []);

    if (!categoryValues || !width || !height) {
      return null;
    }

    const data = new Uint8ClampedArray(categoryValues.length);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let index = 0; index < categoryValues.length; index += 1) {
      if (categoryValues[index] !== PERSON_CATEGORY_INDEX) {
        continue;
      }

      data[index] = 255;

      const x = index % width;
      const y = (index / width) | 0;

      if (x < minX) {
        minX = x;
      }

      if (x > maxX) {
        maxX = x;
      }

      if (y < minY) {
        minY = y;
      }

      if (y > maxY) {
        maxY = y;
      }
    }

    if (maxX < 0) {
      return null;
    }

    return {
      data,
      width,
      height,
      timestamp,
      source: 'category',
      bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
    };
  } finally {
    closeMask(categoryMask);
  }
}

function clamp01(value) {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

/**
 * Compositor del teletransporte.
 *
 * El estado "invisible" es exactamente el que tenia la app original: el
 * frame en vivo se reemplaza por el fondo calibrado (frame entero), sin
 * depender de que la segmentacion se haya acertado.
 *
 * Durante la transicion el efecto anime agrega el corte en rebanadas:
 * cada banda se revela por separado, con el destello de linea vertical.
 *
 * Todo se resuelve con operaciones de canvas aceleradas por GPU (no hay
 * getImageData ni loops por pixel).
 */
export class CompositorService {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.backgroundCanvas = document.createElement('canvas');
    this.bandCanvas = document.createElement('canvas');
    this.cutCanvas = document.createElement('canvas');
    this.cachedBackground = null;
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.backgroundCanvas.width = width;
    this.backgroundCanvas.height = height;
    this.bandCanvas.width = width;
    this.bandCanvas.height = height;
    this.cutCanvas.width = width;
    this.cutCanvas.height = height;
    this.cachedBackground = null;
  }

  composeFrame({
    source,
    outputCanvas,
    backgroundImageData,
    bandFactors,
    invisibleProgress,
  }) {
    if (!source || !outputCanvas) {
      return;
    }

    if (outputCanvas.width !== this.width || outputCanvas.height !== this.height) {
      outputCanvas.width = this.width;
      outputCanvas.height = this.height;
    }

    const outputContext = outputCanvas.getContext('2d');
    outputContext.globalCompositeOperation = 'source-over';
    outputContext.globalAlpha = 1;

    if (!backgroundImageData || invisibleProgress <= 0.01) {
      outputContext.drawImage(source, 0, 0, this.width, this.height);
      return;
    }

    this.ensureBackground(backgroundImageData);

    // 1) fundido global: el frame en vivo se reemplaza por el fondo calibrado
    outputContext.drawImage(source, 0, 0, this.width, this.height);
    outputContext.globalAlpha = clamp01(invisibleProgress);
    outputContext.drawImage(this.backgroundCanvas, 0, 0, this.width, this.height);
    outputContext.globalAlpha = 1;

    if (!bandFactors || bandFactors.length === 0) {
      return;
    }

    // 2) corte anime: cada banda se revela por separado con el fondo
    this.paintBands(bandFactors);

    const cutContext = this.cutCanvas.getContext('2d');
    cutContext.globalCompositeOperation = 'source-over';
    cutContext.globalAlpha = 1;
    cutContext.clearRect(0, 0, this.width, this.height);
    cutContext.drawImage(this.backgroundCanvas, 0, 0, this.width, this.height);
    cutContext.globalCompositeOperation = 'destination-in';
    cutContext.drawImage(this.bandCanvas, 0, 0, this.width, this.height);
    cutContext.globalCompositeOperation = 'source-over';

    outputContext.drawImage(this.cutCanvas, 0, 0, this.width, this.height);
  }

  ensureBackground(backgroundImageData) {
    if (this.cachedBackground === backgroundImageData) {
      return;
    }

    const context = this.backgroundCanvas.getContext('2d');
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, this.width, this.height);
    context.putImageData(backgroundImageData, 0, 0);

    this.cachedBackground = backgroundImageData;
  }

  paintBands(bandFactors) {
    const context = this.bandCanvas.getContext('2d');

    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = '#ffffff';

    for (const band of bandFactors) {
      const factor = clamp01(band.factor);

      if (factor <= 0) {
        continue;
      }

      // Bordes enteros: dos rects contiguos con coordenadas fraccionarias
      // dejan una costura antialiaseada por la que se asoma el frame vivo.
      const x0 = Math.round(band.x0);
      const x1 = Math.round(band.x1);

      context.globalAlpha = factor;
      context.fillRect(x0, 0, Math.max(1, x1 - x0), this.height);
    }

    context.globalAlpha = 1;
  }
}
