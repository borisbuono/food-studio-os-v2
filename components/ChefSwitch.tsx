"use client";

// Chef switch — reads ?slim=1 or localStorage.fs_chef_slim=1 and renders
// the slim rebuild, otherwise the legacy AssistantFab. Ships zero-risk:
// production stays on the legacy component until Boris flips the flag.
//
// Flag persistence: once ?slim=1 is seen in the URL, we save to
// localStorage so the flag survives navigation and PWA reopen. Set
// ?slim=0 to opt back out (also cleared from localStorage).

import { useEffect, useState } from "react";
import AssistantFab from "@/components/AssistantFab";
import ChefSlim from "@/components/ChefSlim";

export default function ChefSwitch() {
  const [slim, setSlim] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlFlag = params.get("slim");
      if (urlFlag === "1") { localStorage.setItem("fs_chef_slim", "1"); setSlim(true); }
      else if (urlFlag === "0") { localStorage.removeItem("fs_chef_slim"); setSlim(false); }
      else { setSlim(localStorage.getItem("fs_chef_slim") === "1"); }
    } catch { setSlim(false); }
    setReady(true);
  }, []);

  if (!ready) return null; // avoid double-mount flash
  return slim ? <ChefSlim /> : <AssistantFab />;
}
