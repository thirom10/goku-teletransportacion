export default function PreviewGrid({ videoRef, processedCanvasRef, width, height, cameraStatus, isInvisible }) {
  return (
    <section className="preview-grid" aria-label="Previsualizaciones de video">
      <article className="preview-card">
        <div className="preview-header">
          <span>Original</span>
          <small>{cameraStatus}</small>
        </div>
        <div className="video-frame">
          <video ref={videoRef} muted playsInline className="camera-preview" />
        </div>
      </article>

      <article className="preview-card accent-card">
        <div className="preview-header">
          <span>Procesado</span>
          <small>{isInvisible ? 'Invisible' : 'Visible'}</small>
        </div>
        <div className="video-frame">
          <canvas ref={processedCanvasRef} width={width} height={height} className="processed-preview" />
        </div>
      </article>
    </section>
  );
}
