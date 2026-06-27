import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "收葡萄系统",
  description: "承诺支持、收葡萄、吃葡萄与葡萄存量管理",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
