function clamp01(value) {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function createRandom(seed) {
  let state = (seed >>> 0) || 1;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const BAND_STAGGER = 0.45;
const BAND_SPAN = 0.5;
const STREAK_PROFILE = [0.12, 0.45, 1, 0.45, 0.12];

/**
 * Efecto de teletransportacion estilo anime.
 *
 * La persona se corta en bandas verticales que se van abriendo una detras de
 * otra, mientras aparecen lineas de velocidad verticales y las formas negras
 * tipograficas del manga. Todo se dibuja sobre el frame ya compuesto.
 */
export class TeleportEffect {
  constructor({ bandCount = 7, streakCount = 22, shardCount = 6 } = {}) {
    this.bandCount = bandCount;
    this.streakCount = streakCount;
    this.shardCount = shardCount;
    this.anchor = { x: 0, y: 0, width: 0, height: 0 };
    this.bands = [];
    this.streaks = [];
    this.shards = [];
    this.phase = 0;
    this.active = false;
  }

  begin(anchor, seed, frameWidth = 640) {
    const random = createRandom(seed ?? Math.floor(Math.random() * 1e9));

    this.frameWidth = frameWidth;
    this.anchor = {
      x: anchor.x,
      y: anchor.y,
      width: Math.max(16, anchor.width),
      height: Math.max(16, anchor.height),
    };
    this.phase = 0;
    this.active = true;

    this.buildBands(random);
    this.buildStreaks(random);
    this.buildShards(random);
  }

  /**
   * Mantiene el efecto anclado sobre la persona si se mueve durante la
   * transicion (los cortes se desplazan con ella).
   */
  follow(anchor) {
    if (!this.active || !anchor) {
      return;
    }

    const dx = anchor.x - this.anchor.x;
    const dy = anchor.y - this.anchor.y;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      return;
    }

    this.anchor = {
      x: anchor.x,
      y: anchor.y,
      width: Math.max(16, anchor.width),
      height: Math.max(16, anchor.height),
    };

    // Las bandas cortan el frame entero, asi que no se mueven con la persona.
    // Solo se desplazan los elementos visuales anclados en ella.
    for (const streak of this.streaks) {
      streak.x += dx;
      streak.top += dy;
      streak.bottom += dy;
    }

    for (const shard of this.shards) {
      shard.points = shard.points.map(([x, y]) => [x + dx, y + dy]);
    }
  }

  /**
   * Actualiza el estado de cada banda segun la fase global (0..1) y devuelve
   * los factores que usa el compositor para recortar a la persona.
   *
   * El recorte es seco (no un fundido) para que se lea como un corte de
   * laminas: la persona sigue entera hasta que pasa el filo de la banda.
   */
  update(phase) {
    this.phase = clamp01(phase);

    const count = this.bands.length;

    for (const band of this.bands) {
      const delay = count > 1 ? (band.order / (count - 1)) * BAND_STAGGER : 0;
      const local = clamp01((this.phase - delay) / BAND_SPAN);

      band.factor = clamp01((local - 0.45) / 0.3);
      band.flash = Math.sin(Math.PI * clamp01((local - 0.3) / 0.6));
    }

    return this.bands;
  }

  render(context, frameHeight) {
    if (!context || !this.active) {
      return;
    }

    const phase = this.phase;

    // Con la transicion terminada el frame tiene que quedar impecable:
    // no se dibuja absolutely nada (ni el destello final, que se apagaria
    // a destiempo y dejaba un velo lechoso sobre la persona invisible).
    if (phase <= 0.001 || phase >= 0.999) {
      return;
    }

    const streakEnvelope = clamp01(phase / 0.12) * clamp01((1 - phase) / 0.22);
    const shardEnvelope = clamp01((phase - 0.03) / 0.09) * clamp01((0.68 - phase) / 0.28);
    const flashEnvelope = clamp01((phase - 0.76) / 0.12) * clamp01((1 - phase) / 0.08);

    context.save();
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;

    if (shardEnvelope > 0.01) {
      this.renderShards(context, shardEnvelope);
    }

    if (streakEnvelope > 0.01) {
      this.renderStreaks(context, streakEnvelope, frameHeight);
    }

    this.renderCutLines(context, frameHeight);
    this.renderEdgeGlow(context);

    if (flashEnvelope > 0.01) {
      this.renderFinalFlash(context, flashEnvelope);
    }

    context.restore();
  }

  /**
   * Las bandas cortan el frame ENTERO (asi el estado final es exactamente el
   * fondo calibrado, como en la version original de la app) pero el orden de
   * corte arranca en la persona y se propaga hacia los costados.
   */
  buildBands(random) {
    const bands = [];
    const count = Math.max(4, this.bandCount);
    const widths = [];
    let total = 0;

    for (let index = 0; index < count; index += 1) {
      const width = (this.frameWidth / count) * (0.7 + random() * 0.6);
      widths.push(width);
      total += width;
    }

    const scale = total > 0 ? this.frameWidth / total : 1;
    let cursor = 0;
    const anchorCenter = this.anchor.x + this.anchor.width / 2;

    for (let index = 0; index < count; index += 1) {
      const width = widths[index] * scale;
      const center = cursor + width / 2;
      bands.push({
        x0: cursor,
        x1: cursor + width,
        order: index,
        factor: 0,
        flash: 0,
        distance: Math.abs(center - anchorCenter),
      });
      cursor += width;
    }

    // Orden de corte: de la persona hacia afuera.
    const ranking = bands
      .map((band, index) => ({ index, key: band.distance + random() * this.frameWidth * 0.12 }))
      .sort((first, second) => first.key - second.key);

    ranking.forEach((entry, rank) => {
      bands[entry.index].order = rank;
    });

    this.bands = bands;
  }

  buildStreaks(random) {
    const streaks = [];
    const { x, y, width, height } = this.anchor;

    for (let index = 0; index < this.streakCount; index += 1) {
      const streakX = x - width * 0.22 + random() * width * 1.44;
      const thickness = 1 + random() * 2.6;
      const top = y - height * (0.3 + random() * 0.6);
      const bottom = y + height * (0.8 + random() * 0.55);

      streaks.push({
        x: streakX,
        thickness,
        top,
        bottom,
        alpha: 0.3 + random() * 0.7,
      });
    }

    this.streaks = streaks;
  }

  buildShards(random) {
    const shards = [];
    const { x, y, width, height } = this.anchor;

    for (let index = 0; index < this.shardCount; index += 1) {
      const left = x + random() * width * 0.92;
      const right = left + width * (0.08 + random() * 0.24);
      const top = y - height * (0.1 + random() * 0.4);
      const bottom = y + height * (0.45 + random() * 0.65);
      const segments = 3 + Math.floor(random() * 3);
      const points = [];

      for (let step = 0; step <= segments; step += 1) {
        const ratio = step / segments;
        const jitter = (random() - 0.5) * width * 0.14;
        points.push([left + jitter, lerp(top, bottom, ratio)]);
      }

      for (let step = segments; step >= 0; step -= 1) {
        const ratio = step / segments;
        const jitter = (random() - 0.5) * width * 0.12;
        points.push([right + jitter, lerp(top, bottom, ratio)]);
      }

      shards.push({ points, alpha: 0.55 + random() * 0.45 });
    }

    this.shards = shards;
  }

  renderShards(context, envelope) {
    context.fillStyle = 'rgba(3, 5, 11, 0.94)';

    for (const shard of this.shards) {
      const points = shard.points;

      if (points.length < 3) {
        continue;
      }

      context.globalAlpha = clamp01(envelope * shard.alpha);
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);

      for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index][0], points[index][1]);
      }

      context.closePath();
      context.fill();
    }

    context.globalAlpha = 1;
  }

  renderStreaks(context, envelope, frameHeight) {
    for (const streak of this.streaks) {
      const alpha = clamp01(envelope * streak.alpha);
      const top = Math.max(-24, streak.top);
      const bottom = Math.min(frameHeight + 24, streak.bottom);
      const height = bottom - top;

      if (height <= 4) {
        continue;
      }

      const slice = height / STREAK_PROFILE.length;

      for (let index = 0; index < STREAK_PROFILE.length; index += 1) {
        context.globalAlpha = clamp01(alpha * STREAK_PROFILE[index]);
        context.fillStyle = index === Math.floor(STREAK_PROFILE.length / 2) ? '#ffffff' : '#bfe9ff';
        context.fillRect(streak.x - streak.thickness / 2, top + slice * index, streak.thickness, slice + 1);
      }
    }

    context.globalAlpha = 1;
  }

  renderCutLines(context, frameHeight) {
    const { x, y, width, height } = this.anchor;
    const top = Math.max(0, y - height * 0.35);
    const bottom = Math.min(frameHeight, y + height * 1.35);
    const lineHeight = Math.max(2, bottom - top);
    const left = x - width * 0.35;
    const right = x + width * 1.35;

    for (const band of this.bands) {
      if (band.flash <= 0.02) {
        continue;
      }

      // Las lineas de luz se concentran sobre la persona (asi como en el anime).
      const cut = band.x0;

      if (cut < left || cut > right) {
        continue;
      }

      const alpha = band.flash;

      context.fillStyle = 'rgba(90, 220, 255, 0.9)';
      context.globalAlpha = alpha * 0.3;
      context.fillRect(cut - 9, top, 18, lineHeight);

      context.fillStyle = 'rgba(205, 246, 255, 0.95)';
      context.globalAlpha = alpha * 0.6;
      context.fillRect(cut - 3, top, 6, lineHeight);

      context.fillStyle = '#ffffff';
      context.globalAlpha = clamp01(alpha);
      context.fillRect(cut - 1, top, 2, lineHeight);
    }

    context.globalAlpha = 1;
  }

  renderEdgeGlow(context) {
    // El destello tiene que terminar en cero: si queda encendido se convierte
    // en un velo permanente sobre el frame ya limpio.
    const alpha = Math.sin(Math.PI * clamp01((this.phase - 0.7) / 0.3));
    const { x, y, width, height } = this.anchor;

    if (alpha <= 0.01) {
      return;
    }

    const glow = context.createLinearGradient(x, y, x + width, y);
    glow.addColorStop(0, 'rgba(120, 235, 255, 0)');
    glow.addColorStop(0.5, `rgba(190, 250, 255, ${alpha * 0.5})`);
    glow.addColorStop(1, 'rgba(120, 235, 255, 0)');

    context.globalAlpha = 1;
    context.fillStyle = glow;
    context.fillRect(x - 6, y - 6, width + 12, height + 12);
  }

  renderFinalFlash(context, envelope) {
    const { x, y, width, height } = this.anchor;

    context.globalAlpha = clamp01(envelope * 0.4);
    context.fillStyle = '#ffffff';
    context.fillRect(x - 10, y - 10, width + 20, height + 20);

    context.globalAlpha = 1;
  }
}
