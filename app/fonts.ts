import { Caveat, Geist, Geist_Mono, Kalam } from "next/font/google";

export const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
});

export const kalam = Kalam({ variable: "--font-kalam", subsets: ["latin"], weight: ["300", "400", "700"], display: "swap" });
