# omarchy-setup

Kyle's customizations on top of Omarchy. README.md explains what everything is.

## Rules

- The live files on the machine are the source of truth. This repo is a mirror. To change the desktop, edit the live file (see `manifest.tsv` for paths), never the copy here.
- `bin/sync` copies live files in, commits and pushes. A Claude Code Stop hook and an Omarchy post-update hook run it, so there's no need to commit by hand.
- When you add a custom file that `bin/sync` doesn't pick up on its own, add a line for it to `manifest.tsv`. It finds new scripts in `~/.local/bin`, new shell plugins and new systemd user units by itself. Anything else needs a line: hypr files, launchers, icons, files under `/etc`.
- Plugins installed from someone else's git repo go in `3-shell/git-plugins.txt`, never copied in.
- Never put secrets here. The repo is public.
- Never write through a symlink when installing. `bin/install` removes a link before copying, and anything new should do the same.

## Setting up a new machine

Follow "Setting up a new machine" in README.md. Run `bin/install --dry-run` first and show Kyle the result before the real run. Then update the monitor names it lists for that machine's displays.
