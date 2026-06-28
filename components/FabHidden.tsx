"use client";
import { useEffect } from "react";
// Mount inside any page (client or layout) where the FAB should disappear.
// Sets body[data-fab="hidden"] on mount, restores on unmount. The FAB reads this attribute.
export default function FabHidden() {
  useEffect(() => {
    const prev = document.body.getAttribute("data-fab");
    document.body.setAttribute("data-fab", "hidden");
    return () => {
      if (prev === null) document.body.removeAttribute("data-fab");
      else document.body.setAttribute("data-fab", prev);
    };
  }, []);
  return null;
}
