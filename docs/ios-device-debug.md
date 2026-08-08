# iPhone Real-Device Debug (No Expo Go)

## Prerequisites
- iPhone is connected by cable (or trusted wireless debug).
- Device trusts this Mac.
- Apple Development signing is available in Xcode.

## Build + Install + Launch
From project root:

```bash
npm run ios:device:debug
```

This will:
- detect the first connected physical iPhone,
- build `Temis` in `Debug`,
- install app to device,
- launch the app.

If needed, you can force a specific device:

```bash
DEVICE_ID=<your-udid> npm run ios:device:debug
```

## Stream Device Logs

```bash
npm run ios:device:logs
```

This restarts the installed `com.anonymous.WeMemo` app and prints its startup
console until it exits. It does not install or replace the TestFlight build.
Use it when the app crashes before Xcode can attach.

If needed:

```bash
DEVICE_ID=<your-udid> BUNDLE_ID=com.anonymous.WeMemo npm run ios:device:logs
```

## iOS 27 Device Support

If Xcode asks to download device support and then says the software is no
longer available, the iPhone is running a newer iOS release than Xcode
supports. Update Xcode to a release compatible with the iPhone's iOS version.
Until then, `npm run ios:device:logs` can still collect launch output when
`xcrun devicectl device info details --device <udid>` reports that developer
disk image services are available.

## Detect Connected Device ID Only

```bash
bash scripts/ios-device-debug.sh --detect-device
```
