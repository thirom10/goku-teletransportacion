# Goku Cam Web

App web para "teletransportarte" en cámara: calibrás un fondo vacío, apretás **Desaparecer** y la segmentación de persona (MediaPipe, 100% local) reemplaza tus píxeles por los del fondo calibrado. React + Vite + JavaScript, sin backend, cuentas, IA remota, Electron, OBS, Teams ni drivers virtuales.

## Camino rápido

1. `npm install`
2. `npm run assets` — descarga modelos oficiales y copia el WASM a `public/` (requiere red la primera vez).
3. `npm run dev` — Vite sirve en `http://localhost:5173` (o la URL que imprima).
4. Abrí la URL en un navegador, iniciá la cámara, salí del encuadre, tocá **Calibrar fondo** y esperá los 4 segundos.
5. Volvé al encuadre y tocá **Desaparecer**. Para volver, **Aparecer**.

La cámara solo funciona en contexto seguro: `localhost` o HTTPS. En un servidor LAN sin HTTPS el navegador bloquea `getUserMedia` y la app lo avisa.

## Qué hace y cómo

| Parte | Decisión |
| --- | --- |
| Cámara | `useCamera` pide permiso, lista dispositivos, inicia/detiene y libera todos los tracks al detener. |
| Calibración | 4 s de countdown, 15 muestras cada 90 ms, mediana temporal por píxel en memoria. No se persiste al cerrar la pestaña; recalibrar sobrescribe. |
| Segmentación | `ImageSegmenter` (DeepLabV3) en modo VIDEO a ~5-6 Hz (cada 180 ms). Máscara de categoría VOC `person` (índice 15); si el modelo expone máscaras de confianza se usan preferentemente. La máscara se considera vencida a los 900 ms y la UI lo indica. |
| Compositor | Mezcla píxeles de la persona con el fondo calibrado según la máscara suavizada (blur de borde + umbral/softness) y el progreso de transición. La referencia del fondo nunca se modifica. Sin calibración o con máscara vencida se muestra el frame original y la UI avisa. |
| Visibilidad | Un único `toggleVisibility()` compartido por el botón manual y el gesto. Transición final configurable de 250–500 ms (ease in/out) aplicada solo al compuesto. |
| Gesto | `HandLandmarker` a ~6 Hz. Gesto de Goku = índice y medio extendidos (anular y meñique doblados) cerca de la frente, estimada con un landmark real del `Face Landmarker` (índice 10, ajustado hacia arriba). Confirmación con hold de 550 ms, alterna exactamente una vez y exige retirar la mano del encuadre (cero manos detectadas) antes de rearmar. Detectar una mano NO alterna. |
| FPS | Medido en runtime (ventana de 500 ms), no es un valor fijo. |
| UI | Oscura, compacta y responsive: original y procesado lado a lado, estados de cámara/fondo/segmentación/gesto y errores visibles. |

El procesamiento vive en `src/services`, `src/hooks` y `src/utils`; los componentes de `src/components` son presentacionales y no contienen lógica de visión.

## Assets locales (sin CDN en runtime)

La app solo carga `/wasm` y `/models` desde el servidor local. `npm run assets`:

| Asset | Destino | Fuente oficial |
| --- | --- | --- |
| WASM de Tasks Vision | `public/wasm/*` | Copia desde `node_modules/@mediapipe/tasks-vision@1.1.1/wasm` (resuelto vía el subpath exportado `./vision_wasm_internal.js`; el paquete no exporta `./package.json`). Espejo documentado: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm/`. |
| DeepLabV3 Image Segmenter | `public/models/deeplabv3.tflite` | `https://storage.googleapis.com/mediapipe-assets/deeplabv3.tflite?generation=1661875711618421` |
| Hand Landmarker | `public/models/hand_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` |
| Face Landmarker | `public/models/face_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` |

Si faltan assets, la app no falla en silencio: la UI muestra "Ejecutá `npm run assets` y reiniciá el servidor".

## Verificación

- `npm run build` — build de producción con Vite.
- La prueba de webcam en vivo **no es posible en CI/headless**: no hay dispositivo de cámara ni permisos de navegador. La validación real es la lista manual de abajo.

## Limitaciones conocidas

- **Reconstrucción del fondo**: se reemplaza por la imagen mediana calibrada; objetos que se muevan después de calibrar quedan "congelados" en esa referencia.
- **Halogas de borde**: la segmentación tiene borde imperfecto; el suavizado reduce anillos pero no los elimina. Ropa del mismo color que el fondo empeora la máscara.
- **MediaPipe síncrono**: `detectForVideo`/`segmentForVideo` corren en el hilo principal y bloquean la UI mientras infieren (~10-40 ms por llamada según máquina). Web Workers con `OffscreenCanvas` queda como trabajo futuro.
- **Umbral de máscara**: umbral/softness fijos (`maskThreshold: 0.3`, `maskSoftness: 0.35`); pueden necesitar ajuste según iluminación.
- **Frente estimada**: usa el landmark 10 de Face Landmarker con un pequeño offset; funciona de frente, puede fallar de perfil o con la cabeza inclinada.
- **Estabilidad de 5 minutos**: no probada en CI; se recomienda una pasada manual larga en máquina real.
- **Gesto de una sola mano**: `numHands: 1`; si otra persona muestra la mano, puede disparar el gesto.

## Checklist de prueba manual

- [ ] Abrir en `localhost` o HTTPS; en contexto inseguro debe avisar que la cámara requiere HTTPS.
- [ ] Denegar permiso de cámara: error claro, sin botones rotos.
- [ ] Elegir cámara, iniciar y detener; confirmar que al detener se apagan los tracks (LED de la webcam).
- [ ] Intentar **Calibrar fondo** sin cámara: advertencia y no arranca.
- [ ] Con cámara activa, salir del encuadre, esperar el countdown de 4 s y verificar "Fondo calibrado".
- [ ] **Desaparecer** con iluminación normal; la persona debe fundirse con el fondo sin mutar la referencia (recalibrar y verificar que el fondo sigue igual).
- [ ] **Aparecer** de vuelta; la transición dura lo configurado en el slider (250-500 ms).
- [ ] Ropa de color similar al fondo: verificar que la UI sigue siendo usable (posibles huecos en la máscara).
- [ ] Bajar la luz / subir la luz de golpe durante la transición: sin crashes; la máscara puede degradar.
- [ ] Mover cabeza y manos rápido: sin freezes largos; el FPS medido refleja la máquina.
- [ ] Activar gesto; índice y medio cerca de la frente; confirmar los estados "Buscando mano" → "Gesto detectado" → "Gesto confirmado" y que alterna UNA sola vez.
- [ ] Mantener el gesto sin retirar la mano: no debe repetir el toggle.
- [ ] Retirar la mano del encuadre y repetir el gesto: debe volver a alternar.
- [ ] Sin rostro visible (tapar la cara), el gesto no confirma.
- [ ] Tocar **Desaparecer** sin calibrar: botón habilitado solo con cámara; muestra el pedido de calibrar y no alterna.
- [ ] Cambiar de cámara con una calibración vieja: exige recalibrar.
- [ ] Desconectar la cámara física o tapar el lente un rato: estados visibles, sin pantalla congelada permanente.
- [ ] Cerrar la pestaña con la cámara activa: el navegador libera la cámara (LED off).
