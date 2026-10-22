"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Cpu, Swords, Users, Volume2, VolumeX } from "lucide-react";
import { playResult, setSoundEnabled, soundEnabled } from "../lib/sounds";

export function ArenaTopbar({ children }: { children?: ReactNode }) {
  return <header className="topbar"><a href="/" className="brand"><span className="brand-icon"><Swords size={21} /></span>Gesto Arena</a><nav className="top-actions"><SoundToggle />{children}</nav></header>;
}

/** Mutes the round-result sounds; the choice is remembered in this browser. */
function SoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(soundEnabled()), []);
  function toggle() {
    setSoundEnabled(!on);
    setOn(!on);
    // A short preview confirms sound is back on (and unlocks audio with this click).
    if (!on) playResult("draw");
  }
  return <button className="help-button" aria-pressed={on} onClick={toggle}>{on ? <Volume2 size={17} /> : <VolumeX size={17} />}<span className="top-label">{on ? "Sonido" : "Sin sonido"}</span></button>;
}

const tabs = [
  { id: "cpu", href: "/", icon: <Cpu size={22} />, title: "1P vs CPU", detail: "Contra la computadora" },
  { id: "friends", href: "/salas", icon: <Users size={22} />, title: "Con amigos", detail: "Duelos y torneos en línea" },
] as const;

/** Mode select shared by the solo arena and the rooms page. */
export function ModeTabs({ current }: { current: (typeof tabs)[number]["id"] }) {
  return <nav className="mode-selector" aria-label="Modo de juego">{tabs.map(tab => <a key={tab.id} href={tab.href} aria-current={current === tab.id ? "page" : undefined}><span>{tab.icon}<strong>{tab.title}</strong><small>{tab.detail}</small></span></a>)}</nav>;
}
