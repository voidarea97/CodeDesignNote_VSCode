'use strict';

const suffix = '.codedoc.md';
const documentGlob = `**/*${suffix}`;

function isDesignDocument(path) {
  return path.endsWith(suffix);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} 必须是非空字符串。`);
  }
  return value.trim();
}

function readLocation(value, field) {
  if (!isRecord(value)) {
    throw new Error(`${field} 必须是包含文件路径和行号的对象。`);
  }
  const { file, start, end = start } = value;
  if (typeof file !== 'string' || /[\\:\u0000-\u001f]/u.test(file) ||
      file.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`${field}.file 必须是以 / 分隔的工作区相对路径。`);
  }
  if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start) {
    throw new Error(`${field} 的 start 和 end 必须是正整数，且 end 必须大于或等于 start。`);
  }
  return { file, start, end };
}

function readMetadata(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('codedoc 围栏内必须填写有效的 JSON。');
  }
  if (!isRecord(data)) {
    throw new Error('codedoc 元数据必须是一个 JSON 对象。');
  }
  const title = requiredText(data.title, 'title');
  const target = readLocation(data.target, 'target');
  const related = data.related === undefined ? [] : data.related;
  if (!Array.isArray(related)) {
    throw new Error('related 必须是一个数组。');
  }
  return {
    title,
    target,
    related: related.map((location, index) => {
      const field = `related[${index}]`;
      return {
        ...readLocation(location, field),
        label: location.label === undefined ? undefined : requiredText(location.label, `${field}.label`)
      };
    })
  };
}

function parseDesignDocument(text) {
  const lines = text.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u);
  const entries = [];
  const issues = [];
  let fence;
  let entry;

  function finishEntry(end) {
    if (entry) {
      entry.body = lines.slice(entry.bodyLine, end).join('\n');
      entries.push(entry);
      entry = undefined;
    }
  }

  for (let line = 0; line < lines.length; line++) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(lines[line]);
    if (!match) {
      continue;
    }
    const [, marker, info] = match;
    if (fence) {
      if (marker[0] === fence.marker[0] && marker.length >= fence.marker.length && !info.trim()) {
        if (fence.isMetadata) {
          try {
            const metadata = readMetadata(lines.slice(fence.line + 1, line).join('\n'));
            entry = { ...metadata, line: fence.line, bodyLine: line + 1 };
          } catch (error) {
            issues.push({ line: fence.line, message: error.message });
          }
        }
        fence = undefined;
      }
    } else if (marker[0] !== '`' || !info.includes('`')) {
      const isMetadata = info.trim() === 'codedoc' && !lines[line].startsWith(' ');
      if (isMetadata) {
        finishEntry(line);
      }
      fence = { marker, line, isMetadata };
    }
  }

  if (fence?.isMetadata) {
    issues.push({ line: fence.line, message: 'codedoc 围栏缺少结束标记。' });
  }
  finishEntry(lines.length);
  return { entries, issues, unclosedFence: fence?.line };
}

function locationLabel(location) {
  const { file, start, end } = location;
  return file + (start === end ? `:${start}` : `:${start}–${end}`);
}

module.exports = { documentGlob, isDesignDocument, locationLabel, parseDesignDocument };
