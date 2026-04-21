import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Java Graph MVP",
  description: "Frontend für den Java Submission Graph MVP",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {`try { const theme = localStorage.getItem("theme"); if (theme === "dark") { document.documentElement.classList.add("dark"); document.documentElement.style.colorScheme = "dark"; } else { document.documentElement.classList.remove("dark"); document.documentElement.style.colorScheme = "light"; } } catch (e) { document.documentElement.classList.remove("dark"); document.documentElement.style.colorScheme = "light"; }`}
        </Script>
        {children}
      </body>
    </html>
  );
}
