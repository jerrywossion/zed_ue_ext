[English](README.en.md) | [中文](README.md)

# Unreal C++ for Zed

Automatically prepares Unreal Engine C++ projects on macOS for syntax and semantic highlighting, go to definition, find references, and accurate compiler diagnostics. Uses Zed's built-in C++ Tree-sitter support, UE's UnrealBuildTool / UnrealHeaderTool, and clangd from the active Xcode installation.

When you open the first C++ file in a project, the extension finds the `.uproject`, its engine installation, and its Editor Target. It generates a `Mac Development` compilation database and reflection headers, then starts clangd's background index. There is no need to generate project files manually, configure include paths, or write a `.clangd` file. The extension does not suppress diagnostics, replace UE macros with stubs, or provide game build or editing commands.

## Build and install

Requires the current stable version of Zed, Rust installed through rustup, and a full Xcode installation compatible with your UE version. Complete Xcode's first-launch setup and make sure `xcrun --find clangd` finds clangd. Zed manages the Node runtime; no npm dependencies are required. Uses the compilation database interface available in UE 5.4+. Validated on macOS / Apple Silicon / UE 5.8.2.

```sh
rustup target add wasm32-wasip2
cargo build --locked --release --target wasm32-wasip2
```

The output is `target/wasm32-wasip2/release/zed_unreal_cpp.wasm`. In Zed's command palette, run **zed: install dev extension** and select this repository's directory. Zed will compile and install the extension. After changing the extension, click **Rebuild** for the development extension on the Extensions page.

## One-time global setup

Run **zed: open settings file** and merge the following into your global settings. Zed's extension API cannot change your language server selection or semantic highlighting settings, so this one-time setup is required. Individual UE projects need no configuration.

```json
{
  "languages": {
    "C++": {
      "language_servers": ["unreal-clangd", "!clangd", "..."],
      "semantic_tokens": "combined"
    },
    "C": {
      "language_servers": ["unreal-clangd", "!clangd", "..."],
      "semantic_tokens": "combined"
    }
  }
}
```

`!clangd` prevents Zed from also starting its built-in clangd without the UE compilation flags. The extension still uses clangd and preserves all diagnostics. For ordinary C/C++ projects, it starts clangd normally without running UBT.

Usually, you do not need to specify an engine path. The extension uses `EngineAssociation` to look up Epic Launcher installations, registered source builds, and standard installation directories. For a custom engine location, add the following to the same global settings file:

```json
{
  "lsp": {
    "unreal-clangd": {
      "settings": {
        "engine_path": "/Volumes/1T/Apps/UE_5.8"
      }
    }
  }
}
```

The optional `clangd_path` setting overrides the clangd executable; `target` overrides the automatically selected Editor Target name. The engine path must point to the directory containing `Engine`. A globally configured engine path applies to all UE projects, so keep automatic detection enabled if you use multiple engine versions. You do not need to set `lsp.unreal-clangd.binary`.

## Usage

1. Open a project directory containing one `.uproject` in Zed, such as `/Volumes/1T/Unreal Projects/LeYou`, then open a `.cpp` or `.h` file. Opening the project's `Source` subdirectory directly is also supported.
2. Wait for UBT preparation and clangd's background indexing to finish. The first index takes longer; later sessions reuse the index cache. Cross-file reference results may be incomplete while indexing is in progress.
3. Use **Go to Definition** and **Find All References** in the context menu to navigate classes, types, and functions. Semantic highlighting is automatically combined with syntax highlighting.

Each language server startup runs UBT again to check the parsing data, accounting for new modules, source files, and outdated reflection headers. If you change `.Build.cs`, `.Target.cs`, plugins, or reflection declarations in another tool, run **editor: restart language server** in Zed to refresh.

The extension only runs `GenerateClangDatabase`, without performing normal C++ compilation or linking. UBT still needs to run rules assemblies, UHT, and any code generation steps required by the project, and will update the engine's and project's `Intermediate` directories. Source builds of UE must have the tools and third-party dependencies required by the engine itself. Actual source errors, missing plugins, SDK mismatches, and UHT errors are reported normally.

The index covers the C++ translation units and headers of the selected Editor Target. Epic Launcher's precompiled engine does not add every engine `.cpp` file to the project compilation database. You can navigate to types, declarations, and inline definitions in engine headers, but navigation to every engine function's `.cpp` implementation or a complete list of references inside the engine is not guaranteed. References in Blueprint assets are outside the C++ LSP index.

The compilation database, clangd index, and `prepare.log` are stored in `~/Library/Caches/Zed/unreal-cpp/<project-id>/`. No project-level configuration is generated. If startup fails, check the log path in Zed's error message, or run **zed: open log**. To rebuild the index, close the project, delete its corresponding cache directory, and reopen it.

API references: [Zed extensions](https://zed.dev/docs/extensions/developing-extensions), [language server selection](https://zed.dev/docs/configuring-languages), [clangd compile commands](https://clangd.llvm.org/design/compile-commands), [background indexing](https://clangd.llvm.org/design/indexing).
