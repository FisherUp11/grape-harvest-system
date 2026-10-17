import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthLinkBridge from "./components/AuthLinkBridge";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#24391f",
};

export const metadata: Metadata = {
  title: "收葡萄系统",
  description: "承诺支持、收葡萄、吃葡萄与葡萄存量管理",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthLinkBridge />
        {children}
      </body>
    </html>
  );
}
