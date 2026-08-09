import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep Turbopack rooted on this app (home directory has a stray package-lock.json)
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
