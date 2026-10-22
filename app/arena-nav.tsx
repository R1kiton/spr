import type { ReactNode } from "react";
import { Cpu, Swords, Users } from "lucide-react";

export function ArenaTopbar({ children }: { children?: ReactNode }) {
  return <header className="topbar"><a href="/" className="brand"><span className="brand-icon"><Swords size={21} /></span>Gesto Arena</a>{children && <nav className="top-actions">{children}</nav>}</header>;
}

const tabs = [
  { id: "cpu", href: "/", icon: <Cpu size={22} />, title: "1P vs CPU", detail: "Contra la computadora" },
  { id: "friends", href: "/salas", icon: <Users size={22} />, title: "Con amigos", detail: "Salas en línea, hasta 4" },
] as const;

/** Mode select shared by the solo arena and the rooms page. */
export function ModeTabs({ current }: { current: (typeof tabs)[number]["id"] }) {
  return <nav className="mode-selector" aria-label="Modo de juego">{tabs.map(tab => <a key={tab.id} href={tab.href} aria-current={current === tab.id ? "page" : undefined}><span>{tab.icon}<strong>{tab.title}</strong><small>{tab.detail}</small></span></a>)}</nav>;
}
