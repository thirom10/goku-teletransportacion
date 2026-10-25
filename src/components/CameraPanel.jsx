export default function CameraPanel({
  devices,
  selectedDeviceId,
  onDeviceChange,
  onStart,
  onStop,
  isActive,
  isSupported,
  isSecure,
}) {
  return (
    <div className="control-card">
      <span className="section-label">Cámara</span>
      <label className="field-label" htmlFor="camera-device">
        Seleccionar cámara
      </label>
      <select
        id="camera-device"
        value={selectedDeviceId}
        onChange={onDeviceChange}
        disabled={!isSupported || !isSecure}
      >
        {devices.length === 0 ? <option value="">Cámara predeterminada</option> : null}
        {devices.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {device.label || `Cámara ${index + 1}`}
          </option>
        ))}
      </select>
      <div className="button-row">
        <button type="button" className="primary-button" onClick={onStart} disabled={isActive}>
          Iniciar cámara
        </button>
        <button type="button" className="ghost-button" onClick={onStop} disabled={!isActive}>
          Detener cámara
        </button>
      </div>
    </div>
  );
}
