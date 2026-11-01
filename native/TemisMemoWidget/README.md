# Temis memo widget

The home-screen small widget and iOS 16+ Lock Screen circular/rectangular widgets open `exp+temis://memo/new`. They store no memo data and need no App Group. The app handles startup/authentication before opening an explicit-save composer. Each invocation starts in Private; selecting a writable Project shares only when Save is pressed.

`plugins/withTemisMemoWidget.js` copies the native sources, embeds the extension, synchronizes its version/build number and signing team, and declares EAS extension provisioning metadata. Run `npx expo prebuild --platform ios --no-install` after changing native sources. The extension bundle identifier is the containing app identifier plus `.MemoWidget`. A new signed native app build is required; a JavaScript-only update cannot add the widget. Expo documents the provisioning metadata at https://docs.expo.dev/build-reference/app-extensions/.

Manual acceptance (performed by the user; do not launch a simulator automatically):

- Install a newly built app and add the Temis widget to the home and Lock Screens.
- Check cold and warm starts, including while a memo/modal is already open. Existing edits should remain intact.
- Check body focus, keyboard, long text, Japanese/English, large font sizes, and visible Save/Cancel controls.
- Save to Private; reopen and verify Private is the default again.
- Select a writable Project, confirm nothing is shared before Save, then verify its members can see the saved memo.
- Verify offline Private saving, failed Project saving, lost membership, retry, cancellation and repeated taps without duplicate memos.
- Check sign-in/profile setup and account/environment switching do not expose another workspace's draft.

Automated coverage is in `tests/widget-memo*.test.ts`; runtime acceptance and signed distribution remain separate checks.

## Build verification

Build the workspace, including CocoaPods dependencies and the embedded widget, from the repository root:

```sh
xcodebuild -workspace ios/Temis.xcworkspace -scheme Temis \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/temis-app-full-build CODE_SIGNING_ALLOWED=NO build
```

This compiles an unsigned device build without starting a simulator or installing the app. Run it from a terminal or build environment allowed to access Xcode's platform services. Restricted execution can prevent `actool` and `ibtool` from discovering installed runtimes and report `No available simulator runtimes` or `Platform Not Installed` even for a device build.

The plugin keeps the extension copy phase immediately after Resources, before React Native/Firebase scripts. This order prevents a dependency cycle between the embedded widget, the app Info.plist, dSYM generation and Crashlytics.
