import * as vscode from "vscode"

import { createWebviewHtml, getWebviewDistRoot } from "./webviewHtml"

const sidebarViewType = "storyboard.sidebar"

export class SidebarPlaceholderProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewDistRoot(this.extensionUri)]
    }

    webviewView.webview.html = createWebviewHtml(webviewView.webview, {
      extensionUri: this.extensionUri,
      title: "Storyboard",
      view: "sidebar-placeholder"
    })
  }
}

export function registerSidebarPlaceholderProvider(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.window.registerWebviewViewProvider(
    sidebarViewType,
    new SidebarPlaceholderProvider(context.extensionUri)
  )
}
