import { ImageResponse } from "next/og";

// The app's logo, drawn on request (a gradient tile with rising bars) so no binary assets live in the repo.
const SIZES: Record<string, { size: number; maskable: boolean }> = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: true }, // iOS rounds the corners itself
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((name) => ({ name }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const spec = SIZES[(await params).name];
  if (!spec) return new Response("Not found", { status: 404 });
  const { size, maskable } = spec;
  // Maskable icons keep their artwork inside the central 80% so any launcher mask can crop the edges.
  const art = size * (maskable ? 0.5 : 0.6);
  const bar = art / 5;
  const heights = [0.4, 0.62, 0.5, 0.82, 1];
  return new ImageResponse(
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #6366F1 0%, #22D3EE 100%)",
        borderRadius: maskable ? 0 : size * 0.22,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: bar * 0.3, height: art, width: art }}>
        {heights.map((h, i) => (
          <div
            key={i}
            style={{
              width: bar * 0.8,
              height: art * h,
              background: "rgba(255,255,255,0.95)",
              borderRadius: bar * 0.25,
            }}
          />
        ))}
      </div>
    </div>,
    { width: size, height: size, headers: { "cache-control": "public, max-age=31536000, immutable" } },
  );
}
