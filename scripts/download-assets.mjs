import { createRequire } from 'node:module';
import { mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(rootDir, 'public');
const modelsDir = join(publicDir, 'models');
const wasmDir = join(publicDir, 'wasm');

// Official source URLs used by this app. Runtime uses local files only.
const modelSources = [
  {
    name: 'DeepLabV3 Image Segmenter',
    fileName: 'deeplabv3.tflite',
    url: 'https://storage.googleapis.com/mediapipe-assets/deeplabv3.tflite?generation=1661875711618421',
  },
  {
    name: 'Hand Landmarker',
    fileName: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
  {
    name: 'Face Landmarker',
    fileName: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
];

async function ensureDirectories() {
  await mkdir(modelsDir, { recursive: true });
  await mkdir(wasmDir, { recursive: true });
}

async function downloadFile({ name, fileName, url }) {
  const destination = join(modelsDir, fileName);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Could not download ${name}: ${response.status} ${response.statusText}`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  await writeFile(destination, data);
  console.log(`Downloaded ${name} -> public/models/${fileName}`);
}

async function copyWasmFiles() {
  // tasks-vision@1.1.1 blocks require.resolve('@mediapipe/tasks-vision/package.json')
  // via its "exports" map, but exposes the wasm entry points. Resolve one of them
  // and walk up to the package wasm directory.
  const wasmEntryPath = require.resolve('@mediapipe/tasks-vision/vision_wasm_internal.js');
  const sourceWasmDir = dirname(wasmEntryPath);
  const entries = await readdir(sourceWasmDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());

  if (files.length === 0) {
    throw new Error('No MediaPipe WASM files found in @mediapipe/tasks-vision.');
  }

  for (const file of files) {
    await copyFile(join(sourceWasmDir, file.name), join(wasmDir, file.name));
    console.log(`Copied MediaPipe WASM -> public/wasm/${file.name}`);
  }
}

await ensureDirectories();
await Promise.all(modelSources.map(downloadFile));
await copyWasmFiles();

console.log('Assets ready. Official WASM source: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm/');
