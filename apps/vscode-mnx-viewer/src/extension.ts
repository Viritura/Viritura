import * as path from "node:path";
import * as vscode from "vscode";
import { buildPreviewHtml } from "./previewHtml";

const PREVIEW_COLUMN = vscode.ViewColumn.Beside;
const CUSTOM_EDITOR_VIEW_TYPE = "viritura.mnxViewer";

function findDocument(target?: vscode.Uri): vscode.TextDocument | undefined {
  if (target) {
    return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === target.toString());
  }
  return vscode.window.activeTextEditor?.document;
}

function isMnxDocument(document: vscode.TextDocument): boolean {
  return path.extname(document.fileName).toLowerCase() === ".mnx";
}

export function activate(context: vscode.ExtensionContext): void {
  const panels = new Map<string, vscode.WebviewPanel>();

  const postDocument = (panel: vscode.WebviewPanel, document: vscode.TextDocument): void => {
    void panel.webview.postMessage({
      type: "document",
      fileName: path.basename(document.fileName),
      text: document.getText(),
    });
  };

  const setupPreviewPanel = (
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
    onDispose?: () => void,
  ): void => {
    const fileName = path.basename(document.fileName);
    const key = document.uri.toString();

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    };

    panel.webview.html = buildPreviewHtml({
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "viewer.js")).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "viewer.css")).toString(),
      assetBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media")).toString(),
      cspSource: panel.webview.cspSource,
      fileName,
    });

    const messageSubscription = panel.webview.onDidReceiveMessage((message: unknown) => {
      if (typeof message === "object" && message !== null && "type" in message && message.type === "ready") {
        postDocument(panel, document);
      }
    });

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === key) {
        postDocument(panel, event.document);
      }
    });

    panel.onDidDispose(() => {
      changeSubscription.dispose();
      messageSubscription.dispose();
      onDispose?.();
    });
  };

  const openPreview = async (target?: vscode.Uri): Promise<void> => {
    let document = findDocument(target);

    if (target && !document) {
      document = await vscode.workspace.openTextDocument(target);
    }

    if (!document || !isMnxDocument(document)) {
      void vscode.window.showWarningMessage("Open a .mnx file to preview.");
      return;
    }

    const key = document.uri.toString();
    const existingPanel = panels.get(key);
    const fileName = path.basename(document.fileName);

    if (existingPanel) {
      existingPanel.reveal(PREVIEW_COLUMN, true);
      postDocument(existingPanel, document);
      return;
    }

    const panel = vscode.window.createWebviewPanel("mnxPreview", `MNX Preview: ${fileName}`, PREVIEW_COLUMN, {
      enableFindWidget: true,
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    });

    panels.set(key, panel);
    setupPreviewPanel(panel, document, () => {
      panels.delete(key);
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("mnxViewer.openPreview", (uri?: vscode.Uri) => openPreview(uri)),
    vscode.window.registerCustomEditorProvider(
      CUSTOM_EDITOR_VIEW_TYPE,
      {
        resolveCustomTextEditor(document, panel) {
          setupPreviewPanel(panel, document);
        },
      },
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: {
          enableFindWidget: true,
        },
      },
    ),
  );
}

export function deactivate(): void {
  // no-op
}
