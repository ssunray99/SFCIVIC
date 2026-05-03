import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Include the SF neighborhood/district geojson assets when tracing the
  // /api/locate route for Vercel deployment. geo.ts loads them via readFileSync
  // relative to its own __dirname; without this the files may be excluded from
  // the serverless function bundle and the point-in-polygon lookup would fail.
  outputFileTracingIncludes: {
    '/api/locate': ['./scraper/data/*.geojson'],
  },
};

export default nextConfig;
