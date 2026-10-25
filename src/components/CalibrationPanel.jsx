export default function CalibrationPanel({ onCalibrate, disabled, hasBackground, countdown }) {
  return (
    <div className="control-card">
      <span className="section-label">Fondo</span>
      <p className="compact-copy">
        Salí del encuadre: la calibración captura un fondo vacío durante 4 segundos y calcula una mediana temporal.
      </p>
      <button type="button" className="primary-button" onClick={onCalibrate} disabled={disabled}>
        {hasBackground ? 'Recalibrar fondo' : 'Calibrar fondo'}
      </button>
      {countdown ? <div className="countdown">{countdown}</div> : null}
    </div>
  );
}
