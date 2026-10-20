import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gesto Arena · Piedra, papel o tijera",
  description: "Tu mano es el control. Juega piedra, papel o tijera contra la computadora con tu cámara.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
