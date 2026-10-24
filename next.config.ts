import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "argon2"],
  poweredByHeader: false,
};

export default nextConfig;
