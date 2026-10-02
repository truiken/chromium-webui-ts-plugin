// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Load the plugin
const init = require('./index.js');
const {
  findSrcRoot,
  findOutGenDir,
  findTargetGen,
  getTargetTsconfigPaths,
  resolveImport,
  resolveImportInternal,
  resolveFileWithExtensions,
  getChromiumDefinitions,
  clearCache,
} = init._internal;

console.log('=== Running chromium-webui-ts-plugin unit tests ===\n');

// Clear cache before test run
clearCache();

const sampleFile = __filename;
const srcRoot = findSrcRoot(sampleFile) || '/usr/local/google/home/jhawkins/src/chromium/src';
assert(srcRoot && fs.existsSync(srcRoot), `srcRoot not found: ${srcRoot}`);
console.log(`[PASS] findSrcRoot -> ${srcRoot}`);

const outGen = findOutGenDir(srcRoot);
assert(outGen && fs.existsSync(outGen), `outGen directory not found: ${outGen}`);
console.log(`[PASS] findOutGenDir -> ${outGen}`);

const printPreviewTs = path.join(
  srcRoot,
  'chrome/browser/resources/ash/print_preview/ui/preview_area.ts'
);

// 1. Resolve standard WebUI assert library
const resAssert = resolveImportInternal('//resources/js/assert.js', printPreviewTs, srcRoot, outGen);
assert(resAssert && resAssert.endsWith('assert.d.ts'), `assert.js failed: ${resAssert}`);
console.log(`[PASS] //resources/js/assert.js -> ${resAssert}`);

// 2. Resolve Polymer bundled min js
const resPolymer = resolveImportInternal(
  'chrome://resources/polymer/v3_0/polymer/polymer_bundled.min.js',
  printPreviewTs,
  srcRoot,
  outGen
);
assert(resPolymer && resPolymer.endsWith('polymer.d.ts'), `polymer failed: ${resPolymer}`);
console.log(`[PASS] polymer_bundled.min.js -> ${resPolymer}`);

// 3. Resolve Ash common cr_button
const resButton = resolveImportInternal(
  'chrome://resources/ash/common/cr_elements/cr_button/cr_button.js',
  printPreviewTs,
  srcRoot,
  outGen
);
assert(resButton && resButton.includes('cr_button'), `cr_button failed: ${resButton}`);
console.log(`[PASS] cr_button.js -> ${resButton}`);

// 4. Resolve relative generated template file (.html.js -> .html.ts)
const resHtml = resolveImportInternal('./preview_area.html.js', printPreviewTs, srcRoot, outGen);
assert(resHtml && resHtml.endsWith('preview_area.html.ts'), `preview_area.html.js failed: ${resHtml}`);
console.log(`[PASS] ./preview_area.html.js -> ${resHtml}`);

// 5. Resolve /strings.m.js to definitions
const resStrings = resolveImportInternal('/strings.m.js', printPreviewTs, srcRoot, outGen);
assert(resStrings && resStrings.endsWith('strings.d.ts'), `strings.m.js failed: ${resStrings}`);
console.log(`[PASS] /strings.m.js -> ${resStrings}`);

// 6. Resolve Mojo bindings
const resMojo = resolveImportInternal(
  'chrome://resources/mojo/mojo/public/mojom/base/string16.mojom-webui.js',
  printPreviewTs,
  srcRoot,
  outGen
);
assert(resMojo && resMojo.includes('string16.mojom-webui'), `mojo failed: ${resMojo}`);
console.log(`[PASS] string16 mojo -> ${resMojo}`);

// 7. Verify global definitions discovery
const defs = getChromiumDefinitions(srcRoot);
assert(Array.isArray(defs) && defs.length > 10, `expected >10 defs, got ${defs.length}`);
console.log(`[PASS] getChromiumDefinitions -> ${defs.length} definitions found`);

// 8. Test Language Service Hook instantiation
const mockTs = {
  Extension: {
    Ts: '.ts',
    Tsx: '.tsx',
    Dts: '.d.ts',
    Js: '.js',
    Jsx: '.jsx',
    Json: '.json',
  },
  ModuleKind: { ESNext: 99 },
  ModuleResolutionKind: { Bundler: 100, NodeNext: 99 },
  ScriptTarget: { ES2022: 9 },
};

let capturedSettings = null;
let capturedFileNames = null;
const mockHost = {
  getCompilationSettings: () => ({ target: 1 }),
  getScriptFileNames: () => [printPreviewTs],
  resolveModuleNameLiterals: (literals) => literals.map(() => null),
};

const pluginInstance = init({ typescript: mockTs });
const service = pluginInstance.create({
  languageServiceHost: mockHost,
  languageService: {},
  project: {
    projectName: 'test-project',
    projectService: {
      logger: { info: (msg) => {} },
    },
  },
});

assert(typeof mockHost.resolveModuleNameLiterals === 'function');
const resolutions = mockHost.resolveModuleNameLiterals(
  [{ text: '//resources/js/assert.js' }],
  printPreviewTs
);
assert(
  resolutions[0] && resolutions[0].resolvedModule && resolutions[0].resolvedModule.resolvedFileName.endsWith('assert.d.ts'),
  'resolveModuleNameLiterals failed to resolve assert.d.ts'
);
console.log('[PASS] mockHost.resolveModuleNameLiterals -> resolved correctly');

const settings = mockHost.getCompilationSettings();
assert(settings.moduleResolution === 100, 'moduleResolution setting override failed');
assert(settings.allowJs === true, 'allowJs setting override failed');
console.log('[PASS] mockHost.getCompilationSettings -> overridden correctly');

const fileNames = mockHost.getScriptFileNames();
assert(fileNames.length > 10, 'definition files not injected into getScriptFileNames');
console.log(`[PASS] mockHost.getScriptFileNames -> ${fileNames.length} scripts (injected definitions)`);

console.log('\nAll tests completed successfully!');
