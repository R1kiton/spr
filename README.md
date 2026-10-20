# Gesto Arena

Juego de piedra, papel o tijera con Next.js, TypeScript y MediaPipe Gesture Recognizer. Incluye juego local y salas en línea con Supabase. El reconocimiento funciona en el dispositivo, sin servidor de inteligencia artificial.

## Salas con amigos

Abre **Jugar con amigos** o `/salas`. Para crear una sala o unirse por código solo hace falta un nombre: no hay cuentas, correos, contraseñas ni inicio de sesión.

- De 2 a 4 jugadores en **Todos contra todos**, o 4 jugadores en **Equipos 2 contra 2**. Cada quien usa su propio dispositivo.
- El anfitrión elige una partida de **3 o 5 rondas**, invita con un código de 6 caracteres o un enlace y comienza la partida.
- En equipos, cada persona puede elegir su lado antes de empezar. Se requieren dos personas por equipo.
- Cada ronda da **20 segundos** para confirmar un gesto con botones o con la cámara. La cámara es opcional, procesa localmente y no transmite video.
- Las jugadas quedan guardadas y ocultas hasta que todos confirmen o venza el tiempo. No se pueden cambiar después de enviarlas.
- Cada jugador suma 1 punto por cada rival vencido; en equipos solo se comparan rivales y se suman los puntos del equipo. Un gesto válido vence a quien no envió jugada. Los empates también cuentan como ronda.
- Se juegan todas las rondas elegidas; gana la puntuación acumulada más alta, con victoria compartida si hay empate. Después se puede preparar otra partida.
- Una cookie privada conserva el lugar del jugador al recargar. Las plazas del lobby se liberan tras 60 segundos sin actividad. Si el anfitrión se desconecta, otro jugador activo toma su lugar. Salir durante una partida devuelve a los demás al lobby.
- Las salas caducan después de 24 horas sin actividad. El juego local sigue funcionando sin configurar Supabase.

### Configurar Supabase y Vercel

1. Ejecuta `supabase/rooms.sql` como administrador en el proyecto de Supabase. Crea únicamente el esquema privado `gesto_private` y la función pública `gesto_room_store`; no modifica tablas de otras aplicaciones. Mantén `gesto_private` fuera de los esquemas expuestos por la Data API.
2. Copia `.env.example` a `.env.local` y configura `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `ROOM_SERVER_SECRET`. Genera este último con 32 bytes aleatorios en hexadecimal. Las tres variables se usan exclusivamente en el servidor y no llevan el prefijo `NEXT_PUBLIC_`.
3. Guarda el SHA-256 de `ROOM_SERVER_SECRET` en la base de datos, sustituyendo el marcador por el hash (nunca por el secreto original):

```sql
insert into gesto_private.server_config (singleton, server_key_hash)
values (true, '<sha256-hex-del-secreto>')
on conflict (singleton)
do update set server_key_hash = excluded.server_key_hash;
```

4. Configura las mismas variables en Vercel y despliega como proyecto Next.js. El sitio de producción debe ser público para que los invitados accedan sin una cuenta de Vercel.

El navegador solo llama a `/api/rooms`; las tablas no admiten acceso directo con la clave pública. El servidor valida la sesión invitada y los permisos de cada acción. Supabase actualiza el estado con control de versión para impedir sobrecupos, sobrescritura de jugadas y puntuaciones duplicadas. El cliente consulta la sala cada 1,2 segundos mientras está visible.

Verificación de salas con el servidor ejecutándose:

```bash
npm test
npm run typecheck
node --env-file=.env.local scripts/test-rooms-api.mjs
# También acepta una URL desplegada como argumento.
```

La prueba de integración usa sesiones invitadas independientes y comprueba entradas simultáneas, máximo de cuatro, aislamiento, permisos, jugadas ocultas y partidas completas de 3 y 5 rondas. No necesita cuentas de prueba.

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
