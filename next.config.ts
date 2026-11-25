import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // yahoo-finance2 must run on the server only (Yahoo blocks browser CORS).
  serverExternalPackages: ["yahoo-finance2"],
  poweredByHeader: false,
  // Names the browser's data cache (src/lib/client.ts), so each deployment starts with an empty one.
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? `local-${Date.now()}` },
};

export default nextConfig;
