export default function GesturePanel({ enabled, loading, disabled, onToggleChange, detail }) {
  return (
    <div className="control-card">
      <span className="section-label">Gesto</span>
      <label className="switch-row">
        <input type="checkbox" checked={enabled} onChange={onToggleChange} disabled={disabled} />
        <span>Activar gesto frente</span>
      </label>
      <p className="compact-copy">
        Gesto de Goku: índice y medio extendidos cerca de la frente. Se confirma después de un breve hold y solo
        alterna una vez por gesto.
      </p>
      {detail ? <p className="gesture-detail">{detail}</p> : null}
    </div>
  );
}
