import type { Command } from "commander";
import type { ApiClient } from "../api-client.js";
import {
  listInferenceModels,
  listKeyPrefixes,
  listVModelIds,
  readApiKeyFromEnv,
  resolveApiKey,
} from "../inference.js";

const TOP_LEVEL_COMMANDS = [
  "status",
  "config",
  "backend",
  "vmodel",
  "key",
  "hook",
  "plugin",
  "user",
  "admin-token",
  "prompt",
  "completion",
];

const PROMPT_FLAGS = ["-m", "--model", "-k", "--key", "-s", "--system", "--no-stream"];

function bashCompletionScript(): string {
  return `# haai bash completion
_haai() {
  local cur prev words cword
  _init_completion -s || return

  if [[ \${#COMP_WORDS[@]} -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "${TOP_LEVEL_COMMANDS.join(" ")}" -- "$cur") )
    return
  fi

  local cmd="\${COMP_WORDS[1]}"

  if [[ "$cmd" == "prompt" ]]; then
    case "$prev" in
      -m|--model)
        mapfile -t COMPREPLY < <(compgen -W "$(haai __complete models 2>/dev/null)" -- "$cur")
        return
        ;;
      -k|--key)
        mapfile -t COMPREPLY < <(compgen -W "$(haai __complete keys 2>/dev/null)" -- "$cur")
        return
        ;;
    esac

    if [[ "$cur" == -* ]]; then
      COMPREPLY=( $(compgen -W "${PROMPT_FLAGS.join(" ")}" -- "$cur") )
      return
    fi
  fi

  if [[ "$cmd" == "completion" && "$prev" == "completion" ]]; then
    COMPREPLY=( $(compgen -W "bash zsh install" -- "$cur") )
    return
  fi
}

complete -F _haai haai
`;
}

function zshCompletionScript(): string {
  return `#compdef haai

_haai() {
  local -a commands
  commands=(
    ${TOP_LEVEL_COMMANDS.map((c) => `'${c}:…'`).join("\n    ")}
  )

  _arguments -C \\
    '1:command:->command' \\
    '*: :->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        prompt)
          _arguments \\
            '-m[Model]:model:($(haai __complete models 2>/dev/null))' \\
            '--model[Model]:model:($(haai __complete models 2>/dev/null))' \\
            '-k[API key]:key:($(haai __complete keys 2>/dev/null))' \\
            '--key[API key]:key:($(haai __complete keys 2>/dev/null))' \\
            '-s[System prompt]:system:' \\
            '--system[System prompt]:system:' \\
            '--no-stream[Disable streaming]' \\
            '*:message:'
          ;;
        completion)
          _arguments '1:shell:(bash zsh install)'
          ;;
      esac
      ;;
  esac
}

_haai "$@"
`;
}

async function completeModels(
  baseUrl: string,
  adminClient: ApiClient,
): Promise<string[]> {
  const ids = new Set<string>();

  try {
    for (const id of await listVModelIds(adminClient)) ids.add(id);
  } catch {
    /* admin API unavailable */
  }

  const envKey = readApiKeyFromEnv();
  if (envKey) {
    try {
      const apiKey = await resolveApiKey(envKey, adminClient);
      for (const id of await listInferenceModels(baseUrl, apiKey)) ids.add(id);
    } catch {
      /* inference models unavailable */
    }
  }

  return [...ids].sort();
}

async function completeKeys(adminClient: ApiClient): Promise<string[]> {
  try {
    return (await listKeyPrefixes(adminClient)).sort();
  } catch {
    return [];
  }
}

export async function runDynamicComplete(
  type: string,
  baseUrl: string,
  adminClient: ApiClient,
): Promise<void> {
  let values: string[] = [];
  if (type === "models") {
    values = await completeModels(baseUrl, adminClient);
  } else if (type === "keys") {
    values = await completeKeys(adminClient);
  }

  for (const value of values) {
    process.stdout.write(`${value}\n`);
  }
}

export function registerCompletionCommands(program: Command): void {
  const cmd = program.command("completion").description("Shell tab completion");

  cmd
    .command("bash")
    .description("Print bash completion script (eval \"$(haai completion bash)\")")
    .action(() => {
      process.stdout.write(bashCompletionScript());
    });

  cmd
    .command("zsh")
    .description("Print zsh completion script")
    .action(() => {
      process.stdout.write(zshCompletionScript());
    });

  cmd
    .command("install")
    .description("Install completion for the current shell")
    .action(async () => {
      const shell = process.env["SHELL"] ?? "";
      if (shell.includes("zsh")) {
        console.log("# Add to your ~/.zshrc:");
        console.log('eval "$(haai completion zsh)"');
      } else {
        console.log("# Add to your ~/.bashrc:");
        console.log('eval "$(haai completion bash)"');
      }
    });
}
