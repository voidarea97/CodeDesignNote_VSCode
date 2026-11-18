'use strict';

const vscode = require('vscode');
const { isDesignDocument, locationLabel } = require('./format');
const { locationUri, uriKey } = require('./index');

function isCodeEditor(editor) {
  return Boolean(editor && !editor.document.isUntitled && !isDesignDocument(editor.document.uri.path) &&
    vscode.workspace.getWorkspaceFolder(editor.document.uri));
}

function panelHtml(webview, media) {
  const asset = name => webview.asWebviewUri(vscode.Uri.joinPath(media, name));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource};">
  <link rel="stylesheet" href="${asset('panel.css')}">
  <title>代码批注</title>
</head>
<body>
  <header>
    <div class="location">
      <h1 id="file">代码批注</h1>
      <span id="line"></span>
    </div>
    <div class="toolbar" id="toolbar" hidden>
      <div class="modes" role="group" aria-label="批注范围">
        <button type="button" id="current" aria-pressed="true">当前行</button>
        <button type="button" id="file-notes" aria-pressed="false">此文件</button>
      </div>
      <button type="button" id="add" class="primary">添加说明</button>
    </div>
  </header>
  <main id="notes" aria-label="设计说明"><p class="empty" role="status">正在加载批注…</p></main>
  <script src="${asset('panel.js')}"></script>
</body>
</html>`;
}

class DesignPanel {
  constructor(context, index, addNote) {
    this.media = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.index = index;
    this.addNote = addNote;
    this.markdown = new WeakMap();
    this.destinations = new Map();
    this.subscriptions = vscode.Disposable.from(
      index.onDidChange(() => this.update()),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (isCodeEditor(editor)) {
          this.source = editor;
          this.update();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => {
        if (textEditor === this.source) {
          this.update();
        }
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (document === this.source?.document) {
          this.source = vscode.window.visibleTextEditors.find(isCodeEditor);
          this.update();
        }
      })
    );
  }

  open(editor) {
    if (isCodeEditor(editor)) {
      this.source = editor;
    } else if (!isCodeEditor(this.source)) {
      this.source = vscode.window.visibleTextEditors.find(isCodeEditor);
    }
    if (this.panel) {
      this.panel.reveal(undefined, true);
      this.update();
      return;
    }
    const panel = vscode.window.createWebviewPanel('codedoc.notes', '代码批注', {
      viewColumn: this.source ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      preserveFocus: Boolean(this.source)
    }, { enableScripts: true, localResourceRoots: [this.media] });
    this.panel = panel;
    this.ready = false;
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.pending = undefined;
      this.sentKey = undefined;
      this.destinations.clear();
    });
    panel.onDidChangeViewState(() => {
      if (panel.visible) {
        this.update();
      } else {
        this.ready = false;
        this.pending = undefined;
        this.sentKey = undefined;
      }
    });
    panel.webview.onDidReceiveMessage(message => {
      void this.receive(message).catch(error => vscode.window.showErrorMessage(`代码批注：${error.message}`));
    });
    panel.webview.html = panelHtml(panel.webview, this.media);
  }

  async receive(message) {
    if (message?.type === 'ready') {
      this.ready = true;
      this.sentKey = undefined;
      this.update();
    } else if (message?.type === 'add') {
      await this.addNote(this.source);
    } else if (message?.type === 'jump') {
      const destination = this.destinations.get(message.id);
      if (destination) {
        await this.jump(destination);
      }
    }
  }

  async jump({ uri, line, label }) {
    let document;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      throw new Error(`无法打开 ${label}。请检查路径。`);
    }
    if (line < 1 || line > document.lineCount) {
      throw new Error(`${label} 的行号已超出文件范围。请更新批注中的行号。`);
    }
    const openEditor = vscode.window.visibleTextEditors.find(editor => uriKey(editor.document.uri) === uriKey(uri));
    const column = openEditor?.viewColumn ?? this.source?.viewColumn;
    const viewColumn = column && column !== this.panel?.viewColumn ? column : vscode.ViewColumn.Beside;
    const selection = new vscode.Range(line - 1, 0, line - 1, 0);
    const editor = await vscode.window.showTextDocument(document, { viewColumn, selection, preview: false });
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  renderMarkdown(note) {
    if (!this.markdown.has(note)) {
      const html = note.body.trim() ? Promise.resolve(vscode.commands.executeCommand('markdown.api.render', note.body))
        .then(result => typeof result === 'string' ? result : null, () => null) : Promise.resolve(null);
      this.markdown.set(note, html);
    }
    return this.markdown.get(note);
  }

  update() {
    if (!this.panel?.visible || !this.ready) {
      return;
    }
    const source = isCodeEditor(this.source) ? this.source : undefined;
    const key = `${this.index.revision}:${source ? uriKey(source.document.uri) : ''}`;
    if (key === this.sentKey) {
      this.pending = undefined;
      void this.panel.webview.postMessage({ type: 'line', line: source ? source.selection.active.line + 1 : 0 });
    } else if (this.pending?.key !== key) {
      const request = { key };
      this.pending = request;
      void this.sendFile(request, source).catch(error => console.error('CodeDoc:', error));
    }
  }

  async sendFile(request, source) {
    const destinations = new Map();
    const entries = source ? this.index.notesFor(source.document.uri) : [];
    const notes = await Promise.all(entries.map(async note => {
      const register = (action, destination) => {
        const id = `${request.key}:${note.id}:${action}`;
        destinations.set(id, destination);
        return id;
      };
      const locate = (action, location) => ({
        id: register(action, {
          uri: locationUri(note.folder, location), line: location.start, label: locationLabel(location)
        }),
        label: location.label,
        path: locationLabel(location)
      });
      return {
        id: note.id,
        title: note.title,
        start: note.target.start,
        end: note.target.end,
        target: locate('target', note.target),
        related: note.related.map((location, index) => locate(`related:${index}`, location)),
        original: register('original', {
          uri: note.uri, line: note.line + 1, label: vscode.workspace.asRelativePath(note.uri)
        }),
        html: await this.renderMarkdown(note),
        body: note.body.trim()
      };
    }));
    if (this.pending !== request || !this.panel?.visible || !this.ready) {
      return;
    }
    this.destinations = destinations;
    this.sentKey = request.key;
    this.pending = undefined;
    void this.panel.webview.postMessage({
      type: 'file',
      file: source ? vscode.workspace.asRelativePath(source.document.uri) : null,
      line: source ? this.source.selection.active.line + 1 : 0,
      loading: this.index.revision === 0,
      notes
    });
  }

  dispose() {
    this.panel?.dispose();
    this.subscriptions.dispose();
  }
}

module.exports = { DesignPanel, isCodeEditor };
