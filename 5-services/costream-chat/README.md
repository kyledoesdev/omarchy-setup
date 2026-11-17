# costream-chat

Co-streaming helper for Spacelamp6 (Twitch primary, YouTube second). Set up 2026-11-16.

Runs as a systemd user service (`costream-chat.service`) on http://127.0.0.1:7474.

## What it does

- Reads Twitch chat (anonymous, read-only) and YouTube live chat (no login) and merges them.
- `/overlay` is the OBS browser source "Chat (Twitch + YouTube)" in the Browser Sources group. Each line has a Twitch or YouTube icon. Each line fades after 2 minutes (`?fade=30` changes that, `?fade=0` keeps lines up). `?platforms=twitch` makes it Twitch-only.
- `/youtube-chat` and `/youtube-activity` are the YouTube panels in Streaming mode (Super+3), under the Twitch popouts. "Mod tools" opens YouTube's own popout chat for the current stream.
- `/chat` shows both chats mixed in one window, if you ever want that instead.
- Watches OBS through obs-websocket. When the Twitch stream starts, it starts every output in the Aitum Multistream dock (YouTube) that has a stream key and is switched on. One without a key is skipped with a "Streaming to Twitch only" notification. When Twitch stops, it stops them.
- The page at http://127.0.0.1:7474 shows status and has a "Send test messages" button.

## Files

- `server.js`, `public/`, `config.json` (port, channels, which Aitum outputs auto-start)
- `tools/apply-obs-setup.py` is the one-time OBS setup (obs-websocket on, YouTube output, overlay source). Run it with OBS closed. It's safe to run again.
- YouTube Super Chat/member history: `~/.local/state/costream-chat/youtube-activity.json`

## Commands

    systemctl --user restart costream-chat
    journalctl --user -u costream-chat -f

## Backups from before this setup

- OBS: `~/.var/app/com.obsproject.Studio/config/obs-studio-backup-before-costream-*.tar.gz` (extract over `~/.var/app/com.obsproject.Studio/config/` with OBS closed)
- Layout: `~/.local/bin/workspace-mode.bak-before-costream`
- Keybindings (unchanged, backed up anyway): `~/.config/hypr/bindings.lua.bak-before-costream`
