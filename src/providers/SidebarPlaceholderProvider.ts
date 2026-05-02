import * as vscode from "vscode"

const sidebarViewType = "storyboard.sidebar"

export class SidebarPlaceholderProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out", "webview-ui")]
    }

    webviewView.webview.html = this.getHtml(webviewView.webview)
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = createNonce()
    const scriptUri = getWebviewAssetUri(webview, this.extensionUri, "index.js")
    const styleUri = getWebviewAssetUri(webview, this.extensionUri, "index.css")

    return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Storyboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`
  }
}

export function registerSidebarPlaceholderProvider(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.window.registerWebviewViewProvider(
    sidebarViewType,
    new SidebarPlaceholderProvider(context.extensionUri)
  )
}

function getWebviewAssetUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  filename: string
): vscode.Uri {
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "webview-ui", "assets", filename)
  )
}

function createNonce(): string {
  const possibleCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const nonceLength = 32
  let nonce = ""

  for (let index = 0; index < nonceLength; index += 1) {
    nonce += possibleCharacters.charAt(Math.floor(Math.random() * possibleCharacters.length))
  }

  return nonce
}
