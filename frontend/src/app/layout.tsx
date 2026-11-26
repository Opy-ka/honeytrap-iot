import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HoneyTrap IoT - Threat Intelligence",
  description: "Dashboard for HoneyTrap IoT network honeypot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
        <script dangerouslySetInnerHTML={{__html: `
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          "colors": {
            "secondary-fixed-dim": "#ffb2ba",
            "surface-container-low": "#f3f3f3",
            "surface-variant": "#e2e2e2",
            "on-tertiary-fixed": "#002022",
            "primary-fixed-dim": "#00e55b",
            "on-secondary-container": "#fffbff",
            "tertiary-container": "#55f2ff",
            "error": "#ba1a1a",
            "on-error": "#ffffff",
            "tertiary-fixed": "#7df4ff",
            "background": "#f9f9f9",
            "inverse-primary": "#00e55b",
            "on-tertiary": "#ffffff",
            "on-surface": "#1b1b1b",
            "on-tertiary-fixed-variant": "#004f54",
            "inverse-on-surface": "#f1f1f1",
            "surface-container-highest": "#e2e2e2",
            "secondary-container": "#e31754",
            "on-tertiary-container": "#006c73",
            "primary-fixed": "#6bff83",
            "surface-dim": "#dadada",
            "on-primary-fixed-variant": "#00531b",
            "surface-container-high": "#e8e8e8",
            "tertiary-fixed-dim": "#00dbe9",
            "on-secondary-fixed": "#400011",
            "on-background": "#1b1b1b",
            "error-container": "#ffdad6",
            "surface-bright": "#f9f9f9",
            "outline": "#6b7c68",
            "primary": "#006e27",
            "on-secondary": "#ffffff",
            "on-primary": "#ffffff",
            "on-secondary-fixed-variant": "#910030",
            "surface-container-lowest": "#ffffff",
            "primary-container": "#00ff66",
            "surface": "#f9f9f9",
            "tertiary": "#006970",
            "on-primary-fixed": "#002107",
            "on-primary-container": "#007128",
            "inverse-surface": "#303030",
            "on-error-container": "#93000a",
            "secondary": "#b90040",
            "surface-container": "#eeeeee",
            "outline-variant": "#b9ccb5",
            "on-surface-variant": "#3b4b3a",
            "surface-tint": "#006e27",
            "secondary-fixed": "#ffd9dc"
          },
          "borderRadius": {
            "DEFAULT": "0.25rem",
            "lg": "0.5rem",
            "xl": "0.75rem",
            "full": "9999px"
          },
          "spacing": {
            "space-md": "1rem",
            "space-lg": "1.5rem",
            "space-sm": "0.5rem",
            "margin": "2rem",
            "margin-sm": "1rem",
            "gutter": "1.5rem",
            "gutter-sm": "1rem",
            "space-xs": "0.25rem",
            "space-xl": "2.5rem"
          },
          "fontFamily": {
            "headline-lg": ["Space Grotesk"],
            "display-lg-mobile": ["Space Grotesk"],
            "code-sm": ["JetBrains Mono"],
            "title-md": ["Space Grotesk"],
            "headline-lg-mobile": ["Space Grotesk"],
            "code-md": ["JetBrains Mono"],
            "body-lg": ["Space Grotesk"],
            "label-md": ["JetBrains Mono"],
            "display-lg": ["Space Grotesk"],
            "headline-md": ["Space Grotesk"],
            "label-sm": ["JetBrains Mono"],
            "code-lg": ["JetBrains Mono"],
            "body-md": ["Space Grotesk"]
          },
          "fontSize": {
            "headline-lg": ["32px", { "lineHeight": "36px", "letterSpacing": "-0.02em", "fontWeight": "700" }],
            "display-lg-mobile": ["32px", { "lineHeight": "36px", "letterSpacing": "-0.03em", "fontWeight": "700" }],
            "code-sm": ["11px", { "lineHeight": "14px", "letterSpacing": "0.02em", "fontWeight": "500" }],
            "title-md": ["18px", { "lineHeight": "24px", "letterSpacing": "0em", "fontWeight": "700" }],
            "headline-lg-mobile": ["24px", { "lineHeight": "28px", "letterSpacing": "-0.02em", "fontWeight": "700" }],
            "code-md": ["13px", { "lineHeight": "18px", "letterSpacing": "0em", "fontWeight": "500" }],
            "body-lg": ["16px", { "lineHeight": "24px", "letterSpacing": "0em", "fontWeight": "500" }],
            "label-md": ["12px", { "lineHeight": "16px", "letterSpacing": "0.08em", "fontWeight": "700" }],
            "display-lg": ["48px", { "lineHeight": "52px", "letterSpacing": "-0.04em", "fontWeight": "700" }],
            "headline-md": ["22px", { "lineHeight": "28px", "letterSpacing": "-0.01em", "fontWeight": "700" }],
            "label-sm": ["10px", { "lineHeight": "12px", "letterSpacing": "0.1em", "fontWeight": "700" }],
            "code-lg": ["15px", { "lineHeight": "22px", "letterSpacing": "-0.01em", "fontWeight": "600" }],
            "body-md": ["14px", { "lineHeight": "20px", "letterSpacing": "0em", "fontWeight": "500" }]
          }
        }
      }
    }
  `}} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
