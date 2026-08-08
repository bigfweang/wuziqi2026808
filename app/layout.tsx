import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "像素五子棋", description: "和微信好友下一盘像素五子棋。" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#e6edd5" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
