"use client";

import { useEffect } from "react";

/** Registers the minimal service worker so browsers offer "Install app" / "Add to Home screen". */
export function InstallApp() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
