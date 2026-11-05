-- Keep only your personal keybinding overrides here. Add new bindings or
-- unbind defaults before replacing them.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Change an existing binding by unbinding it first, then binding the key again.
-- This example changes SUPER+SPACE from the launcher to the Omarchy root menu.
-- hl.unbind("SUPER + SPACE")
-- o.bind("SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle root")

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")

-- Open menus on the main monitor (DP-1, or HDMI-A-1 when DP-1 is off).
local on_main = os.getenv("HOME") .. "/.local/bin/focus-main-monitor "
local main_menus = {
  { "SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle" },
  { "SUPER + ALT + SPACE", "Apps menu", "omarchy-menu toggle apps" },
  { "SUPER + CTRL + C", "Capture menu", "omarchy-menu toggle capture" },
  { "SUPER + CTRL + O", "Toggle menu", "omarchy-menu toggle toggle" },
  { "SUPER + CTRL + H", "Hardware menu", "omarchy-menu toggle hardware" },
  { "SUPER + ESCAPE", "System menu", "omarchy-menu toggle system" },
  { "SUPER + CTRL + SPACE", "Background switcher", "omarchy-menu toggle background" },
  { "SUPER + SHIFT + CTRL + SPACE", "Theme menu", "omarchy-menu toggle theme" },
}
for _, m in ipairs(main_menus) do
  hl.unbind(m[1])
  o.bind(m[1], m[2], on_main .. m[3])
end

-- Workspace modes across all three monitors
local mode_key = os.getenv("HOME") .. "/.local/bin/workspace-mode-key "

-- Double-tap Super for Home
hl.bind("SUPER + SUPER_L", hl.dsp.exec_cmd(os.getenv("HOME") .. "/.local/bin/super-double-tap"), { release = true, description = "Apps grid on Home (tap Super), Home mode (double-tap)" })

-- SUPER+1..3 and SUPER+0 select a whole mode (all three monitors at once).
-- Single press: switch to the mode. Double press: switch AND reset windows.
-- Each key is the same slot on every monitor (Omarchy 4.5 per-monitor
-- workspaces; SUPER+0 is slot 10). See ~/.local/bin/workspace-mode.
-- Omarchy binds the number row by keycode (1 = code:10 ... 9 = code:18,
-- 0 = code:19), so the unbind has to use the same form or it silently matches
-- nothing and both binds fire.
local function number_key(n)
  return "SUPER + code:" .. tostring(n == 0 and 19 or n + 9)
end
local modes = {
  { 1, "Home mode", "home" },
  { 2, "Developing mode", "dev" },
  { 3, "Streaming mode", "streaming" },
  { 0, "Contract Work mode", "contract" },
}
for _, m in ipairs(modes) do
  local key = number_key(m[1])
  hl.unbind(key)
  o.bind(key, m[2], mode_key .. m[3])
end
-- SUPER+4 and SUPER+5 both used to be Streaming. Leave them unbound rather
-- than landing on an empty spare workspace out of habit. SUPER+6..9 keep
-- Omarchy's spare per-monitor workspaces.
hl.unbind(number_key(4))
hl.unbind(number_key(5))

-- SUPER+M (was: Omarchy's minimize, which only acts on floating workspaces).
-- Mine also minimizes on Home, where my dock shows while it stays tiled.
o.rebind("SUPER + M", "Minimize window to the dock", os.getenv("HOME") .. "/.local/bin/minimize-window")

-- Browser keys always open a FRESH window on an explicit profile. Bare `brave`
-- hands off to the running instance, which raises whatever Brave window already
-- exists -- dragging you into another mode instead of opening a new window.
-- Naming the profile makes Brave reliably open a new window on the New Tab page.
--   Default = "Personal"   Profile 1 = the work profile
local brave = "uwsm-app -- brave --new-window --profile-directory="
hl.unbind("SUPER + SHIFT + B")
o.bind("SUPER + SHIFT + B", "Browser (Personal)", brave .. "Default")
hl.unbind("SUPER + SHIFT + RETURN")
o.bind("SUPER + SHIFT + RETURN", "Browser (Personal)", brave .. "Default")
o.bind("SUPER + SHIFT + ALT + RETURN", "Browser (work profile)", brave .. "'Profile 1'")

-- Modes moved to SUPER+2 and SUPER+3; these keys are now free.
-- SUPER+SHIFT+D opened the Docker dashboard, which was removed
hl.unbind("SUPER + SHIFT + D")
-- SUPER+SHIFT+P opened the Google Photos web app, which was removed
hl.unbind("SUPER + SHIFT + P")


-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot")
-- o.bind("SUPER + H", nil, "voxtype record toggle")
-- o.bind("SUPER + PERIOD", nil, "omarchy-shell shell toggle omarchy.emojis")
