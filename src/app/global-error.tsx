"use client";

/** Last resort when even the root layout fails; it can't rely on the app's styles or providers. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          background: "#0B0D12",
          color: "#E8EAF0",
          display: "grid",
          placeItems: "center",
          minHeight: "100dvh",
          margin: 0,
        }}
      >
        <div role="alert" style={{ maxWidth: 360, textAlign: "center", padding: 16 }}>
          <h1 style={{ fontSize: 20 }}>SimpleBudget hit a problem</h1>
          <p style={{ opacity: 0.8, fontSize: 14 }}>Reload the page to try again. Your data is safe.</p>
          <button
            onClick={reset}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #444",
              background: "#161A23",
              color: "inherit",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
