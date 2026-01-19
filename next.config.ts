import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel Serverless에서 네이티브 모듈 지원
  serverExternalPackages: ["mupdf", "canvas", "sharp"],

  // API 요청 본문 크기 제한 증가 (50MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
