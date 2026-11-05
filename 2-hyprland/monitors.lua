-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all

local omarchy_gdk_scale = 1
local omarchy_monitor_scale = 1

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })

-- Physical layout, left to right: DP-2 | DP-1 | HDMI-A-1
-- Highest refresh each connection currently offers (DP-2 only reports 60Hz)
hl.monitor({ output = "DP-2", mode = "1920x1080@60", position = "0x0", scale = 1 })
hl.monitor({ output = "DP-1", mode = "1920x1080@120", position = "1920x0", scale = 1 })
hl.monitor({ output = "HDMI-A-1", mode = "1920x1080@180", position = "auto", scale = 1 })

-- Workspace modes (see ~/.local/bin/workspace-mode). Omarchy 4.5 gives each
-- monitor its own block of ten workspaces and a mode is one slot on all three:
-- slot 1 Home, 2 Dev, 3 Streaming, 10 Contract Work (SUPER+0).
-- These blocks match the ones Omarchy assigned (its monitor-workspaces state
-- file); the rules only make sure a workspace is created on the monitor that
-- owns it. Slot 1 (Home) is where each monitor starts at login.
local blocks = { { 0, "HDMI-A-1" }, { 1, "DP-1" }, { 2, "DP-2" } }
for _, b in ipairs(blocks) do
  for slot = 1, 10 do
    local rule = { workspace = tostring(b[1] * 10 + slot), monitor = b[2] }
    if slot == 1 then
      rule.default = true
    end
    hl.workspace_rule(rule)
  end
end

-- Configure a specific monitor.
-- hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "0x0", scale = 1 })

-- Portrait/rotated secondary monitor (transform: 1 = 90°, 3 = 270°).
-- hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1, transform = 1 })
