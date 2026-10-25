import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SimpleBudget",
    short_name: "Budget",
    description: "A self-hosted personal finance dashboard powered by SimpleFIN.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0B0D12",
    theme_color: "#0B0D12",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Transactions", url: "/transactions", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Spending", url: "/spending", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
