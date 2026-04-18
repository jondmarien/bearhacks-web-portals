import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const devConnectSrc = isDev
  ? " http://127.0.0.1:8000 http://localhost:8000 ws://localhost:3000 ws://127.0.0.1:3000"
  : "";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@bearhacks/config",
    "@bearhacks/api-client",
    "@bearhacks/logger",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://api.bearhacks.com https://*.supabase.co${devConnectSrc}; frame-ancestors 'none'; base-uri 'self';`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
