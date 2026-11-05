-- Extra autostart processes.
-- o.launch_on_start("my-service")

-- Start with focus on the main monitor
o.exec_on_start(os.getenv("HOME") .. "/.local/bin/focus-main-monitor")
