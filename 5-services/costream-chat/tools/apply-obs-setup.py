#!/usr/bin/env python3
"""One-time OBS setup for co-streaming. Run it while OBS is closed.

1. Turns on obs-websocket (localhost:4455, keeps the existing password) so the
   costream-chat service can start YouTube when the Twitch stream starts.
2. Adds a "YouTube" output to Aitum Multistream (stream key left blank: paste
   it in the Multistream dock in OBS).
3. Adds a "Chat (Twitch + YouTube)" browser source to the "Browser Sources"
   group, in the spot the StreamElements chat widget used, and hides the
   StreamElements "Chat" source (kept, so it can be switched back on).

Usage: apply-obs-setup.py [--config-dir DIR]   (default: the Flatpak OBS config)
Safe to run twice; it skips anything already done.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid

DEFAULT_DIR = os.path.expanduser("~/.var/app/com.obsproject.Studio/config/obs-studio")
PROFILE = "spacelampsix"
COLLECTION = "spacelampsix.json"
GROUP = "Browser Sources"
OLD_CHAT = "Chat"
NEW_CHAT = "Chat (Twitch + YouTube)"
OVERLAY_URL = "http://127.0.0.1:7474/overlay"
# Where the StreamElements chat widget sat inside its 1920x1080 overlay.
CHAT_POS = {"x": 1340.0, "y": 11.0}
CHAT_SIZE = (567, 1059)
YOUTUBE_SERVER = "rtmp://a.rtmp.youtube.com/live2"


def load(path):
    with open(path) as f:
        return json.load(f)


def save(path, data):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.before-costream-{stamp}")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=4)
    os.replace(tmp, path)


def obs_running():
    r = subprocess.run(["pgrep", "-x", "obs"], capture_output=True)
    return r.returncode == 0


def enable_websocket(root):
    path = os.path.join(root, "plugin_config/obs-websocket/config.json")
    cfg = load(path)
    if cfg.get("server_enabled"):
        print("obs-websocket: already on")
        return
    if not cfg.get("server_password"):
        sys.exit("obs-websocket has no password set; set one in OBS first (Tools > WebSocket Server Settings)")
    cfg["server_enabled"] = True
    cfg["auth_required"] = True
    cfg["first_load"] = False
    save(path, cfg)
    print("obs-websocket: turned on (port %s, password unchanged)" % cfg.get("server_port", 4455))


def add_youtube_output(root):
    path = os.path.join(root, "plugin_config/aitum-multistream/config.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cfg = load(path) if os.path.exists(path) else {}
    profiles = cfg.setdefault("profiles", [])
    prof = next((p for p in profiles if p.get("name") == PROFILE), None)
    if prof is None:
        prof = {"name": PROFILE}
        profiles.append(prof)
    outputs = prof.setdefault("outputs", [])
    yt = next((o for o in outputs if o.get("name") == "YouTube"), None)
    if yt is None:
        yt = {"enabled": True, "name": "YouTube", "stream_server": YOUTUBE_SERVER, "stream_key": ""}
        outputs.append(yt)
        print("Aitum Multistream: added YouTube output (paste the stream key in the Multistream dock)")
    elif yt.get("audio_encoder"):
        print("Aitum Multistream: YouTube output already set up")
        return
    # Same video as Twitch (reuses the main encoder, no extra GPU work), but
    # audio from track 6, the Twitch VOD track that leaves Spotify out, so
    # YouTube's Content ID doesn't cut the stream over music.
    yt.update({
        "advanced": True,
        "video_encoder": "",
        "video_encoder_index": 0,
        "audio_encoder": "ffmpeg_aac",
        "audio_encoder_settings": {"bitrate": 160},
        "audio_track": 5,
    })
    save(path, cfg)
    print("Aitum Multistream: YouTube uses the Twitch video encode and audio track 6 (no Spotify)")


def add_overlay_source(root):
    path = os.path.join(root, "basic/scenes", COLLECTION)
    d = load(path)
    by_name = {s["name"]: s for s in d["sources"]}
    if NEW_CHAT in by_name:
        print("Scenes: overlay source already there")
        return
    old = by_name[OLD_CHAT]
    group = next(g for g in d["groups"] if g["name"] == GROUP)

    new = json.loads(json.dumps(old))
    new["name"] = NEW_CHAT
    new["uuid"] = str(uuid.uuid4())
    new["settings"] = {
        "url": OVERLAY_URL,
        "width": CHAT_SIZE[0],
        "height": CHAT_SIZE[1],
        "fps_custom": False,
        "reroute_audio": False,
        "restart_when_active": False,
        "shutdown": False,
    }
    d["sources"].insert(d["sources"].index(old) + 1, new)

    all_ids = [it["id"] for s in d["sources"] + d["groups"] if s["id"] in ("scene", "group") for it in s["settings"]["items"]]
    new_id = max(all_ids) + 1

    def new_item(old_item):
        it = json.loads(json.dumps(old_item))
        it.update({"name": NEW_CHAT, "source_uuid": new["uuid"], "id": new_id, "visible": True, "pos": dict(CHAT_POS)})
        it["scale"] = {"x": 1.0, "y": 1.0}
        # OBS 31+ positions items by pos_rel (canvas center = 0, half the
        # canvas height = 1) and only falls back to pos without it.
        ref = it.get("scale_ref", {"x": 1920.0, "y": 1080.0})
        half_w, half_h = ref["x"] / 2, ref["y"] / 2
        it["pos_rel"] = {"x": (CHAT_POS["x"] - half_w) / half_h, "y": (CHAT_POS["y"] - half_h) / half_h}
        it["scale_rel"] = {"x": 1.0, "y": 1.0}
        return it

    def insert_after_old(container):
        items = container["settings"]["items"]
        for i, it in enumerate(items):
            if it["name"] == OLD_CHAT:
                items.insert(i + 1, new_item(it))
                it["visible"] = False
                container["settings"]["id_counter"] = max(container["settings"].get("id_counter", 0), new_id)
                return True
        return False

    insert_after_old(group)
    scenes = [s["name"] for s in d["sources"] if s["id"] == "scene" and insert_after_old(s)]
    save(path, d)
    print(f"Scenes: added '{NEW_CHAT}' to the '{GROUP}' group ({', '.join(scenes)}); StreamElements '{OLD_CHAT}' hidden")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config-dir", default=DEFAULT_DIR)
    args = ap.parse_args()
    if args.config_dir == DEFAULT_DIR and obs_running():
        sys.exit("OBS is running. Close it first; OBS rewrites these files when it exits.")
    enable_websocket(args.config_dir)
    add_youtube_output(args.config_dir)
    add_overlay_source(args.config_dir)


if __name__ == "__main__":
    main()
