export default function StatusGrid({ cameraStatus, calibrationStatus, segmentationStatus, gestureStatus }) {
  return (
    <section className="status-grid" aria-label="Estado del sistema">
      <div>
        <span>Cámara</span>
        <strong>{cameraStatus}</strong>
      </div>
      <div>
        <span>Fondo</span>
        <strong>{calibrationStatus}</strong>
      </div>
      <div>
        <span>Segmentación</span>
        <strong>{segmentationStatus}</strong>
      </div>
      <div>
        <span>Gesto</span>
        <strong>{gestureStatus}</strong>
      </div>
    </section>
  );
}
