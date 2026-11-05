import QtQuick
import QtQuick.Layouts
import Quickshell.Hyprland
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "kyle.workspaces"

  // Omarchy 4.5 gives each monitor a block of ten workspaces, and a mode is
  // one slot on all three (see ~/.local/bin/workspace-mode). index is that
  // slot, label is the SUPER key: Contract Work is slot 10 on SUPER+0.
  readonly property var modes: [
    { index: 1, label: "1", name: "home" },
    { index: 2, label: "2", name: "dev" },
    { index: 3, label: "3", name: "streaming" },
    { index: 10, label: "0", name: "contract" },
  ]

  function slotOf(id) {
    return id > 0 ? (id - 1) % 10 + 1 : 0
  }

  readonly property int activeMode: Hyprland.focusedWorkspace !== null
    ? slotOf(Hyprland.focusedWorkspace.id)
    : 0

  function modeOccupied(slot) {
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) {
      if (slotOf(values[i].id) === slot && values[i].toplevels.values.length > 0) return true
    }
    return false
  }

  function switchMode(name) {
    if (!root.bar) return
    root.bar.run("workspace-mode " + name)
  }

  readonly property real trailingGap: root.vertical ? 0 : Style.spaceReal(1.5)

  implicitWidth: grid.implicitWidth + trailingGap
  implicitHeight: grid.implicitHeight

  GridLayout {
    id: grid
    anchors.fill: parent
    anchors.rightMargin: root.trailingGap
    columns: root.vertical ? 1 : root.modes.length
    columnSpacing: root.vertical ? 0 : Style.space(1)
    rowSpacing: root.vertical ? Style.space(2) : 0

    Repeater {
      model: root.modes

      WidgetButton {
        required property var modelData

        readonly property bool focused: root.activeMode === modelData.index

        bar: root.bar
        text: focused ? "󱓻" : modelData.label
        opacity: focused ? 1 : 0.5
        horizontalMargin: 6
        verticalPadding: 6
        fixedWidth: root.vertical ? root.barSize : Style.space(20)
        fixedHeight: root.barSize
        onPressed: function() { root.switchMode(modelData.name) }
      }
    }
  }
}
