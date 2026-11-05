import QtQuick

// Never shown. Omarchy only hands a third-party plugin the app library (the
// list of installed apps, their icons, and launching them) when its manifest
// declares the "menu" kind, and a menu kind needs an entry point. The stock
// dock is built in and gets the library anyway; this clone doesn't, which left
// the apps grid empty and fell back to blurry icons. Declaring "menu" with this
// stub fixes both. It is only loaded if something opens kyle.dock as a menu,
// which nothing does.
Item {
  property var shell: null
  property var manifest: null
}
