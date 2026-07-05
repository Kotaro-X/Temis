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

If needed:

```bash
DEVICE_ID=<your-udid> npm run ios:device:logs
```

## Detect Connected Device ID Only

```bash
bash scripts/ios-device-debug.sh --detect-device
```
