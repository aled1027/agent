# Pi agent shell notes

## Bash aliases in Pi

Pi's `bash` tool typically runs a **non-interactive, non-login** Bash shell. That means aliases defined in files like `~/.bashrc` or `~/.zshrc` are often **not loaded**.

Because of that, alias-based commands such as:

```bash
alias python=python3
```

may work in a normal terminal but fail when Pi runs a Bash command.

## Recommended fix

Prefer a real executable on `PATH` instead of relying on an alias.

Example wrapper:

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/python <<'EOF'
#!/usr/bin/env bash
exec python3 "$@"
EOF
chmod +x ~/.local/bin/python
```

Make sure `~/.local/bin` is on `PATH`.

## If you still want aliases

For non-interactive Bash, use `BASH_ENV` and enable alias expansion:

```bash
export BASH_ENV="$HOME/.bash_env"
```

Then in `~/.bash_env`:

```bash
shopt -s expand_aliases
alias python=python3
```

`shopt -s expand_aliases` tells Bash to expand aliases in non-interactive shells too.

## Recommendation summary

- Best for automation: wrapper script or symlink on `PATH`
- Bash-only fallback: `BASH_ENV` + `shopt -s expand_aliases`
- Least reliable: aliases defined only in interactive shell config files
