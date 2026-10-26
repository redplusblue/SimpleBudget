/* GitHub Pages demo shim. Loaded before the app's scripts. The pages are saved server renders of the real app;
 * this file answers the app's /api requests from JSON saved at build time (demo/build.mjs) and refuses writes. */
(function () {
  var base = window.__SB_DEMO_BASE || "";
  var realFetch = window.fetch.bind(window);
  var manifest = null;

  function key(pathname, search) {
    var p = new URLSearchParams(search);
    var sorted = new URLSearchParams(Array.from(p.entries()).sort());
    var qs = sorted.toString();
    return pathname + (qs ? "?" + qs : "");
  }
  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } });
  }
  function loadManifest() {
    if (!manifest) {
      manifest = realFetch(base + "/demo-data/manifest.json").then(function (r) {
        return r.json();
      });
    }
    return manifest;
  }

  window.fetch = function (input, init) {
    var url;
    try {
      url = new URL(
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input),
        location.href,
      );
    } catch {
      return realFetch(input, init);
    }
    if (url.origin !== location.origin) return realFetch(input, init);

    // Client-side navigation asks the server for a React payload that a static site cannot give: say so and the
    // router falls back to a normal page load.
    if (url.searchParams.has("_rsc")) return Promise.resolve(new Response("", { status: 404 }));

    var path = url.pathname.indexOf(base) === 0 ? url.pathname.slice(base.length) : url.pathname;
    if (path.indexOf("/api/") !== 0) return realFetch(input, init);

    var method = ((init && init.method) || (input instanceof Request && input.method) || "GET").toUpperCase();
    if (method !== "GET") {
      return Promise.resolve(
        json(403, {
          error: "demo",
          message: "This is a read-only demo with fake data. Run SimpleBudget yourself to make changes.",
        }),
      );
    }
    return loadManifest().then(function (m) {
      var file = m[key(path, url.search)];
      if (!file) return json(404, { error: "not_found", message: "That view isn't included in the demo." });
      return realFetch(base + "/demo-data/" + file).then(function (r) {
        return r.json().then(function (entry) {
          return json(entry.status, entry.body);
        });
      });
    });
  };

  // The app's offline cache would register at the site root, which isn't ours here.
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = function () {
      return Promise.reject(new Error("Service workers are off in the demo"));
    };
  }

  function banner() {
    var el = document.createElement("div");
    el.textContent = "Demo with fake data · read-only · ";
    el.id = "sb-demo-banner";
    var css = document.createElement("style");
    css.textContent =
      "#sb-demo-banner{position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#111827;color:#f9fafb;" +
      "font:12px/1.4 system-ui,sans-serif;padding:6px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.35)}" +
      "@media (max-width:1023px){#sb-demo-banner{left:50%;right:auto;transform:translateX(-50%);" +
      "bottom:calc(env(safe-area-inset-bottom,0px) + 76px);white-space:nowrap}}";
    document.documentElement.appendChild(css);
    var a = document.createElement("a");
    a.href = "https://github.com/redplusblue/SimpleBudget";
    a.textContent = "Get the code";
    a.style.cssText = "color:#93c5fd;text-decoration:underline";
    el.appendChild(a);
    // Attached to <html>, not <body>, so it never disturbs React's hydration of the page.
    document.documentElement.appendChild(el);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner);
  else banner();
})();
