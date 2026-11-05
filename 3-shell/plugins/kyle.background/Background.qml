import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import QtQuick
import QtMultimedia
import qs.Commons

// Fixed per-monitor wallpapers, drawn on the Bottom layer above Omarchy's own
// background (which stays on the Background layer, untouched).
//
// This used to be a clone of omarchy.background. Omarchy 4.5's wallpaper
// engine (owed) turns omarchy.background on at every login, and turning a
// built-in on drops any clone of it, so the clone kept getting switched off.
// As a separate plugin with no clonedFrom, nothing turns it off.
//
// OWE can only play one video across every monitor, so videos here play in
// the plugin itself through Qt Multimedia.
Item {
  id: root

  property var shell: null
  readonly property string dir: Quickshell.env("HOME") + "/Pictures/Wallpapers/"

  // Keyed by connector name (see `hyprctl monitors`).
  //   still  shows at once, and stays if the video is missing or fails
  //   video  optional; loops muted, pauses under a fullscreen window
  // A monitor not listed here shows the theme background below.
  // The videos come from Wallpaper Engine workshop items 951259031 (Firewatch)
  // and 866413140 (Portal) on the Windows game drive.
  readonly property var monitorBackgrounds: ({
    "DP-2": { still: dir + "project-hail-mary.jpg" },                                          // left
    "DP-1": { still: dir + "firewatch-lookout.png", video: dir + "firewatch-lookout.mp4" },     // middle
    "HDMI-A-1": { still: dir + "portal-cake.png", video: dir + "portal-cake.mp4" }             // right
  })

  // Same test the bar uses: a real fullscreen window (not just maximized) on
  // that workspace.
  function fullscreenOn(workspaceId) {
    var list = Hyprland.toplevels.values
    for (var i = 0; i < list.length; i++) {
      var toplevel = list[i]
      if (!toplevel || !toplevel.workspace || toplevel.workspace.id !== workspaceId) continue
      var ipc = toplevel.lastIpcObject
      if (ipc && (Number(ipc.fullscreen) & 2) !== 0) return true
    }
    return false
  }

  // Hyprland's window list doesn't follow fullscreen changes on its own.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (event && String(event.name) === "fullscreen") Hyprland.refreshToplevels()
    }
  }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: panel
      required property var modelData
      readonly property var entry: root.monitorBackgrounds[modelData.name] || null
      readonly property string stillPath: entry && entry.still ? entry.still : ""
      readonly property string videoPath: entry && entry.video ? entry.video : ""

      readonly property bool underFullscreen: {
        var monitor = Hyprland.monitorFor(modelData)
        var workspace = monitor ? monitor.activeWorkspace : null
        return !!workspace && root.fullscreenOn(workspace.id)
      }

      screen: modelData
      visible: entry !== null
      color: "transparent"
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore

      // Click-through, so desktop clicks still reach Omarchy's background.
      mask: Region {}

      WlrLayershell.namespace: "kyle-background"
      WlrLayershell.layer: WlrLayer.Bottom
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

      Image {
        anchors.fill: parent
        source: panel.stillPath ? Util.fileUrl(panel.stillPath) : ""
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        smooth: true
        // Decode at screen size rather than the file's native size (the
        // Project Hail Mary image is 4K).
        sourceSize: Qt.size(Math.ceil(panel.width * panel.screen.devicePixelRatio),
                            Math.ceil(panel.height * panel.screen.devicePixelRatio))
      }

      Loader {
        anchors.fill: parent
        active: panel.videoPath !== ""

        sourceComponent: Item {
          readonly property bool shouldPlay: !panel.underFullscreen
          onShouldPlayChanged: shouldPlay ? player.play() : player.pause()

          // No audioOutput, so the videos' sound tracks stay silent.
          MediaPlayer {
            id: player
            source: Util.fileUrl(panel.videoPath)
            loops: MediaPlayer.Infinite
            videoOutput: video
            onErrorOccurred: function(error, errorString) {
              console.warn("kyle.background: " + panel.videoPath + ": " + errorString)
            }
          }

          // Fades in over the still once frames are coming, and drops away
          // again if the video errors, leaving the still.
          VideoOutput {
            id: video
            anchors.fill: parent
            fillMode: VideoOutput.PreserveAspectCrop
            opacity: player.error === MediaPlayer.NoError && player.position > 0 ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: Style.duration(250); easing.type: Easing.OutCubic } }
          }

          Component.onCompleted: if (shouldPlay) player.play()
        }
      }
    }
  }
}
