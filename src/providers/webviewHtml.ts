import * as vscode from 'vscode';

export interface WebviewHtmlOptions {
  readonly extensionUri: vscode.Uri;
  readonly title: string;
  readonly view: string;
  readonly initialData?: unknown;
}

export function createWebviewHtml(webview: vscode.Webview, options: WebviewHtmlOptions): string {
  const nonce = createNonce();
  const scriptUri = getWebviewAssetUri(webview, options.extensionUri, 'index.js');
  const styleUri = getWebviewAssetUri(webview, options.extensionUri, 'index.css');
  const initialDataScript =
    options.initialData === undefined ? 'undefined' : JSON.stringify(options.initialData);

  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>${escapeHtml(options.title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      window.__STORYBOARD_VIEW__ = ${JSON.stringify(options.view)};
      window.__STORYBOARD_INITIAL_DATA__ = ${initialDataScript};
    </script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
}

export function getWebviewDistRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'out', 'webview-ui');
}

function getWebviewAssetUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  filename: string,
): vscode.Uri {
  return webview.asWebviewUri(
    vscode.Uri.joinPath(getWebviewDistRoot(extensionUri), 'assets', filename),
  );
}

function createNonce(): string {
  const possibleCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const nonceLength = 32;
  let nonce = '';

  for (let index = 0; index < nonceLength; index += 1) {
    nonce += possibleCharacters.charAt(Math.floor(Math.random() * possibleCharacters.length));
  }

  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
