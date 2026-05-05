const path = require("path")

/** @type {import("tailwindcss").Config} */
module.exports = {
  content: [path.join(__dirname, "src/**/*.{ts,tsx,css}")],
  theme: {
    extend: {
      colors: {
        sb: {
          bg: "var(--vscode-editor-background)",
          "bg-sidebar": "var(--vscode-sideBar-background)",
          "bg-input": "var(--vscode-input-background)",
          "bg-button": "var(--vscode-button-background)",
          "bg-button-hover": "var(--vscode-button-hoverBackground)",
          "bg-list-hover": "var(--vscode-list-hoverBackground)",
          "bg-widget": "var(--vscode-editorWidget-background)",
          fg: "var(--vscode-foreground)",
          "fg-muted": "var(--vscode-descriptionForeground)",
          "fg-error": "var(--vscode-errorForeground)",
          "fg-button": "var(--vscode-button-foreground)",
          "fg-input": "var(--vscode-input-foreground)",
          "fg-link": "var(--vscode-textLink-foreground)",
          border: "var(--vscode-panel-border)",
          "border-focus": "var(--vscode-focusBorder)",
          "border-warning": "var(--vscode-notificationsWarningIcon-foreground)",
          parchment: "rgba(251, 243, 219, 0.08)",
          accent: {
            character: {
              DEFAULT: "#d97706",
              muted: "rgba(217, 119, 6, 0.35)",
              glow: "rgba(251, 191, 36, 0.22)"
            },
            background: {
              DEFAULT: "#0d9488",
              muted: "rgba(13, 148, 136, 0.35)",
              glow: "rgba(45, 212, 191, 0.2)"
            }
          }
        }
      },
      fontFamily: {
        sans: ["var(--sb-font-sans)", "var(--vscode-font-family)", "system-ui", "sans-serif"],
        display: ["var(--sb-font-display)", "Georgia", "serif"]
      },
      boxShadow: {
        cardRest:
          "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.12)",
        cardHover:
          "inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 14px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.04)"
      },
      backgroundImage: {
        cardCharacter:
          "radial-gradient(ellipse 120% 80% at 20% 0%, rgba(217,119,6,0.28) 0%, transparent 52%), radial-gradient(ellipse 90% 60% at 100% 100%, rgba(127,29,29,0.18) 0%, transparent 45%)",
        cardBackground:
          "radial-gradient(ellipse 110% 70% at 15% 10%, rgba(13,148,136,0.26) 0%, transparent 50%), radial-gradient(ellipse 100% 80% at 90% 90%, rgba(67,56,202,0.16) 0%, transparent 48%)"
      },
      keyframes: {
        cardEntrance: {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" }
        }
      },
      animation: {
        cardEntrance: "cardEntrance 0.45s ease-out both",
        shimmer: "shimmer 2.2s ease-in-out infinite"
      }
    }
  },
  plugins: [require("@tailwindcss/container-queries")]
}
