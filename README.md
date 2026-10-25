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
| Segmentación | `ImageSegmenter` (DeepLabV3) en modo VIDEO. Solo se pide la **máscara de categoría** VOC `person` (índice 15): generar los 21 confidence masks multiplicaba por ~20 el costo por frame. Corre a ~2,6 Hz en reposo y ~9 Hz durante una transición. Se intenta delegate **GPU** con caída automática a CPU (y con lectura de máscara verificada al arrancar). La máscara se usa solo para **ubicar a la persona** (anclaje del efecto), no para el recorte. |
| Compositor | El estado "invisible" es el de la app original: **el frame en vivo se reemplaza entero por el fondo calibrado**, sin depender de la segmentación. Se resuelve con dos `drawImage` sobre canvas acelerado por GPU (sin `getImageData` ni loops por píxel): un fundido global y, durante la transición, el corte en bandas. La referencia del fondo nunca se modifica. Sin calibración se muestra el frame original. |
| Efecto anime | `TeleportEffect`: durante la transición el frame se corta en 7 bandas verticales que se abren en secuencia arrancando por la persona, con un filo de luz blanco/celeste, líneas de velocidad verticales que se extienden por encima y por debajo, formas negras angulosas estilo manga y un destello final. Las luces, líneas y formas se anclan en el bounding box de la persona detectada. Al terminar, el frame es 100% el fondo calibrado. Se puede apagar con el switch **Efecto anime** (vuelve el fundido simple). |
| Sonido | `TeleportAudioService` con Web Audio API. Reproduce un mp3 distinto al desaparecer y al aparecer, con volumen ajustable desde la UI. Los archivos van en `public/audio/`; si faltan, la app sigue funcionando y avisa en el panel de visibilidad. |
| Visibilidad | Un único `toggleVisibility()` compartido por el botón manual y el gesto. Transición final configurable de 250–900 ms (ease in/out). |
| Gesto | `HandLandmarker` a ~6,6 Hz con delegate GPU. Gesto de Goku = índice y medio extendidos (anular y meñique doblados) cerca de la frente, estimada con un landmark real del `Face Landmarker` (índice 10, ajustado hacia arriba). El Face Landmarker solo corre con la pose de dos dedos y a ~4 Hz, reutilizando el último rostro. Confirmación con hold de 550 ms, alterna exactamente una vez y exige retirar la mano del encuadre (cero manos detectadas) antes de rearmar. Detectar una mano NO alterna. |
| FPS | Medido en runtime (ventana de 500 ms), no es un valor fijo. El estado de segmentación muestra además si la inferencia es rápida, media, lenta o muy lenta. |
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

## Sonido

Los efectos de sonido son archivos locales que se cargan desde `public/audio/`:

| Evento | Archivo | URL servida |
| --- | --- | --- |
| Desaparecer | `public/audio/teleport-disappear.mp3` | `/audio/teleport-disappear.mp3` |
| Aparecer | `public/audio/teleport-appear.mp3` | `/audio/teleport-appear.mp3` |

Los nombres son los que espera el código (`src/services/audioService.js`). Si agregás o cambiás un archivo, recargá la página: el audio se precarga al arrancar. Si un archivo no existe, la app no falla: lo marca como faltante en el panel de visibilidad y sigue sin sonido.

El primer click en la página destraba el `AudioContext` (los navegadores bloquean el audio automático antes de una interacción).

## Ajustes de rendimiento

- `?delegate=cpu` fuerza el delegate CPU de MediaPipe (o `?delegate=gpu` para forzarlo). Por defecto se prueba GPU y se cae a CPU solo si no se puede crear la tarea o la máscara no se puede leer.
- La lectura de la máscara de categoría detecta el formato: con delegate CPU los bytes son los índices de categoría; con delegate GPU vienen escalados (índice × 255) y hay que releer los floats crudos del texture.
- El render corre siempre en `requestAnimationFrame`; la segmentación y el gesto se intercalan con intervalos adaptativos para no bloquear el hilo principal de forma constante.

## Limitaciones conocidas

- **Reconstrucción del fondo**: se reemplaza por la imagen mediana calibrada; objetos que se muevan después de calibrar quedan "congelados" en esa referencia.
- **Fondo congelado**: al desaparecer, el frame completo pasa a ser la imagen calibrada (igual que la app original): el fondo deja de moverse en vivo.
- **MediaPipe síncrono**: `detectForVideo`/`segmentForVideo` corren en el hilo principal y bloquean la UI mientras infieren. Web Workers con `OffscreenCanvas` queda como trabajo futuro.
- **Frente estimada**: usa el landmark 10 de Face Landmarker con un pequeño offset; funciona de frente, puede fallar de perfil o con la cabeza inclinada.
- **Estabilidad de 5 minutos**: no probada en CI; se recomienda una pasada manual larga en máquina real.
- **Gesto de una sola mano**: `numHands: 1`; si otra persona muestra la mano, puede disparar el gesto.

## Checklist de prueba manual

- [ ] Abrir en `localhost` o HTTPS; en contexto inseguro debe avisar que la cámara requiere HTTPS.
- [ ] Denegar permiso de cámara: error claro, sin botones rotos.
- [ ] Elegir cámara, iniciar y detener; confirmar que al detener se apagan los tracks (LED de la webcam).
- [ ] Intentar **Calibrar fondo** sin cámara: advertencia y no arranca.
- [ ] Con cámara activa, salir del encuadre, esperar el countdown de 4 s y verificar "Fondo calibrado".
- [ ] **Desaparecer** con iluminación normal; el frame procesado debe quedar con **únicamente el fondo calibrado** (nada de la persona) y el fondo no se modifica (recalibrar y verificar que el fondo sigue igual).
- [ ] **Aparecer** de vuelta; la transición dura lo configurado en el slider (250-900 ms).
- [ ] Con el switch **Efecto anime** activo: la persona debe cortarse en láminas verticales con líneas de luz, y el efecto debe aparecer anclado sobre vos (no en el centro de la pantalla).
- [ ] Con los mp3 en `public/audio/`: al desaparecer y al aparecer se escucha el sonido; el switch **Sonido** y el slider de volumen funcionan.
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
