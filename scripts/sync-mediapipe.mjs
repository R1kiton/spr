import { readdir, readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const destination = path.join(root, "public/mediapipe/wasm");
await mkdir(destination, { recursive: true });

// MediaPipe sends native stderr to console.error, including this INFO message.
// Route only this exact informational line to console.info. Keep real errors.
const original = "var err = console.error.bind(console);";
const replacement = `var err = function (...args) {
  if (args.length === 1 && typeof args[0] === "string" && args[0].trim() === "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.") {
    console.info(...args);
  } else {
    console.error(...args);
  }
};`;

for (const name of await readdir(source)) {
  if (name.endsWith(".js")) {
    const content = await readFile(path.join(source, name), "utf8");
    if (!content.includes(original)) throw new Error(`MediaPipe cambió su logger en ${name}; revisa la integración antes de actualizar.`);
    await writeFile(path.join(destination, name), content.replace(original, replacement));
  } else {
    await copyFile(path.join(source, name), path.join(destination, name));
  }
}
console.log("MediaPipe sincronizado. El aviso informativo de XNNPACK conserva su nivel INFO.");
