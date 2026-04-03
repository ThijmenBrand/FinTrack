import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SQLite requires this for Prisma in serverless environments
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
