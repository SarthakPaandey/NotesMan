import type { Metadata } from "next";
import "./styles/globals.css";

export const metadata: Metadata = {
  title: "Production RAG - Hybrid Search & Citations Assistant",
  description: "Enterprise-grade local RAG Knowledge Base. Upload documents, crawl URLs, ask cited questions, evaluate retrievals, and inspect telemetry in real-time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

