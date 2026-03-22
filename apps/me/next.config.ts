import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bearhacks/config", "@bearhacks/api-client", "@bearhacks/logger"],
};

export default nextConfig;
