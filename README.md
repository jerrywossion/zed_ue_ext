[English](README.en.md) | [中文](README.md)

# Unreal C++ for Zed

在 macOS 上自动准备 Unreal Engine C++ 项目，提供语法/语义高亮、定义跳转、引用查询和真实的编译诊断。使用 Zed 内置 C++ Tree-sitter、UE 的 UnrealBuildTool / UnrealHeaderTool，以及当前 Xcode 的 clangd。

打开项目中的首个 C++ 文件时，扩展自动寻找 `.uproject`、对应引擎与 Editor Target，生成 `Mac Development` 编译数据库及反射头文件，随后启动 clangd 后台索引。无需手工生成工程文件、配置 include 路径或编写 `.clangd`。不会屏蔽诊断、伪造 UE 宏，也不提供游戏构建或编辑命令。

## 编译与安装

需要当前稳定版 Zed、通过 rustup 安装的 Rust，以及与 UE 版本兼容的完整 Xcode。Xcode 应已完成首次启动配置，`xcrun --find clangd` 应能找到 clangd。运行时的 Node 由 Zed 管理，无需 npm 依赖。支持 UE 5.4+ 的编译数据库接口，实际验证版本为 macOS / Apple Silicon / UE 5.8.2。

```sh
rustup target add wasm32-wasip2
cargo build --locked --release --target wasm32-wasip2
```

产物为 `target/wasm32-wasip2/release/zed_unreal_cpp.wasm`。在 Zed 命令面板执行 **zed: install dev extension**，选择本仓库目录；Zed 会自行编译并安装。修改扩展后，在 Extensions 页面点击该开发扩展的 **Rebuild**。

## 一次性全局设置

执行 **zed: open settings file**，将以下内容合并到全局设置。Zed 扩展 API 无法替用户修改语言服务器选择和语义高亮设置，因此需要这一次全局启用；每个 UE 项目不需要任何设置。

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

`!clangd` 避免同时启动另一份没有 UE 编译参数的内置 clangd；扩展本身仍使用 clangd 并保留完整诊断。普通 C/C++ 项目会直接使用正常的 clangd，不运行 UBT。

通常无需指定引擎：扩展根据 `EngineAssociation` 查询 Epic Launcher 安装记录、源码引擎注册记录和标准安装目录。自定义引擎位置可以在同一份全局设置中指定：

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

可选的 `clangd_path` 覆盖 clangd 可执行文件；`target` 覆盖自动选取的 Editor Target 名称。引擎路径指向包含 `Engine` 的目录。全局指定引擎后会对所有 UE 项目生效，多版本并存时建议保留自动识别。不需要设置 `lsp.unreal-clangd.binary`。

## 使用

1. 在 Zed 中打开包含一个 `.uproject` 的项目目录，例如 `/Volumes/1T/Unreal Projects/LeYou`，然后打开 `.cpp` 或 `.h` 文件。也支持直接打开项目内的 `Source` 子目录。
2. 等待 UBT 准备和 clangd 后台索引完成。首次索引较慢，后续复用索引缓存；未完成时跨文件引用结果可能不完整。
3. 通过右键菜单 **Go to Definition**、**Find All References** 浏览类、类型及函数；语义高亮自动叠加在语法高亮上。

每次启动语言服务器都会重新调用 UBT 检查解析数据，避免遗漏新增模块、源文件或过期的反射头。若在其他工具中修改了 `.Build.cs`、`.Target.cs`、插件或反射声明，回到 Zed 执行 **editor: restart language server** 即可刷新。

扩展只执行 `GenerateClangDatabase`，不会执行普通 C++ 编译或链接；UBT 仍需运行规则程序集、UHT 和项目规定的代码生成步骤，并会更新 UE/项目的 `Intermediate`。源码版引擎须具备 UE 自身要求的工具和第三方依赖。真实的源码错误、缺失插件、SDK 不匹配或 UHT 错误会照常报告。

索引覆盖所选 Editor Target 的 C++ 编译单元及其头文件。Epic Launcher 的预编译引擎不会把全部引擎 `.cpp` 加入项目编译数据库：可以跳转引擎头文件中的类型、声明和内联定义，但不保证跳转所有引擎函数的 `.cpp` 实现或列出整个引擎的全部内部引用。Blueprint 资产中的引用不属于 C++ LSP 索引。

编译数据库、clangd 索引和 `prepare.log` 位于 `~/Library/Caches/Zed/unreal-cpp/<项目标识>/`，不会生成项目级配置。启动失败时查看 Zed 报错中给出的日志路径，或执行 **zed: open log**。需要重建索引时，关闭项目并删除对应缓存目录后重新打开。

接口参考：[Zed 扩展](https://zed.dev/docs/extensions/developing-extensions)、[语言服务器选择](https://zed.dev/docs/configuring-languages)、[clangd 编译参数](https://clangd.llvm.org/design/compile-commands)、[后台索引](https://clangd.llvm.org/design/indexing)。
