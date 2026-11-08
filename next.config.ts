import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // yahoo-finance2 must run on the server only (Yahoo blocks browser CORS).
  serverExternalPackages: ["yahoo-finance2"],
  poweredByHeader: false,
};

export default nextConfig;
