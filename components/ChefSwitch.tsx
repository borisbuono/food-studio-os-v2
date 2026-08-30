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

import { useEffect, useState } from "react";
import AssistantFab from "@/components/AssistantFab";
import ChefSlim from "@/components/ChefSlim";

export default function ChefSwitch() {
  const [useLegacy, setUseLegacy] = useState(false);
  const [ready, setReady] = useState(false);

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
  return useLegacy ? <AssistantFab /> : <ChefSlim />;
}
