import { useCallback, useEffect, useRef, useState } from 'react';

const VIDEO_CONSTRAINTS = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 30, max: 30 },
};

function getCameraErrorMessage(error) {
  if (error?.name === 'NotAllowedError') {
    return 'Permiso de cámara denegado. Revisá los permisos del navegador.';
  }

  if (error?.name === 'NotFoundError') {
    return 'No se encontró una cámara disponible.';
  }

  if (error?.name === 'NotReadableError') {
    return 'La cámara está en uso por otra aplicación o no se puede abrir.';
  }

  return error?.message || 'No se pudo iniciar la cámara.';
}

export function useCamera(videoRef) {
  const streamRef = useRef(null);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState('Cámara detenida.');
  const [error, setError] = useState('');

  const isSupported = Boolean(navigator.mediaDevices?.getUserMedia);
  const isSecure = window.isSecureContext;

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return [];
    }

    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const cameras = allDevices.filter((device) => device.kind === 'videoinput');
    setDevices(cameras);

    // Functional update keeps this callback stable; a stale selectedDeviceId dep
    // would re-run the mount effect and call stopCamera() on every selection.
    setSelectedDeviceId((previous) => previous || cameras[0]?.deviceId || '');

    return cameras;
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
    }

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setIsActive(false);
    setStatus('Cámara detenida.');
  }, [videoRef]);

  const startCamera = useCallback(
    async (deviceId = selectedDeviceId) => {
      setError('');

      if (!isSupported) {
        const message = 'Este navegador no expone acceso a cámara mediante getUserMedia.';
        setError(message);
        setStatus(message);
        return false;
      }

      if (!isSecure) {
        const message = 'La cámara requiere HTTPS o localhost para funcionar.';
        setError(message);
        setStatus(message);
        return false;
      }

      try {
        stopCamera();
        setStatus('Solicitando acceso a cámara...');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...VIDEO_CONSTRAINTS,
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
          audio: false,
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setIsActive(true);
        setStatus('Cámara activa.');
        await refreshDevices();
        return true;
      } catch (cameraError) {
        stopCamera();
        const message = getCameraErrorMessage(cameraError);
        setError(message);
        setStatus(message);
        return false;
      }
    },
    [isSecure, isSupported, refreshDevices, selectedDeviceId, stopCamera, videoRef],
  );

  useEffect(() => {
    refreshDevices().catch(() => {
      setDevices([]);
    });

    const handleDeviceChange = () => {
      refreshDevices().catch(() => {
        setDevices([]);
      });
    };

    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);

    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
      stopCamera();
    };
  }, [refreshDevices, stopCamera]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    isActive,
    isSecure,
    isSupported,
    status,
    error,
    startCamera,
    stopCamera,
    refreshDevices,
  };
}
