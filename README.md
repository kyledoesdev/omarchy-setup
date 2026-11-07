# omarchy-setup

My customizations on top of [Omarchy](https://omarchy.org), the Arch and Hyprland setup by DHH. It isn't a fork. Omarchy stays stock, and this repo is everything I changed or added: a multi-monitor mode system, a dock that only shows up when I want it, a different wallpaper or looping video on each screen, and the scripts and services behind my streaming setup.

Built for three 1080p monitors side by side (left `DP-2`, middle `DP-1`, right `HDMI-A-1`) on Omarchy 4.5.

## What's in it

### Modes

Each mode switches all three monitors at once and puts its apps where they belong.

| Key | Mode | Left | Middle | Right |
|---|---|---|---|---|
| SUPER+1 | Home | Spotify and Discord | free | free |
| SUPER+2 | Dev | MySQL Workbench and Claude | VS Code | Brave and GitKraken |
| SUPER+3 | Streaming | Spotify and Discord | HD60 S+ viewer | Twitch chat, OBS, activity feed |
| SUPER+0 | Contract Work | Brave (work profile) | free | Slack |

- Press a mode key twice quickly to snap every window back into place.
- Double-tap SUPER to go Home. A single tap on Home opens the dock's app grid.
- Home is the everyday space. Steam, Minecraft and Stardew come back to Home from whatever mode they were opened in.
- Omarchy 4.5 gives every monitor its own ten workspaces (right 1 to 10, middle 11 to 20, left 21 to 30). A mode is the same slot on all three, so SUPER+2 is workspaces 2, 12 and 22.
- Everything stays tiled. SUPER+SHIFT+arrow swaps windows, across monitors too.

### Dock

A copy of Omarchy's dock, changed to:

- show only on Home, instead of only on floating workspaces
- reserve its own strip at the bottom so tiled windows stop above it
- sit on a backing in the theme's colors
- never show VS Code, MySQL Workbench or GitKraken
- let SUPER+M minimize into it on Home

### Wallpapers

A wallpaper per monitor, with the middle and right ones as looping videos. They're muted, and they pause under fullscreen games. The plugin draws on its own layer above Omarchy's background, so theme changes keep working underneath.

The pictures and videos come from Steam Workshop items for Wallpaper Engine. They're other people's work, credited here:

- Left: [Project Hail Mary](https://steamcommunity.com/sharedfiles/filedetails/?id=3700577328), a still taken from the scene
- Middle: [Firewatch](https://steamcommunity.com/sharedfiles/filedetails/?id=951259031)
- Right: [Portal background02](https://steamcommunity.com/sharedfiles/filedetails/?id=866413140)

### Streaming

`hd60-split` splits an Elgato HD60 S+ capture card into two virtual cameras, one for OBS and one for a preview window, so both can show the game at once.

Omarchy 4.5 puts the Elgato Cam Link 4K behind a 720p virtual camera for browsers, but its relay (`v4l2-relayd`) can't keep up with a camera that sends 1080p60: it drops most frames and leaks memory until apps crash. `camlink-split.service` replaces it with a plain ffmpeg copy to `/dev/video12` ("Cam Link 4K"), so OBS and Discord can both use the camera at once. After installing the files in `5-services/system`, run `sudo systemctl mask v4l2-relayd@camlink.service`, `sudo systemctl daemon-reload` and `sudo systemctl enable --now camlink-split.service`. The HD60 loopback setting there also keeps its virtual camera non-exclusive, which OBS needs to read it.

## Layout

| Folder | What's there |
|---|---|
| `1-modes` | The mode script, the key handlers, SUPER taps and minimize |
| `2-hyprland` | Keys, monitors and workspace rules, mouse speed, startup |
| `3-shell` | Bar layout (`shell.json`), my shell plugins, Omarchy hooks, screensaver art, wallpapers |
| `4-scripts` | Menus on the main monitor, the capture card scripts, hiding Steam's game launchers, Claude app updates |
| `5-services` | The systemd user services that run those, my local dev servers, the capture card's kernel module setting and my Cam Link overrides |
| `6-launchers` | App menu entries: Brave per profile, the HD60 viewer, Slack and Discord |
| `7-icons` | Dock icons: a custom Files folder, a working OBS logo, a sharp Steam icon |
| `8-terminals` | Terminal configs (only the font differs from Omarchy) |

`manifest.tsv` maps every file here to where it lives on the machine. `3-shell/git-plugins.txt` lists plugins installed from someone else's repo, like the [activity monitor](https://github.com/modib/omarchy-activity-monitor), which get reinstalled from their source instead of copied.

## How it stays up to date

The files on the machine are the real config. This repo is a mirror.

`bin/sync` copies everything in the manifest into the repo, commits and pushes. It runs on its own after every Claude Code turn and after every Omarchy update, and it picks up new scripts, plugins and services without being told. Editing a file in this repo doesn't change the machine, so edit the live file instead (its path is in `manifest.tsv`).

## Setting up a new machine

1. Install Omarchy and let it finish its first run.
2. Install what the setup leans on: `omarchy pkg add rsync jq socat mpv ffmpeg v4l2loopback-dkms v4l2loopback-utils v4l-utils brave-bin spotify vesktop-bin slack-desktop gitkraken mysql-workbench visual-studio-code-bin claude-desktop`, plus Steam (`omarchy install gaming steam`) and OBS from Flathub (`com.obsproject.Studio`). Skip whatever you don't need.
3. Clone this repo and run `bin/install --dry-run` to see what it will do, then `bin/install`. It backs up any file it replaces as `<name>.bak.<timestamp>`.
4. Run the `sudo` commands it prints for the files under `/etc`.
5. Fix what's tied to this machine:
   - monitor names and modes in `2-hyprland/monitors.lua`
   - the `MONITOR` map at the top of `1-modes/workspace-mode`
   - the `monitorBackgrounds` map in `3-shell/plugins/kyle.background/Background.qml`
   - `hyprctl monitors` lists the names to use
6. `claude-desktop-autoupdate` needs a sudoers rule to update without a password. Its header explains it.

An agent can do all of this. Point it at this README and `CLAUDE.md`.
