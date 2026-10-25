function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException('Calibration aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function medianByte(frames, offset, scratch) {
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    scratch[frameIndex] = frames[frameIndex][offset];
  }

  scratch.sort();
  return scratch[Math.floor(frames.length / 2)];
}

export async function calibrateBackground({
  video,
  width,
  height,
  countdownSeconds = 4,
  sampleCount = 15,
  sampleIntervalMs = 90,
  onCountdown,
  onProgress,
  signal,
}) {
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    throw new Error('La cámara debe estar activa antes de calibrar el fondo.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const frames = [];

  for (let second = countdownSeconds; second > 0; second -= 1) {
    onCountdown?.(second);
    await delay(1000, signal);
  }

  onCountdown?.(0);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    if (signal?.aborted) {
      throw new DOMException('Calibration aborted', 'AbortError');
    }

    context.drawImage(video, 0, 0, width, height);
    frames.push(new Uint8ClampedArray(context.getImageData(0, 0, width, height).data));
    onProgress?.(sample + 1, sampleCount);
    await delay(sampleIntervalMs, signal);
  }

  const medianImage = context.createImageData(width, height);
  const scratch = new Uint8Array(frames.length);

  for (let offset = 0; offset < medianImage.data.length; offset += 4) {
    medianImage.data[offset] = medianByte(frames, offset, scratch);
    medianImage.data[offset + 1] = medianByte(frames, offset + 1, scratch);
    medianImage.data[offset + 2] = medianByte(frames, offset + 2, scratch);
    medianImage.data[offset + 3] = 255;
  }

  return medianImage;
}
