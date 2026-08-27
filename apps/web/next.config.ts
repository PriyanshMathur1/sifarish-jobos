import type { NextConfig } from "next";
import { config as loadDotenv } from "dotenv";
import path from "node:path";

// Monorepo root .env (Vercel injects env directly, so this is a local-dev aid).
loadDotenv({ path: path.join(__dirname, "../../.env") });

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@jobos/core", "@jobos/db"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
