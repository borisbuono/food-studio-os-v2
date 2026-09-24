"use client";

// Chef switch — ChefSlim is now the DEFAULT (2026-08-30). The legacy
// AssistantFab still ships in the tree in case Boris wants to A/B a
// specific behaviour that got dropped in the rebuild.
//
// Flag semantics (URL wins over localStorage, both persist):
//   ?slim=0   → legacy AssistantFab (also writes fs_chef_slim=0)
//   ?slim=1   → slim (also clears the opt-out flag)
//   (default) → slim, unless fs_chef_slim=0 was set previously
//
// Ships zero-risk: navigate to any page with ?slim=0 to revert. Same file
// path as the original switch so the layout.tsx import doesn't change.
//
// Option A (2026-09-24):
//   • Route gate now shares lib/routing/public-routes with AppChrome, so the
//     FAB never renders on /welcome, /onboard/*, /book/*, /apply/*,
//     /recipes/*, /login, /auth/*, /m/*. Before, only /apply/* was excluded
//     and signed-out visitors on /welcome got a Chef button.
//   • AssistantFab is loaded with next/dynamic so the 1,400-line retired
//     component is NOT in the default bundle — only fetched when ?slim=0.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import ChefSlim from "@/components/ChefSlim";
import { isChefHiddenRoute } from "@/lib/routing/public-routes";

const AssistantFab = dynamic(() => import("@/components/AssistantFab"), { ssr: false });

export default function ChefSwitch() {
  const [useLegacy, setUseLegacy] = useState(false);
  const [ready, setReady] = useState(false);
  const pathname = usePathname() || "";

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlFlag = params.get("slim");
      if (urlFlag === "0") {
        localStorage.setItem("fs_chef_slim", "0");
        setUseLegacy(true);
      } else if (urlFlag === "1") {
        localStorage.removeItem("fs_chef_slim");
        setUseLegacy(false);
      } else {
        setUseLegacy(localStorage.getItem("fs_chef_slim") === "0");
      }
    } catch {
      setUseLegacy(false);
    }
    setReady(true);
  }, []);

  if (!ready) return null; // avoid double-mount flash
  // Public / signed-out surfaces: no staff assistant floating over them.
  if (isChefHiddenRoute(pathname)) return null;
  return useLegacy ? <AssistantFab /> : <ChefSlim />;
}
