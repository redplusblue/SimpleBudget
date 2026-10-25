/** Browsers ask for /favicon.ico on their own; point them at the SVG icon instead of answering 404. */
export function GET() {
  // A relative Location: behind a proxy or on another host name, the browser resolves it against the address it used.
  return new Response(null, { status: 308, headers: { location: "/icon.svg" } });
}
