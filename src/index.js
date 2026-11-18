'use strict';

const vscode = require('vscode');
const { documentGlob, isDesignDocument, parseDesignDocument } = require('./format');

function uriKey(uri) {
  return uri.scheme === 'file' && process.platform === 'win32'
    ? uri.with({ path: uri.path.toLowerCase() }).toString()
    : uri.toString();
}

function locationUri(folder, location) {
  return vscode.Uri.joinPath(folder.uri, location.file);
}

function designFolder(uri) {
  if (!isDesignDocument(uri.path)) {
    return undefined;
  }
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder && !vscode.workspace.asRelativePath(uri, false).split(/[/\\]/u).some(part =>
    part === '.git' || part === 'node_modules')) {
    return folder;
  }
  return undefined;
}

class DesignIndex {
  constructor() {
    this.documents = new Map();
    this.byTarget = new Map();
    this.pending = new Map();
    this.fullScan = true;
    this.revision = 0;
    this.queue = Promise.resolve();
    this.change = new vscode.EventEmitter();
    this.onDidChange = this.change.event;
    this.diagnostics = vscode.languages.createDiagnosticCollection('codedoc');
    const watcher = vscode.workspace.createFileSystemWatcher(documentGlob);
    const update = uri => {
      if (designFolder(uri) || this.documents.has(uriKey(uri)) || this.pending.has(uriKey(uri))) {
        this.pending.set(uriKey(uri), uri);
        this.schedule();
      }
    };
    this.subscriptions = vscode.Disposable.from(
      this.change, this.diagnostics, watcher,
      watcher.onDidCreate(update), watcher.onDidChange(update), watcher.onDidDelete(update),
      vscode.workspace.onDidOpenTextDocument(doc => update(doc.uri)),
      vscode.workspace.onDidCloseTextDocument(doc => update(doc.uri)),
      vscode.workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
        if (contentChanges.length) {
          update(document.uri);
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.fullScan = true;
        this.schedule();
      })
    );
    this.schedule();
  }

  notesFor(uri) {
    return this.byTarget.get(uriKey(uri)) ?? [];
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.queue = this.queue.then(() => this.refresh()).catch(error => console.error('CodeDoc:', error));
    }, 100);
  }

  async refresh() {
    if (this.disposed || (!this.fullScan && !this.pending.size)) {
      return;
    }
    const fullScan = this.fullScan;
    const pending = this.pending;
    this.fullScan = false;
    this.pending = new Map();
    if (fullScan) {
      const files = await vscode.workspace.findFiles(documentGlob, '**/{.git,node_modules}/**');
      for (const uri of files) {
        pending.set(uriKey(uri), uri);
      }
      for (const [key, doc] of this.documents) {
        if (!pending.has(key)) {
          pending.set(key, doc.uri);
        }
      }
    }

    const openDocs = new Map(vscode.workspace.textDocuments.map(doc => [uriKey(doc.uri), doc]));
    const updates = await Promise.all([...pending].map(async ([key, uri]) => {
      const folder = designFolder(uri);
      if (!folder) {
        return { key, uri };
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const open = openDocs.get(key);
        const text = open?.isClosed === false ? open.getText() : new TextDecoder().decode(bytes);
        const previous = this.documents.get(key);
        if (previous?.text === text && previous.folder.uri.toString() === folder.uri.toString()) {
          return { key, uri, unchanged: true };
        }
        const { entries, issues } = parseDesignDocument(text);
        const notes = entries.map(entry => ({
          ...entry,
          id: `${key}:${entry.line}`,
          uri,
          folder,
          codeUri: locationUri(folder, entry.target)
        }));
        return { key, uri, document: { uri, folder, text, notes }, issues };
      } catch (error) {
        const issues = error.code === 'FileNotFound' ? [] : [{ line: 0, message: '无法读取设计说明文件。' }];
        return { key, uri, issues };
      }
    }));
    if (this.disposed) {
      return;
    }

    let changed = fullScan;
    for (const { key, uri, unchanged, document, issues } of updates) {
      if (unchanged) {
        continue;
      }
      if (document) {
        this.documents.set(key, document);
        changed = true;
      } else if (this.documents.delete(key)) {
        changed = true;
      }
      this.diagnostics.set(uri, (issues ?? []).map(issue => {
        const range = new vscode.Range(issue.line, 0, issue.line, 1);
        const diagnostic = new vscode.Diagnostic(range, issue.message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'CodeDoc';
        return diagnostic;
      }));
    }
    if (changed) {
      this.rebuild();
    }
  }

  rebuild() {
    this.byTarget = new Map();
    for (const { notes } of this.documents.values()) {
      for (const note of notes) {
        const key = uriKey(note.codeUri);
        const matches = this.byTarget.get(key) ?? [];
        matches.push(note);
        this.byTarget.set(key, matches);
      }
    }
    for (const notes of this.byTarget.values()) {
      notes.sort((a, b) => a.target.start - b.target.start || a.target.end - b.target.end || a.id.localeCompare(b.id));
    }
    this.revision++;
    this.change.fire();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.subscriptions.dispose();
  }
}

module.exports = { DesignIndex, locationUri, uriKey };
