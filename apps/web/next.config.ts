import type { NextConfig } from "next";
import { resolve } from "node:path";

const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3001";

const config: NextConfig = {
  transpilePackages: ["@interview-kit/schema", "@interview-kit/logic"],
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  rewrites() {
    return Promise.resolve([{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }]);
  },
};

export default config;
