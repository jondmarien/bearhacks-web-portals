import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bearhacks/config", "@bearhacks/api-client"],
};

export default nextConfig;
