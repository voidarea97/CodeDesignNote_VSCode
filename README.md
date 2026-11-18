# 代码设计批注

把设计说明写在 `.codedoc.md` 文件中。在 VS Code 里移动光标，旁边的 **代码批注** 页会显示覆盖当前行的说明。说明中可以附上同一文件或其他文件的代码位置。

## 使用

1. 在 VS Code 的扩展页面选择 **从 VSIX 安装…**，安装 `code-design-notes-0.1.0.vsix`。需要 VS Code 1.85 或更新版本。
2. 打开项目文件夹和任意源文件。点击编辑器右上角的批注图标，或从命令面板运行 **代码设计批注: 打开代码批注页**。
3. 用 **当前行** 查看光标所在行的说明，用 **此文件** 展开当前文件的其他批注。有批注的行段起始位置也会显示可点击的 CodeLens。
4. 点击说明的位置或 **相关代码** 条目，编辑器会跳到对应代码的起始行。**打开说明原文** 会定位到 `.codedoc.md` 中的对应段落。
5. 要写说明，选中一行或一段代码，在右键菜单运行 **为当前行或选区添加说明**，也可以从批注页点 **添加说明**。输入标题后，扩展会在工作区根目录的 `design.codedoc.md` 末尾插入模板，并选中待填写的正文。保存后即可随项目提交。

把本项目作为工作区打开，然后查看 `examples/checkout.js` 第 5 行，即可试用自带的 [示例设计文档](examples/checkout.codedoc.md)。

## 文件格式

项目内可以有多个 UTF-8 编码的 `.codedoc.md` 文件。每条说明以一个顶格的 `codedoc` 围栏开始，围栏内使用标准 JSON，围栏后的 Markdown 正文写到下一条说明开始或文件结束。第一个 `codedoc` 围栏前可以写文档导言。

````markdown
```codedoc
{
  "title": "金额以分计算",
  "target": { "file": "examples/checkout.js", "start": 5, "end": 7 },
  "related": [
    { "file": "examples/discount.js", "start": 3, "label": "折扣规则" }
  ]
}
```

金额用整数分表示，以便比较金额和折扣门槛。
````

| 字段 | 含义 |
| --- | --- |
| `title` | 说明标题 |
| `target.file` | 代码文件相对于说明所在工作区根目录的路径，用 `/` 分隔 |
| `target.start`、`target.end` | 从 1 开始的行号，两端都包含。省略 `end` 时只对应一行 |
| `related` | 可省略的代码位置列表。每个位置使用同样的 `file`、`start`、`end`，可用 `label` 命名链接 |

多条说明可以覆盖同一行。元数据错误会出现在 VS Code 的 **问题** 面板。行号按文档中填写的数值匹配，移动代码或重命名文件后需要更新相关位置。

## 本地开发

扩展无需安装运行时依赖。在项目根目录运行以下命令启动扩展开发宿主。

```powershell
code --extensionDevelopmentPath="$PWD" "$PWD"
```

在安装了 Node.js 的环境运行 `npm run check` 检查 JavaScript 语法。安装 `@vscode/vsce` 后可以运行 `vsce package` 生成 VSIX。
