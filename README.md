# Gesto Arena

Juego de piedra, papel o tijera con Next.js, TypeScript y MediaPipe Gesture Recognizer. No necesita servidor de inteligencia artificial, base de datos ni claves de API.

## Ejecutar

Requisitos: Node.js 20.9 o superior y npm.

```bash
npm install
npm run dev
```

Abre http://localhost:3000. Pulsa **Activar cámara**, permite su uso y después **Jugar una ronda**. Durante los 3 segundos de cuenta regresiva forma uno de estos gestos:

| Gesto | Jugada |
| --- | --- |
| Puño cerrado | Piedra |
| Palma abierta | Papel |
| Índice y medio formando V | Tijera |

Usa una sola mano, con la palma hacia la cámara y buena iluminación. Mantén el gesto al menos 350 ms antes de terminar la cuenta. La confianza mínima es 65%. Las rondas sin una señal estable no cuentan.

**Probar sin cámara** permite jugar con botones. Incluye marcador, empates, últimas cinco rondas y reinicio. El marcador vive en memoria y se borra al recargar.

## Dos personas

Selecciona **Dos personas** antes de activar la cámara. Ambos jugadores usan la misma cámara y computadora:

1. Jugador 1 muestra una mano a la izquierda de la imagen que ve en pantalla.
2. Jugador 2 muestra una mano a la derecha de esa imagen.
3. Pulsa **Jugar una ronda** y mantengan ambos gestos al terminar los 3 segundos.

Los lados se asignan por posición en pantalla, no por mano derecha o izquierda. Eviten cruzar las manos o colocarlas en el centro. Se requieren dos gestos estables para contar la ronda. El marcador y el historial indican quién ganó; al cambiar de modo se reinician y se desactiva la cámara. El modo manual corresponde únicamente al juego contra la computadora.

## Funcionamiento

- `app/page.tsx`: interfaz, cámara, reconocimiento y ciclo de cada ronda.
- `lib/game.ts`: gestos admitidos, elección aleatoria y reglas.
- `public/mediapipe`: modelo y runtime WASM servidos por la aplicación.
- `tests/game.test.ts`: las nueve combinaciones de resultados y validación de gestos.

La computadora elige aleatoriamente antes de capturar la jugada del usuario. No consulta el gesto reconocido para elegir. El reconocimiento analiza hasta unos 12 fotogramas por segundo en el dispositivo; no se envían ni almacenan imágenes. Al cambiar de pestaña, desactivar la cámara o salir de la página se detiene la cámara y se cancela la ronda activa.

## Validación y producción

```bash
npm test
npm run typecheck
npm run build
npm start
```

Para desplegar, usa un servicio compatible con Next.js (por ejemplo Vercel) o un servidor Node.js. La cámara requiere **HTTPS** fuera de `localhost`; abrir la dirección HTTP de tu computadora desde un teléfono no es suficiente. Prueba preferentemente en Chrome o Edge actualizados. La detección real depende de la cámara, iluminación y capacidad del dispositivo.

Los archivos del modelo y WASM están incluidos. Si actualizas `@mediapipe/tasks-vision`, ejecuta `npm run sync:mediapipe` para sincronizar el runtime. Este script también redirige únicamente el aviso `INFO: Created TensorFlow Lite XNNPACK delegate for CPU.` a `console.info`: MediaPipe lo escribe originalmente mediante `console.error`, lo que activa el panel de errores de Next.js en desarrollo. Los demás mensajes de error se conservan.

## Recursos

- [Guía oficial de MediaPipe Gesture Recognizer](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer/web_js).
- [Modelo oficial de Google, versión 1 float16](https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task).
- [Repositorio y licencia de MediaPipe](https://github.com/google-ai-edge/mediapipe).

La interfaz usa Lucide y las fuentes DM Sans y Space Grotesk de Google Fonts, con fuentes del sistema como respaldo.
