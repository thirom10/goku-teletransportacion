/**
 * Sonido de teletransportacion.
 *
 * Los archivos se esperan en la carpeta public/audio (se sirven en la raiz):
 *   public/audio/teleport-disappear.mp3  -> al desaparecer
 *   public/audio/teleport-appear.mp3     -> al aparecer
 *
 * Si un archivo no esta, la app sigue funcionando y solo lo avisa en la UI.
 */
export const SOUND_PATHS = {
  disappear: '/audio/teleport-disappear.mp3',
  appear: '/audio/teleport-appear.mp3',
};

export const SOUND_LABELS = {
  disappear: 'desaparecer',
  appear: 'aparecer',
};

export class TeleportAudioService {
  constructor({ onStatusChange } = {}) {
    this.onStatusChange = onStatusChange;
    this.enabled = true;
    this.volume = 0.7;
    this.context = null;
    this.gain = null;
    this.buffers = new Map();
    this.missing = new Set();
  }

  getStatus() {
    const total = Object.keys(SOUND_PATHS).length;
    const missing = [...this.missing];

    return {
      ready: this.buffers.size,
      total,
      missing,
      missingPaths: missing.map((kind) => SOUND_PATHS[kind]),
      isComplete: this.buffers.size === total,
    };
  }

  notify() {
    this.onStatusChange?.(this.getStatus());
  }

  ensureContext() {
    if (this.context) {
      return this.context;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    this.context = new AudioContextClass();
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.context.destination);

    return this.context;
  }

  async init() {
    if (typeof window === 'undefined') {
      return;
    }

    this.ensureContext();

    await Promise.all(
      Object.entries(SOUND_PATHS).map(([kind, path]) => this.load(kind, path)),
    );

    this.notify();
  }

  async load(kind, path) {
    try {
      const response = await fetch(path);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.arrayBuffer();
      const context = this.ensureContext();

      if (!context) {
        return;
      }

      const buffer = await context.decodeAudioData(data);
      this.buffers.set(kind, buffer);
      this.missing.delete(kind);
    } catch (error) {
      this.buffers.delete(kind);
      this.missing.add(kind);
    }

    this.notify();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));

    if (this.gain) {
      this.gain.gain.value = this.volume;
    }
  }

  /**
   * El navegador bloquea el audio hasta que el usuario interactuo con la
   * pagina, por eso hay que destrabar el AudioContext en el primer click.
   */
  unlock() {
    const context = this.ensureContext();

    if (context && context.state === 'suspended') {
      context.resume().catch(() => {});
    }
  }

  play(kind) {
    if (!this.enabled) {
      return;
    }

    const buffer = this.buffers.get(kind);
    const context = this.ensureContext();

    if (!buffer || !context) {
      return;
    }

    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }

    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      source.start();
    } catch (error) {
      console.warn('[audio] No se pudo reproducir el efecto.', error);
    }
  }
}
