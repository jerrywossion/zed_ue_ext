import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const entries = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
const engineFile = (root, file) => path.join(root, 'Engine', file);
const isEngine = root => fs.existsSync(engineFile(root, 'Build/Build.version'));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command}: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

function absolute(value) {
  return path.resolve(value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);
}

function findProject(root) {
  for (let dir = root; ; dir = path.dirname(dir)) {
    const projects = entries(dir).filter(item => item.isFile() && item.name.endsWith('.uproject'));
    if (projects.length > 1) {
      throw new Error(`Multiple .uproject files in ${dir}. Open a folder containing a single UE project.`);
    }
    if (projects.length === 1) return path.join(dir, projects[0].name);
    if (path.dirname(dir) === dir) return null;
  }
}

function findEngine(project, settings) {
  if (settings.engine_path) {
    const root = absolute(settings.engine_path);
    if (!isEngine(root)) throw new Error(`engine_path is not an Unreal Engine installation: ${root}`);
    return root;
  }
  const association = readJson(project).EngineAssociation || '';
  const candidates = new Set();
  // Source builds can use a relative EngineAssociation or contain the project.
  if (association && (association.includes('/') || association.startsWith('.'))) {
    candidates.add(path.resolve(path.dirname(project), association));
  }
  for (let dir = path.dirname(project); ; dir = path.dirname(dir)) {
    if (isEngine(dir)) return dir;
    if (path.dirname(dir) === dir) break;
  }
  const epic = path.join(os.homedir(), 'Library/Application Support/Epic');
  const ini = path.join(epic, 'UnrealEngine/Install.ini');
  if (fs.existsSync(ini)) {
    for (const line of fs.readFileSync(ini, 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at < 0) continue;
      const key = line.slice(0, at).trim().replace(/[{}]/g, '');
      if (key.toLowerCase() === association.replace(/[{}]/g, '').toLowerCase()) {
        candidates.add(line.slice(at + 1).trim());
      }
    }
  }
  const launcher = path.join(epic, 'UnrealEngineLauncher/LauncherInstalled.dat');
  if (fs.existsSync(launcher)) {
    for (const item of readJson(launcher).InstallationList || []) {
      if (item.AppName === `UE_${association}` || (!association && item.AppName?.startsWith('UE_'))) {
        candidates.add(item.InstallLocation);
      }
    }
  }
  if (/^\d+\.\d+$/.test(association)) {
    for (const base of ['/Users/Shared/Epic Games', '/Users/Shared', '/Users/Shared/UnrealEngine']) {
      candidates.add(path.join(base, `UE_${association}`));
    }
  }
  const installed = [...candidates].filter(candidate => candidate && isEngine(candidate));
  const unique = [...new Set(installed.map(candidate => fs.realpathSync(candidate)))];
  if (unique.length === 1) return unique[0];
  throw new Error(`${unique.length ? 'Multiple matching UE installations' : 'Cannot locate UE'} for EngineAssociation "${association}". Set lsp.unreal-clangd.settings.engine_path in Zed's global settings.`);
}

function sourceFiles(dir, suffix) {
  const result = [];
  for (const entry of entries(dir)) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(file, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) result.push(file);
  }
  return result;
}

function findTarget(project, settings) {
  const files = sourceFiles(path.join(path.dirname(project), 'Source'), '.Target.cs');
  if (settings.target && files.some(file => path.basename(file, '.Target.cs') === settings.target)) {
    return settings.target;
  }
  const targets = files.filter(file => {
    const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    return /\bType\s*=\s*TargetType\s*\.\s*Editor\b/.test(source);
  }).map(file => path.basename(file, '.Target.cs'));
  const preferred = settings.target || `${path.basename(project, '.uproject')}Editor`;
  if (targets.includes(preferred)) return preferred;
  if (!settings.target && targets.length === 1) return targets[0];
  throw new Error(`Cannot select an Editor target in ${project}. Found: ${targets.join(', ') || 'none'}. Set lsp.unreal-clangd.settings.target globally if the project has custom target rules.`);
}

// UBT emits GNU-style command lines and @response files on macOS. Expand them
// into JSON argument arrays, preserving spaces, quotes, and relative paths.
function tokenize(text) {
  const args = [];
  let token = '', quote = '', started = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') {
      if (i + 1 >= text.length) throw new Error('Trailing escape in UBT compiler arguments');
      token += text[++i];
      started = true;
    } else if (quote) {
      if (char === quote) quote = '';
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(token);
      token = '';
      started = false;
    } else {
      token += char;
      started = true;
    }
  }
  if (quote) throw new Error('Unclosed quote in UBT compiler arguments');
  if (started) args.push(token);
  return args;
}

function expandResponses(args, directory, depth = 0) {
  if (depth > 10) throw new Error('Recursive UBT response files');
  return args.flatMap(arg => arg.startsWith('@')
    ? expandResponses(tokenize(fs.readFileSync(path.resolve(directory, arg.slice(1)), 'utf8')), directory, depth + 1)
    : [arg]);
}

function prepare(root, settings) {
  if (process.platform !== 'darwin') throw new Error('Unreal C++ supports macOS only.');
  for (const name of ['engine_path', 'clangd_path', 'target']) {
    if (settings[name] !== undefined && (typeof settings[name] !== 'string' || !settings[name].trim())) {
      throw new Error(`${name} must be a nonempty string`);
    }
  }
  // Use the active Xcode toolchain so clangd, the SDK and UBT agree.
  const command = settings.clangd_path
    ? absolute(settings.clangd_path)
    : run('/usr/bin/xcrun', ['--find', 'clangd']);
  run(command, ['--version']);
  const args = ['--background-index', '--header-insertion=never', '--limit-results=0', '--limit-references=0'];
  const project = findProject(fs.realpathSync(root));
  // The global C++ adapter also serves ordinary projects using normal clangd.
  if (!project) return { command, args };

  const engine = findEngine(project, settings);
  const target = findTarget(project, settings);
  const version = readJson(engineFile(engine, 'Build/Build.version'));
  if (version.MajorVersion !== 5 || version.MinorVersion < 4) {
    throw new Error('Unreal C++ requires UE 5.4 or later; UE 5.8 is the validated version.');
  }
  const ubt = engineFile(engine, 'Build/BatchFiles/RunUBT.sh');
  if (!fs.existsSync(ubt)) throw new Error(`UnrealBuildTool launcher is missing: ${ubt}`);
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  const key = createHash('sha256').update(JSON.stringify([project, engine, target, arch])).digest('hex').slice(0, 20);
  const cache = path.join(os.homedir(), 'Library/Caches/Zed/unreal-cpp', key);
  fs.mkdirSync(cache, { recursive: true });
  // Separate UBT output from the database clangd reads; publish only a complete
  // database. Unique staging also avoids collisions between two Zed windows.
  const staging = fs.mkdtempSync(path.join(cache, 'prepare-'));
  const logFile = path.join(cache, 'prepare.log');
  const log = fs.openSync(logFile, 'w');
  try {
    const ubtArgs = [ubt, '-Mode=GenerateClangDatabase', target, 'Mac', 'Development',
      `-Project=${project}`, `-OutputDir=${staging}`, `-Architecture=${arch}`, '-WaitMutex'];
    // No normal build, no -NoExecCodeGenActions: UHT's real generated headers
    // are required to parse reflection, and UBT disables unity builds and PCHs.
    fs.writeSync(log, `${JSON.stringify(['/bin/bash', ...ubtArgs])}\n`);
    const result = spawnSync('/bin/bash', ubtArgs, {
      cwd: engine, stdio: ['ignore', log, log], timeout: 15 * 60_000,
    });
    if (result.error || result.status !== 0) {
      const tail = fs.readFileSync(logFile, 'utf8').slice(-5000);
      throw new Error(`UE preparation failed (${result.error?.message || `exit ${result.status}`}). Log: ${logFile}\n${tail}`);
    }
    const database = readJson(path.join(staging, 'compile_commands.json'));
    if (!Array.isArray(database) || !database.length) throw new Error(`UBT returned an empty database. Log: ${logFile}`);
    const drivers = new Set();
    const normalized = database.map(entry => {
      const arguments_ = expandResponses(entry.arguments || tokenize(entry.command), entry.directory);
      if (!arguments_.length || !fs.existsSync(entry.file)) {
        throw new Error(`UBT returned an invalid source entry: ${entry.file}`);
      }
      drivers.add(arguments_[0]);
      return { directory: entry.directory, file: entry.file, arguments: arguments_ };
    });
    const next = path.join(staging, 'normalized.json');
    fs.writeFileSync(next, JSON.stringify(normalized));
    fs.renameSync(next, path.join(cache, 'compile_commands.json'));
    fs.writeSync(log, `Prepared ${normalized.length} compilation commands for ${target} (${arch}).\n`);
    args.push(`--compile-commands-dir=${cache}`, `-j=${Math.min(4, os.availableParallelism())}`);
    // Only let clangd query the exact compiler(s) selected by UBT.
    args.push(`--query-driver=${[...drivers].join(',')}`);
    return { command, args, project, engine, target, database: path.join(cache, 'compile_commands.json'), log: logFile };
  } finally {
    fs.closeSync(log);
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

try {
  const [root, config = '{}'] = process.argv.slice(2);
  if (!root) throw new Error('Usage: node prepare.mjs <project-directory> [settings-json]');
  const settings = JSON.parse(config);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Settings must be a JSON object');
  process.stdout.write(JSON.stringify(prepare(root, settings)));
} catch (error) {
  process.stderr.write(`Unreal C++: ${error.message}\n`);
  process.exitCode = 1;
}
