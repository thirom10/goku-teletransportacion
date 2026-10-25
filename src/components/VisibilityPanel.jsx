export default function VisibilityPanel({
  onToggle,
  disabled,
  isInvisible,
  transitionDuration,
  onTransitionChange,
  effectEnabled,
  onEffectChange,
  soundEnabled,
  onSoundChange,
  volume,
  onVolumeChange,
  audioStatus,
}) {
  const missingFiles = audioStatus?.missingPaths || [];

  return (
    <div className="control-card">
      <span className="section-label">Visibilidad</span>
      <button type="button" className="visibility-button" onClick={onToggle} disabled={disabled}>
        {isInvisible ? 'Aparecer' : 'Desaparecer'}
      </button>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={effectEnabled}
          onChange={(event) => onEffectChange(event.target.checked)}
        />
        <span>Efecto anime</span>
      </label>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={soundEnabled}
          onChange={(event) => onSoundChange(event.target.checked)}
        />
        <span>Sonido</span>
      </label>
      <label className="range-label" htmlFor="transition-duration">
        Transición: {transitionDuration} ms
      </label>
      <input
        id="transition-duration"
        type="range"
        min="250"
        max="900"
        step="10"
        value={transitionDuration}
        onChange={(event) => onTransitionChange(Number(event.target.value))}
      />
      <label className="range-label" htmlFor="sound-volume">
        Volumen: {Math.round(volume * 100)}%
      </label>
      <input
        id="sound-volume"
        type="range"
        min="0"
        max="100"
        step="5"
        value={Math.round(volume * 100)}
        onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
        disabled={!soundEnabled}
      />
      {missingFiles.length > 0 ? (
        <p className="audio-warning">
          Faltan: {missingFiles.join(' · ')}
        </p>
      ) : null}
    </div>
  );
}
