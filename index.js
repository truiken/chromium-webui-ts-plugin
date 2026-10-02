// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const fs = require('fs');
const path = require('path');

// In-memory caches to eliminate repeated directory scans and stat calls
const srcRootCache = new Map();
const outGenCache = new Map();
const targetGenCache = new Map();
const tsconfigCache = new Map();
const defsCache = new Map();

function clearCache() {
  srcRootCache.clear();
  outGenCache.clear();
  targetGenCache.clear();
  tsconfigCache.clear();
  defsCache.clear();
}

let tsLogger = null;
function setLogger(logger) {
  tsLogger = logger;
}

function log(msg) {
  if (tsLogger && typeof tsLogger.info === 'function') {
    tsLogger.info(`[ChromiumWebUIPlugin] ${msg}`);
  }
  if (
    process.env.CHROMIUM_TS_PLUGIN_DEBUG === '1' ||
    process.env.DEBUG === 'chromium-webui-ts-plugin'
  ) {
    try {
      fs.appendFileSync(
        '/tmp/chromium_ts_plugin.log',
        `[${new Date().toISOString()}] ${msg}\n`
      );
    } catch (e) {}
  }
}

function findSrcRoot(startPath) {
  if (!startPath) return null;
  let dir = startPath;
  try {
    if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) {
      dir = path.dirname(dir);
    }
  } catch (e) {
    dir = path.dirname(dir);
  }

  if (srcRootCache.has(dir)) {
    return srcRootCache.get(dir);
  }

  const visited = [];
  let curr = dir;
  while (curr && curr !== path.dirname(curr)) {
    if (srcRootCache.has(curr)) {
      const found = srcRootCache.get(curr);
      for (const v of visited) srcRootCache.set(v, found);
      return found;
    }
    visited.push(curr);
    if (
      fs.existsSync(path.join(curr, 'tools/typescript')) ||
      (fs.existsSync(path.join(curr, 'chrome')) &&
        fs.existsSync(path.join(curr, 'third_party')))
    ) {
      for (const v of visited) srcRootCache.set(v, curr);
      return curr;
    }
    curr = path.dirname(curr);
  }
  for (const v of visited) srcRootCache.set(v, null);
  return null;
}

function findOutGenDir(srcRoot) {
  if (!srcRoot) return null;
  if (outGenCache.has(srcRoot)) {
    return outGenCache.get(srcRoot);
  }

  const candidates = [
    path.join(srcRoot, 'out/Default/gen'),
    path.join(srcRoot, 'out/Debug/gen'),
    path.join(srcRoot, 'out/Release/gen'),
    path.join(srcRoot, '../src/out/Default/gen'),
    path.join(srcRoot, '../src/out/Debug/gen'),
    path.join(srcRoot, '../src/out/Release/gen'),
    path.join(srcRoot, '../out/Default/gen'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      outGenCache.set(srcRoot, c);
      return c;
    }
  }

  // Check any out/*/gen in srcRoot or ../src/out/*/gen
  for (const base of [path.join(srcRoot, 'out'), path.join(srcRoot, '../src/out')]) {
    if (fs.existsSync(base)) {
      try {
        const entries = fs.readdirSync(base);
        for (const e of entries) {
          const genPath = path.join(base, e, 'gen');
          if (fs.existsSync(genPath)) {
            outGenCache.set(srcRoot, genPath);
            return genPath;
          }
        }
      } catch (err) {}
    }
  }

  outGenCache.set(srcRoot, null);
  return null;
}

function getTargetTsconfigPaths(tsconfigPath) {
  if (!tsconfigPath) return null;
  if (tsconfigCache.has(tsconfigPath)) return tsconfigCache.get(tsconfigPath);
  try {
    if (!fs.existsSync(tsconfigPath)) {
      tsconfigCache.set(tsconfigPath, null);
      return null;
    }
    const raw = fs.readFileSync(tsconfigPath, 'utf8');
    const json = JSON.parse(raw);
    const paths = (json.compilerOptions && json.compilerOptions.paths) || {};
    tsconfigCache.set(tsconfigPath, paths);
    return paths;
  } catch (e) {
    tsconfigCache.set(tsconfigPath, null);
    return null;
  }
}

function matchPattern(pattern, text) {
  if (pattern === text) return '';
  if (!pattern.includes('*')) return null;
  const starIdx = pattern.indexOf('*');
  const prefix = pattern.substring(0, starIdx);
  const suffix = pattern.substring(starIdx + 1);
  if (text.startsWith(prefix) && text.endsWith(suffix)) {
    return text.substring(prefix.length, text.length - suffix.length);
  }
  return null;
}

function findTargetGen(dir, srcRoot, outGen) {
  if (targetGenCache.has(dir)) {
    return targetGenCache.get(dir);
  }

  let curr = dir;
  while (curr && curr.startsWith(srcRoot) && curr !== srcRoot) {
    const rel = path.relative(srcRoot, curr);
    const candidatePre = path.join(outGen, rel, 'preprocessed');
    const candidateTsconfig = path.join(outGen, rel, 'tsconfig_build_ts.json');
    if (fs.existsSync(candidatePre) || fs.existsSync(candidateTsconfig)) {
      const res = {
        targetSrcDir: curr,
        targetGenDir: path.join(outGen, rel),
        targetPreDir: fs.existsSync(candidatePre) ? candidatePre : null,
        tsconfigPath: fs.existsSync(candidateTsconfig) ? candidateTsconfig : null,
      };
      targetGenCache.set(dir, res);
      return res;
    }
    curr = path.dirname(curr);
  }

  targetGenCache.set(dir, null);
  return null;
}

const VALID_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];

function resolveFileWithExtensions(basePath) {
  if (!basePath) return null;

  // 1. If basePath already ends with .d.ts, .ts, or .tsx, it is already a TS declaration/source
  if (basePath.endsWith('.d.ts') || basePath.endsWith('.ts') || basePath.endsWith('.tsx')) {
    try {
      if (fs.existsSync(basePath) && !fs.statSync(basePath).isDirectory()) {
        return basePath;
      }
    } catch (e) {}
  }

  // 2. Check for .d.ts and .ts before .js
  const clean = basePath.replace(/\.js$/, '');
  const candidateExts = ['.d.ts', '.ts', '.tsx', '.js', '.jsx'];
  for (const ext of candidateExts) {
    const p = clean + ext;
    try {
      if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) {
        return p;
      }
    } catch (e) {}
  }

  // 3. If directory, check standard index entrypoints
  try {
    if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
      for (const idx of ['index.d.ts', 'index.ts', 'index.tsx', 'index.js']) {
        const p = path.join(basePath, idx);
        if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) return p;
      }
    }
  } catch (e) {}

  // 4. Fallback check for any valid extension already on basePath (e.g. .mjs, .json)
  if (VALID_EXTS.some(ext => basePath.endsWith(ext))) {
    try {
      if (fs.existsSync(basePath) && !fs.statSync(basePath).isDirectory()) {
        return basePath;
      }
    } catch (e) {}
  }

  return null;
}

function resolveImportInternal(specifier, containingFile, srcRoot, outGen) {
  const dir = path.dirname(containingFile);
  const target = outGen ? findTargetGen(dir, srcRoot, outGen) : null;

  // 1. Check target tsconfig_build_ts.json paths if available
  if (target && target.tsconfigPath) {
    const paths = getTargetTsconfigPaths(target.tsconfigPath);
    if (paths) {
      const tsconfigDir = path.dirname(target.tsconfigPath);
      for (const [pattern, targetList] of Object.entries(paths)) {
        const star = matchPattern(pattern, specifier);
        if (star !== null) {
          for (const t of targetList) {
            const replaced = star.length > 0 ? t.replace('*', star) : t;
            const abs = path.resolve(tsconfigDir, replaced);
            const found = resolveFileWithExtensions(abs);
            if (found) return found;
          }
        }
      }
    }
  }

  // 2. chrome://resources/ and //resources/
  if (specifier.startsWith('chrome://resources/') || specifier.startsWith('//resources/')) {
    const sub = specifier.replace(/^(chrome:)?\/\/resources\//, '');
    const candidates = [];

    if (outGen) {
      candidates.push(
        path.join(outGen, 'ash/webui/common/resources/preprocessed', sub.replace(/^ash\/common\//, '')),
        path.join(outGen, 'ui/webui/resources/tsc', sub),
        path.join(outGen, 'ui/webui/resources/tsc/cros_components/to_be_rewritten', sub.replace(/^cros_components\//, '')),
        path.join(outGen, sub)
      );
    }

    // Source tree candidates (useful for direct checkout or before build completion)
    candidates.push(
      path.join(srcRoot, 'third_party/polymer/v3_0/components-chromium', sub.replace(/^polymer\/v3_0\//, '')),
      path.join(srcRoot, 'third_party/lit/v3_0', sub.replace(/^lit\/v3_0\//, '')),
      path.join(srcRoot, 'third_party/material_web_components/components-chromium/node_modules/@material', sub.replace(/^mwc\/@material\//, '')),
      path.join(srcRoot, 'third_party/d3/src', sub.replace(/^d3\//, '')),
      path.join(srcRoot, 'ui/webui/resources', sub),
      path.join(srcRoot, 'ash/webui/common/resources', sub.replace(/^ash\/common\//, ''))
    );

    if (sub === 'polymer/v3_0/polymer/polymer_bundled.min.js') {
      const p = path.join(srcRoot, 'third_party/polymer/v3_0/components-chromium/polymer/polymer.d.ts');
      if (fs.existsSync(p)) return p;
    }

    for (const c of candidates) {
      const found = resolveFileWithExtensions(c);
      if (found) return found;
    }
  }

  // 3. Relative imports (./ or ../)
  if (specifier.startsWith('.')) {
    const local = resolveFileWithExtensions(path.resolve(dir, specifier));
    if (local) return local;

    if (target && target.targetPreDir) {
      const relFromTarget = path.relative(target.targetSrcDir, dir);
      const inPre = resolveFileWithExtensions(path.resolve(target.targetPreDir, relFromTarget, specifier));
      if (inPre) return inPre;
    }

    if (outGen) {
      const relDir = path.relative(srcRoot, dir);
      const directInGen = resolveFileWithExtensions(path.resolve(outGen, relDir, specifier));
      if (directInGen) return directInGen;
    }
  }

  // 4. Absolute root paths (/strings.m.js, etc.)
  if (specifier.startsWith('/')) {
    if (specifier === '/strings.m.js') {
      const p = path.join(srcRoot, 'tools/typescript/definitions/strings.d.ts');
      if (fs.existsSync(p)) return p;
    }
    if (specifier.startsWith('/tools/typescript/definitions/')) {
      const p = path.join(srcRoot, specifier);
      const found = resolveFileWithExtensions(p);
      if (found) return found;
    }
  }

  return null;
}

function resolveImport(specifier, containingFile, srcRoot, outGen) {
  const result = resolveImportInternal(specifier, containingFile, srcRoot, outGen);
  if (result) {
    log(`[RESOLVED] ${specifier} -> ${result}`);
  } else if (specifier.startsWith('.') || specifier.includes('//resources/') || specifier.startsWith('chrome://')) {
    log(`[FAILED] ${specifier} (in ${containingFile})`);
  }
  return result;
}

function getChromiumDefinitions(srcRoot) {
  if (defsCache.has(srcRoot)) {
    return defsCache.get(srcRoot);
  }
  const defsDir = path.join(srcRoot, 'tools/typescript/definitions');
  let defFiles = [];
  if (fs.existsSync(defsDir)) {
    try {
      defFiles = fs.readdirSync(defsDir)
        .filter(f => f.endsWith('.d.ts'))
        .map(f => path.join(defsDir, f));
    } catch (e) {}
  }
  defsCache.set(srcRoot, defFiles);
  return defFiles;
}

function getExtension(resolvedPath, ts) {
  if (resolvedPath.endsWith('.d.ts')) return ts.Extension.Dts;
  if (resolvedPath.endsWith('.ts')) return ts.Extension.Ts;
  if (resolvedPath.endsWith('.tsx')) return (ts.Extension && ts.Extension.Tsx) || ts.Extension.Ts;
  if (resolvedPath.endsWith('.js')) return ts.Extension.Js;
  if (resolvedPath.endsWith('.jsx')) return (ts.Extension && ts.Extension.Jsx) || ts.Extension.Js;
  if (resolvedPath.endsWith('.json')) return (ts.Extension && ts.Extension.Json) || ts.Extension.Js;
  return ts.Extension.Ts;
}

function init(modules) {
  const ts = modules.typescript;

  function create(info) {
    const logger = info.project && info.project.projectService && info.project.projectService.logger;
    if (logger) {
      setLogger(logger);
      logger.info('[ChromiumWebUIPlugin] Active for: ' + (info.project && info.project.projectName));
    }

    const host = info.languageServiceHost;
    if (!host) {
      return info.languageService;
    }

    const origResolveModuleNameLiterals = host.resolveModuleNameLiterals ? host.resolveModuleNameLiterals.bind(host) : null;
    const origResolveModuleNames = host.resolveModuleNames ? host.resolveModuleNames.bind(host) : null;

    if (origResolveModuleNameLiterals) {
      host.resolveModuleNameLiterals = (
        moduleLiterals,
        containingFile,
        redirectedReference,
        options,
        containingSourceFile,
        reusedNames
      ) => {
        const standardResolutions = origResolveModuleNameLiterals(
          moduleLiterals,
          containingFile,
          redirectedReference,
          options,
          containingSourceFile,
          reusedNames
        );

        const srcRoot = findSrcRoot(containingFile);
        if (!srcRoot) return standardResolutions;
        const outGen = findOutGenDir(srcRoot);

        return standardResolutions.map((res, i) => {
          if (res && res.resolvedModule) return res;

          const specifier = moduleLiterals[i].text;
          const resolvedPath = resolveImport(specifier, containingFile, srcRoot, outGen);
          if (resolvedPath) {
            return {
              resolvedModule: {
                resolvedFileName: resolvedPath,
                extension: getExtension(resolvedPath, ts),
                isExternalLibraryImport: resolvedPath.includes('third_party')
              }
            };
          }
          return res;
        });
      };
    }

    if (origResolveModuleNames) {
      host.resolveModuleNames = (
        moduleNames,
        containingFile,
        reusedNames,
        redirectedReference,
        options,
        containingSourceFile
      ) => {
        const standardResolutions = origResolveModuleNames(
          moduleNames,
          containingFile,
          reusedNames,
          redirectedReference,
          options,
          containingSourceFile
        );

        const srcRoot = findSrcRoot(containingFile);
        if (!srcRoot) return standardResolutions;
        const outGen = findOutGenDir(srcRoot);

        return standardResolutions.map((res, i) => {
          if (res) return res;

          const specifier = moduleNames[i];
          const resolvedPath = resolveImport(specifier, containingFile, srcRoot, outGen);
          if (resolvedPath) {
            return {
              resolvedFileName: resolvedPath,
              extension: getExtension(resolvedPath, ts),
              isExternalLibraryImport: resolvedPath.includes('third_party')
            };
          }
          return res;
        });
      };
    }

    // Enhance compilation settings for inferred projects
    if (host.getCompilationSettings) {
      const origGetCompilationSettings = host.getCompilationSettings.bind(host);
      host.getCompilationSettings = () => {
        const settings = origGetCompilationSettings() || {};
        const bundlerModRes = (ts.ModuleResolutionKind && ts.ModuleResolutionKind.Bundler) ||
                              (ts.ModuleResolutionKind && ts.ModuleResolutionKind.NodeNext) || 2;
        const targetES = (ts.ScriptTarget && ts.ScriptTarget.ES2022) ||
                         (ts.ScriptTarget && ts.ScriptTarget.ES2020) || 7;
        return {
          ...settings,
          module: (ts.ModuleKind && ts.ModuleKind.ESNext) || 99,
          moduleResolution: settings.moduleResolution || bundlerModRes,
          target: settings.target || targetES,
          allowJs: true,
          noEmit: true,
        };
      };
    }

    // Inject Chromium definition files
    if (host.getScriptFileNames) {
      const origGetScriptFileNames = host.getScriptFileNames.bind(host);
      host.getScriptFileNames = () => {
        const files = origGetScriptFileNames() || [];
        const sample = files.find(f => !f.endsWith('.d.ts')) || (info.project && info.project.currentDirectory);
        const srcRoot = findSrcRoot(sample);
        if (srcRoot) {
          const defFiles = getChromiumDefinitions(srcRoot);
          if (defFiles.length > 0) {
            return [...new Set([...files, ...defFiles])];
          }
        }
        return files;
      };
    }

    return info.languageService;
  }

  return { create };
}

function activate(context) {}
function deactivate() {}

init.activate = activate;
init.deactivate = deactivate;
init.clearCache = clearCache;
init._internal = {
  findSrcRoot,
  findOutGenDir,
  findTargetGen,
  getTargetTsconfigPaths,
  resolveImport,
  resolveImportInternal,
  resolveFileWithExtensions,
  getChromiumDefinitions,
  clearCache,
  setLogger,
};

module.exports = init;
