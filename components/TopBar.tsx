"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthStatus from "@/components/AuthStatus";
import LangChooser from "@/components/LangChooser";
import CommandK from "@/components/CommandK";
import { EntityKey, ENTITY_ORDER, ENTITY_SHORT, ENTITY_ACCENT } from "@/lib/entities";
import { ROLES, RoleKey } from "@/lib/roles";
import BrandMark from "@/components/BrandMark";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { setEntity as setEntityCtx, setRole as setRoleCtx, onCtx, writeCookie, readEntityCookie } from "@/lib/ctx";

export default function TopBar() {
  const [entity, setEntity] = useState<EntityKey>(() => {
    const c = readEntityCookie() as EntityKey | null;
    return c && (ENTITY_ORDER as string[]).includes(c) ? (c as EntityKey) : "utopia";
  });
  const [role, setRole] = useState<RoleKey>("office");
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname() || "";
  const pillarActive: "develop" | "execute" | "administrate" | "grow" | null =
    pathname.startsWith("/develop") ? "develop" :
    pathname.startsWith("/execute") ? "execute" :
    pathname.startsWith("/administrate") ? "administrate" :
    pathname.startsWith("/grow") ? "grow" : null;
  const [menu, setMenu] = useState(false);

  // load profile once
  useEffect(() => { getMyProfile().then((p) => { setProfile(p); setLoaded(true); }); }, []);

  // keep entity/role + accent in sync with localStorage / other components
  useEffect(() => {
    const read = () => {
      const e = (localStorage.getItem("fs_entity") as EntityKey | null) || (readEntityCookie() as EntityKey | null) || "utopia";
      const r = (localStorage.getItem("fs_role") as RoleKey | null) || "office";
      setEntity(e); setRole(r); writeCookie(e);
      const ua = localStorage.getItem("fs_user_accent");
      document.documentElement.style.setProperty("--accent", ua || ENTITY_ACCENT[e] || "#B8552E");
    };
    read();
    return onCtx(read);
  }, []);

  const isAdmin = !!profile?.isAdmin;
  const scoped = !!profile && !profile.isAdmin;          // a worker bound to one venue
  const canSwitch = isAdmin || !profile;                  // admins + signed-out preview
  const isOffice = isAdmin || role === "office";          // pillars nav for office view
  const pick = (k: EntityKey) => { setEntityCtx(k); setEntity(k); setMenu(false); };

  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center"><BrandMark entity={entity} variant="mark" tone="light" /></Link>

        <div className="flex items-center gap-3">
          <CommandK />

          {/* entity context — top-right. Switcher for admins/preview, locked label for a scoped worker */}
          {loaded && canSwitch ? (
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-1.5 rounded-full border border-black/15 px-3 py-1.5 font-sans text-[12px] text-ink-soft transition hover:border-ink/40">
                <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_ACCENT[entity] }} />
                {ENTITY_SHORT[entity]}
                <span className="text-clay">▾</span>
              </button>
              {menu ? (
                <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-card shadow-xl shadow-black/15">
                  {ENTITY_ORDER.map((k) => (
                    <button key={k} onClick={() => pick(k)} className={"flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[13px] transition hover:bg-paper " + (k === entity ? "text-ink" : "text-ink-soft")}>
                      <span className="h-2 w-2 rounded-full" style={{ background: ENTITY_ACCENT[k] }} />
                      {ENTITY_SHORT[k]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {loaded && scoped ? (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-sans text-[12px] text-[#EFEEEB]" style={{ background: ENTITY_ACCENT[entity] }}>
              <span className="h-2 w-2 rounded-full bg-white/70" />
              {ENTITY_SHORT[entity]}
            </span>
          ) : null}

          <LangChooser />
          <AuthStatus />
        </div>
      </div>

      {/* Pillars — the four temporal pillars of the OS. Visible to Office (admins) as the top-level org map. */}
      {loaded && isOffice ? (
        <nav className="mx-auto flex max-w-3xl items-center gap-4 border-t border-black/5 px-6 py-1.5 font-mono text-[10px] uppercase tracking-wide">
          <Link href="/develop/menu-engineering" className={(pillarActive === "develop" ? "text-ink font-semibold" : "text-clay") + " hover:text-ink"}>Develop</Link>
          <Link href="/execute/pass" className={(pillarActive === "execute" ? "text-ink font-semibold" : "text-clay") + " hover:text-ink"}>Execute</Link>
          <Link href="/administrate/finance" className={(pillarActive === "administrate" ? "text-ink font-semibold" : "text-clay") + " hover:text-ink"}>Administrate</Link>
          <Link href="/grow" className={(pillarActive === "grow" ? "font-semibold" : "hover:text-ink") + " text-tomato"}>Grow</Link>
        </nav>
      ) : null}

      {/* admin "view as" role line — admins preview each world; workers don't see this */}
      {loaded && isAdmin ? (
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 pb-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">View as</span>
          {(Object.keys(ROLES) as RoleKey[]).map((k) => (
            <button key={k} onClick={() => { setRoleCtx(k); setRole(k); }} className={"rounded-full px-2.5 py-0.5 font-sans text-[11px] transition " + (k === role ? "text-[#EFEEEB]" : "text-ink-soft hover:text-ink")} style={k === role ? { background: "var(--accent)" } : undefined}>{ROLES[k].label}</button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
