import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gesto Arena · Piedra, papel o tijera",
  description: "Piedra, papel o tijera con cámara o botones. Crea salas sin cuentas para hasta 4 amigos, todos contra todos o en equipos de 2 contra 2.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
