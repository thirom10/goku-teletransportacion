export default function VisibilityPanel({
  onToggle,
  disabled,
  isInvisible,
  transitionDuration,
  onTransitionChange,
}) {
  return (
    <div className="control-card">
      <span className="section-label">Visibilidad</span>
      <button type="button" className="visibility-button" onClick={onToggle} disabled={disabled}>
        {isInvisible ? 'Aparecer' : 'Desaparecer'}
      </button>
      <label className="range-label" htmlFor="transition-duration">
        Transición: {transitionDuration} ms
      </label>
      <input
        id="transition-duration"
        type="range"
        min="250"
        max="500"
        step="10"
        value={transitionDuration}
        onChange={(event) => onTransitionChange(Number(event.target.value))}
      />
    </div>
  );
}
