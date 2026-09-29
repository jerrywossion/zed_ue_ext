use std::{fs, path::PathBuf};
use zed::settings::LspSettings;
use zed_extension_api::{self as zed, serde_json};

struct UnrealCpp;

impl zed::Extension for UnrealCpp {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        if zed::current_platform().0 != zed::Os::Mac {
            return Err("Unreal C++ currently supports macOS only.".into());
        }

        let settings = LspSettings::for_worktree(id.as_ref(), worktree)?;
        // WASI can write to the extension's work directory, not the project.
        // Embed the helper so installation needs only the compiled extension.
        let helper = PathBuf::from("prepare.mjs");
        let source = include_str!("../scripts/prepare.mjs");
        if fs::read_to_string(&helper).ok().as_deref() != Some(source) {
            fs::write(&helper, source).map_err(|error| error.to_string())?;
        }
        let helper = std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(helper);
        let config = settings.settings.unwrap_or_else(|| serde_json::json!({}));
        let output = zed::process::Command::new(zed::node_binary_path()?)
            .arg(helper.to_string_lossy().into_owned())
            .arg(worktree.root_path())
            .arg(config.to_string())
            .envs(worktree.shell_env())
            .output()?;
        if output.status != Some(0) {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        let result: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Invalid Unreal C++ preparation result: {error}"))?;
        let command = result["command"]
            .as_str()
            .ok_or("Preparation did not return a clangd executable")?
            .to_owned();
        let args = result["args"]
            .as_array()
            .ok_or("Preparation did not return clangd arguments")?
            .iter()
            .map(|arg| {
                arg.as_str()
                    .map(str::to_owned)
                    .ok_or("Invalid clangd argument")
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(zed::Command {
            command,
            args,
            env: worktree.shell_env(),
        })
    }
}

zed::register_extension!(UnrealCpp);
