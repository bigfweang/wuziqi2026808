import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: "管理后台｜像素五子棋",
  description: "像素五子棋用户数据与账号管理后台。",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
