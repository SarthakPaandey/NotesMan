import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ['pdf-parse', '@huggingface/transformers', '@libsql/client'],
};

export default nextConfig;
