import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel Serverless에서 네이티브 모듈 지원
  serverExternalPackages: ["mupdf", "canvas", "sharp"],
};

export default nextConfig;
