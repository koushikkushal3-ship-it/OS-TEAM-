// TEAM OS service worker: only what installing needs. Pages and data always come from
// the network, so nobody ever sees stale permissions or someone else's cached work.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
