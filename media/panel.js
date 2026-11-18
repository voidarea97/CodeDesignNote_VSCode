'use strict';

const vscode = acquireVsCodeApi();
const pane = document.querySelector('#notes');
const file = document.querySelector('#file');
const line = document.querySelector('#line');
const toolbar = document.querySelector('#toolbar');
const currentMode = document.querySelector('#current');
const fileMode = document.querySelector('#file-notes');
const allowedTags = new Set('a b blockquote br caption code dd del div dl dt em h1 h2 h3 h4 h5 h6 hr i kbd li ol p pre s samp span strong sub sup table tbody td th thead tr ul'.split(' '));
const discardedTags = new Set('embed iframe link math meta object script style svg template'.split(' '));

let state = { file: null, line: 0, notes: [] };
let mode = vscode.getState()?.mode === 'file' ? 'file' : 'current';
let rendered = '';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function copyMarkup(source, parent) {
  if (source.nodeType === Node.TEXT_NODE) {
    parent.append(document.createTextNode(source.nodeValue));
  } else if (source.nodeType === Node.ELEMENT_NODE) {
    const tag = source.localName;
    if (discardedTags.has(tag)) {
      return;
    }
    if (tag === 'img') {
      parent.append(document.createTextNode(source.getAttribute('alt') ?? ''));
      return;
    }
    if (allowedTags.has(tag)) {
      const node = element(tag);
      if (tag === 'a') {
        const target = source.getAttribute('href');
        if (/^https?:\/\//iu.test(target ?? '')) {
          node.setAttribute('href', target);
        }
      } else if (tag === 'ol' && /^-?\d+$/u.test(source.getAttribute('start') ?? '')) {
        node.setAttribute('start', source.getAttribute('start'));
      }
      parent.append(node);
      parent = node;
    }
    for (const child of source.childNodes) {
      copyMarkup(child, parent);
    }
  }
}

function jumpButton(text, id, className) {
  const button = element('button', className, text);
  button.type = 'button';
  button.addEventListener('click', () => vscode.postMessage({ type: 'jump', id }));
  return button;
}

function card(note, collapsed) {
  const root = element(collapsed ? 'details' : 'article', 'note');
  root.dataset.note = note.id;
  const title = element(collapsed ? 'summary' : 'h2', 'note-title', note.title);
  if (collapsed) {
    const location = note.start === note.end ? `第 ${note.start} 行` : `第 ${note.start}–${note.end} 行`;
    title.append(element('span', 'note-lines', location));
  }
  const content = element('div', 'note-content');
  content.append(jumpButton(note.target.path, note.target.id, 'location-link'));

  const body = element('div', 'markdown');
  if (note.html !== null) {
    const template = document.createElement('template');
    template.innerHTML = note.html;
    for (const child of template.content.childNodes) {
      copyMarkup(child, body);
    }
  } else if (note.body) {
    body.append(element('p', 'plaintext', note.body));
  } else {
    body.append(element('p', 'muted', '这条说明还没有正文。'));
  }
  content.append(body);

  if (note.related.length) {
    const related = element('section', 'related');
    related.append(element('h3', undefined, '相关代码'));
    const list = element('ul');
    for (const reference of note.related) {
      const item = element('li');
      const button = jumpButton(reference.label ?? reference.path, reference.id, 'reference');
      if (reference.label) {
        button.append(element('span', 'reference-path', reference.path));
      }
      item.append(button);
      list.append(item);
    }
    related.append(list);
    content.append(related);
  }

  const actions = element('div', 'actions');
  actions.append(jumpButton('打开说明原文', note.original, 'action-link'));
  content.append(actions);
  root.append(title, content);
  return root;
}

function render() {
  const { notes, loading } = state;
  const matching = notes.filter(note => note.start <= state.line && state.line <= note.end);
  file.textContent = state.file ?? '代码批注';
  file.title = state.file ?? '';
  line.textContent = state.line ? `第 ${state.line} 行` : '';
  toolbar.hidden = !state.file;
  currentMode.textContent = `当前行 · ${matching.length}`;
  fileMode.textContent = `此文件 · ${notes.length}`;
  currentMode.setAttribute('aria-pressed', String(mode === 'current'));
  fileMode.setAttribute('aria-pressed', String(mode === 'file'));

  const shown = mode === 'file' ? notes : matching;
  const signature = JSON.stringify([mode, shown.map(note => note.id)]);
  if (rendered !== signature) {
    rendered = signature;
    if (shown.length) {
      pane.replaceChildren(...shown.map(note => card(note, mode === 'file')));
    } else {
      let message = '该文件还没有设计说明。';
      if (loading) {
        message = '正在加载批注…';
      } else if (!state.file) {
        message = '打开工作区中的代码文件，查看设计说明。';
      } else if (notes.length && mode === 'current') {
        message = '当前行没有设计说明。可以切换到「此文件」查看其他行。';
      }
      const empty = element('p', 'empty', message);
      empty.setAttribute('role', 'status');
      pane.replaceChildren(empty);
    }
    window.scrollTo(0, 0);
  }

  if (mode === 'file') {
    const matchIds = new Set(matching.map(note => note.id));
    for (const note of pane.querySelectorAll('.note')) {
      note.classList.toggle('matching', matchIds.has(note.dataset.note));
    }
  }
}

function selectMode(next) {
  mode = next;
  vscode.setState({ mode });
  render();
}

currentMode.addEventListener('click', () => selectMode('current'));
fileMode.addEventListener('click', () => selectMode('file'));
document.querySelector('#add').addEventListener('click', () => vscode.postMessage({ type: 'add' }));
window.addEventListener('message', ({ data }) => {
  if (data?.type === 'file') {
    state = data;
    rendered = '';
    render();
  } else if (data?.type === 'line') {
    state.line = data.line;
    render();
  }
});
vscode.postMessage({ type: 'ready' });
