"use client";

// Home switch — same pattern as ChefSwitch. Reads ?slim=1 or
// localStorage.fs_chef_slim=1 and renders HomeSlim, otherwise HomeCompass.
// Both consume the same CompassData contract from the server component.

import { useEffect, useState } from "react";
import HomeCompass, { CompassData } from "@/components/HomeCompass";
import HomeSlim from "@/components/HomeSlim";

export default function HomeSwitch({ data }: { data: CompassData }) {
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

  if (!ready) return null;
  return slim ? <HomeSlim data={data} /> : <HomeCompass data={data} />;
}
