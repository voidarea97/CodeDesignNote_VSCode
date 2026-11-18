'use strict';

const vscode = require('vscode');
const { DesignIndex, uriKey } = require('./index');
const { parseDesignDocument } = require('./format');
const { DesignPanel, isCodeEditor } = require('./panel');

async function addNote(editor) {
  if (!isCodeEditor(editor)) {
    void vscode.window.showInformationMessage('请先打开工作区中的代码文件。');
    return;
  }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const file = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/gu, '/');
  const selection = editor.selection;
  const start = selection.start.line + 1;
  const exclusiveLastLine = !selection.isEmpty && selection.end.character === 0;
  const end = Math.max(start, selection.end.line + (exclusiveLastLine ? 0 : 1));
  const title = await vscode.window.showInputBox({
    prompt: `为 ${file}:${start}${end > start ? `–${end}` : ''} 添加设计说明`,
    placeHolder: '填写说明标题',
    validateInput: value => value.trim() ? undefined : '请填写标题。'
  });
  if (title === undefined) {
    return;
  }

  const uri = vscode.Uri.joinPath(folder.uri, 'design.codedoc.md');
  try {
    await vscode.workspace.fs.stat(uri);
  } catch (error) {
    if (error.code !== 'FileNotFound') {
      throw error;
    }
    const create = new vscode.WorkspaceEdit();
    create.createFile(uri, { ignoreIfExists: true });
    if (!await vscode.workspace.applyEdit(create)) {
      throw new Error('无法创建 design.codedoc.md。');
    }
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const designEditor = await vscode.window.showTextDocument(document, {
    viewColumn: editor.viewColumn ?? vscode.ViewColumn.Active,
    preview: false
  });
  const text = document.getText();
  const { unclosedFence } = parseDesignDocument(text);
  if (unclosedFence !== undefined) {
    throw new Error(`请先关闭 design.codedoc.md 第 ${unclosedFence + 1} 行的代码围栏。`);
  }
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const target = start === end ? { file, start } : { file, start, end };
  const placeholder = '在这里填写设计说明。';
  let prefix = '';
  if (text && !text.endsWith(eol + eol)) {
    prefix = text.endsWith(eol) ? eol : eol + eol;
  }
  const header = ['```codedoc', JSON.stringify({ title: title.trim(), target }, null, 2), '```', '', '']
    .join('\n').replace(/\n/gu, eol);
  const added = await designEditor.edit(edit => {
    edit.insert(document.positionAt(text.length), prefix + header + placeholder + eol);
  });
  if (!added) {
    throw new Error('写入说明时文档已变化，请重试。');
  }
  const from = text.length + prefix.length + header.length;
  designEditor.selection = new vscode.Selection(document.positionAt(from), document.positionAt(from + placeholder.length));
  designEditor.revealRange(designEditor.selection);
}

function activate(context) {
  const index = new DesignIndex();
  const panel = new DesignPanel(context, index, addNote);
  const lenses = new vscode.EventEmitter();
  const selector = { pattern: '**/*' };
  const provider = {
    onDidChangeCodeLenses: lenses.event,
    provideCodeLenses(document) {
      if (!vscode.workspace.getWorkspaceFolder(document.uri)) {
        return [];
      }
      const lines = new Set(index.notesFor(document.uri)
        .filter(({ target }) => target.start <= document.lineCount)
        .map(({ target }) => target.start - 1));
      return [...lines].map(line => new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
        title: '$(comment-discussion) 查看设计说明',
        command: 'codedoc.openAt',
        arguments: [document.uri, line]
      }));
    }
  };
  context.subscriptions.push(
    index, panel, lenses,
    index.onDidChange(() => lenses.fire()),
    vscode.languages.registerCodeLensProvider(selector, provider),
    vscode.commands.registerCommand('codedoc.open', () => panel.open(vscode.window.activeTextEditor)),
    vscode.commands.registerCommand('codedoc.openAt', (uri, line) => {
      if (!uri || !Number.isInteger(line)) {
        return;
      }
      const active = vscode.window.activeTextEditor;
      const matches = editor => editor && uriKey(editor.document.uri) === uriKey(uri);
      const editor = matches(active) ? active : vscode.window.visibleTextEditors.find(matches);
      if (isCodeEditor(editor) && line >= 0 && line < editor.document.lineCount) {
        editor.selection = new vscode.Selection(line, 0, line, 0);
        editor.revealRange(editor.selection);
        panel.open(editor);
      }
    }),
    vscode.commands.registerCommand('codedoc.add', async () => {
      try {
        await addNote(vscode.window.activeTextEditor);
      } catch (error) {
        void vscode.window.showErrorMessage(`代码批注：${error.message}`);
      }
    })
  );
}

module.exports = { activate };
