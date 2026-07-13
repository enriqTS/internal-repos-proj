# Terminal Commands - Fish Shell Environment

## Shell Information

The user runs the **fish shell** (not bash/zsh). All terminal commands must be compatible with fish syntax, or explicitly wrapped with `bash -c "..."` when using bash-specific syntax.

## Preferred Approach

When a command uses bash-specific features, wrap it with:

```
bash -c "command here"
```

This is the simplest way to avoid fish compatibility issues.

## Fish Shell Incompatibilities

The following **do NOT work** in fish and will cause errors:

### Variable assignment
- **Wrong:** `FOO=bar command` (inline env vars)
- **Right:** `env FOO=bar command` or `set -x FOO bar; command`

### Logical operators
- **Wrong:** `command1 && command2`
- **Right:** `command1; and command2`
- **Wrong:** `command1 || command2`
- **Right:** `command1; or command2`

### Subshell / command substitution
- **Wrong:** `$(command)` or `` `command` ``
- **Right:** `(command)`

### Process substitution
- **Wrong:** `diff <(cmd1) <(cmd2)`
- **Right:** Use `psub`: `diff (cmd1 | psub) (cmd2 | psub)`

### Conditionals
- **Wrong:** `if [ condition ]; then ... fi`
- **Right:** `if test condition; ...; end`

### Loops
- **Wrong:** `for i in {1..5}; do ... done`
- **Right:** `for i in (seq 1 5); ...; end`

### Export
- **Wrong:** `export VAR=value`
- **Right:** `set -x VAR value`

### Here-strings and heredocs
- **Wrong:** `cat <<EOF ... EOF` or `cmd <<< "string"`
- **Right:** Use `echo "string" | cmd` or `printf` piped

### Semicolons in command lists
- **Wrong:** `cmd1; cmd2; cmd3` used with `&&`/`||`
- **Right:** Separate lines or use `; and` / `; or`

### Source
- **Wrong:** `source .env` (if .env uses bash export syntax)
- **Right:** Parse manually or use `bass` plugin, or `bash -c "source .env && env"` piped

## Best Practices

1. **Default to `bash -c "..."`** for any multi-step or complex commands — this avoids all fish compatibility issues.
2. For simple single commands (e.g., `npm install`, `python app.py`, `docker compose up`), run them directly — they work fine in fish.
3. Use `env` prefix for inline environment variables: `env NODE_ENV=production npm start`
4. When chaining commands, prefer `bash -c "cmd1 && cmd2 && cmd3"` over fish-native chaining.
5. For scripts that set environment variables, use `bash -c "source script.sh && exec_command"`.
