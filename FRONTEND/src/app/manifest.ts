import type { MetadataRoute } from "next";

/** Lets people add TEAM OS to their phone's home screen like an app — no app store. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TEAM OS",
    short_name: "TEAM OS",
    description: "Your organization's work portal",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#0f766e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
