# Chromium WebUI TypeScript Plugin for VS Code

A lightweight TypeScript Language Server plugin for Visual Studio Code that provides first-class module resolution and IntelliSense for Chromium WebUI development.

## Problem

When developing Chromium WebUI interfaces in VS Code, TypeScript IntelliSense frequently reports false-positive errors:
* Imports with custom schemes like `chrome://resources/...` or `//resources/...` cannot be found.
* Generated template modules (e.g. `./component.html.js` generated from `.html.ts`) cannot be resolved.
* Mojo JavaScript/TypeScript bindings (e.g. `*.mojom-webui.js`) generated at build time in `out/*/gen` cannot be located.
* Global Chromium typings in `tools/typescript/definitions/` are not recognized for inferred projects.

## How It Works

This plugin hooks directly into VS Code's TypeScript Language Server (`tsserver`) to resolve modules using Chromium's build conventions:

1. **Target GN `tsconfig_build_ts.json`**: Locates the nearest GN-generated `tsconfig_build_ts.json` in your build directory (e.g. `out/Default/gen/...`) and applies its `compilerOptions.paths` mappings.
2. **Chromium Resource Schemes**: Resolves `chrome://resources/` and `//resources/` imports to:
   - `ui/webui/resources/tsc/`
   - `ash/webui/common/resources/preprocessed/`
   - Third-party libraries (`third_party/polymer/`, `third_party/lit/`, `third_party/material_web_components/`, `third_party/d3/`)
   - Direct source tree fallbacks when working on clean checkouts.
3. **Mojo WebUI Bindings**: Resolves `.mojom-webui.js` imports to the generated definitions in `out/*/gen`.
4. **HTML Templates**: Resolves `./*.html.js` imports to preprocessed `out/*/gen/.../*.html.ts` files.
5. **Chromium Type Definitions**: Automatically discovers and injects definitions from `tools/typescript/definitions/*.d.ts` into inferred projects.
6. **Optimized In-Memory Caching**: Caches directory walks and path lookups to eliminate disk thrashing during editing.

## Installation

### Option 1: VS Code Workspace Settings (Recommended for Chromium Checkouts)

Add the plugin path to your `.vscode/settings.json` or your user `settings.json`:

```json
{
  "typescript.tsserver.pluginPaths": [
    "/path/to/chromium-webui-ts-plugin"
  ]
}
```

### Option 2: Install as VS Code Extension

1. Copy or symlink this directory into your VS Code extensions folder:
   ```bash
   ln -s /path/to/chromium-webui-ts-plugin ~/.vscode/extensions/chromium-webui-ts-plugin
   ```
2. Restart or reload VS Code (`Developer: Reload Window`).

## Debugging & Diagnostics

To enable verbose debug logging to `/tmp/chromium_ts_plugin.log`:

```bash
export CHROMIUM_TS_PLUGIN_DEBUG=1
```

In standard mode, plugin diagnostics are sent directly to VS Code's TypeScript output channel (`View -> Output -> TypeScript`).

## Testing

Run the included test suite:

```bash
npm test
```

## License

BSD-3-Clause (Chromium Open Source License)
