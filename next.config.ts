import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the engine ships as TypeScript source
  transpilePackages: ["@latex0/engine"],
};

export default nextConfig;
