import type { Metadata } from "next";
import "./globals.css";
import { brand } from "@/src/config/brand";
export const metadata: Metadata = { title: `${brand.name} — ${brand.description}`, description: brand.description, icons:{icon:"/favicon.svg"} };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="ar" dir="rtl"><body>{children}</body></html>; }
