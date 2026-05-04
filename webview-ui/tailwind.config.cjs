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
          "border-warning": "var(--vscode-notificationsWarningIcon-foreground)"
        }
      }
    }
  },
  plugins: []
}
