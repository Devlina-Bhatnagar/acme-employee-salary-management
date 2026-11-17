/* Rebuild the checked-in browser bundle from readable JSX: npm install && npm run build */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const input = path.join(__dirname, 'src', 'app.jsx');
const source = fs.readFileSync(input, 'utf8');
const result = ts.transpileModule(source, {
  fileName: input,
  compilerOptions: { target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None },
  reportDiagnostics: true
});
for (const d of result.diagnostics || []) {
  const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  console.log(message);
  if (d.category === ts.DiagnosticCategory.Error) process.exitCode = 1;
}
if (!process.exitCode) {
  fs.writeFileSync(path.join(__dirname, 'app.js'), result.outputText);
  console.log('Generated web/app.js');
}
