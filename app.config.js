const appJson = require("./app.json");

module.exports = () => {
  const expoConfig = appJson.expo || {};
  const isDevBuild = process.env.NODE_ENV !== "production";
  const requestedIosNewArchitecture = process.env.IOS_NEW_ARCH_ENABLED;
  // Keep the existing release architecture selection independent of UIScene
  // adoption, which is required for both React Native architectures.
  const shouldUseIosNewArchitecture =
    requestedIosNewArchitecture === "true"
      ? true
      : requestedIosNewArchitecture === "false"
        ? false
        : isDevBuild;

  const ios = expoConfig.ios || {};
  const android = expoConfig.android || {};
  const iosGoogleServicesFile =
    process.env.GOOGLE_SERVICES_PLIST?.trim() || ios.googleServicesFile;
  const androidGoogleServicesFile =
    process.env.GOOGLE_SERVICES_JSON?.trim() || android.googleServicesFile;
  const basePlugins = expoConfig.plugins || [];
  const infoPlist = ios.infoPlist || {};
  const ats = infoPlist.NSAppTransportSecurity || {};
  const exceptionDomains = ats.NSExceptionDomains || {};

  const devAts = isDevBuild
    ? {
        NSAppTransportSecurity: {
          ...ats,
          // Development-only local HTTP exceptions for Ollama (127.0.0.1/localhost).
          NSExceptionDomains: {
            ...exceptionDomains,
            localhost: {
              ...(exceptionDomains.localhost || {}),
              NSIncludesSubdomains: true,
              NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
              NSTemporaryExceptionMinimumTLSVersion: "TLSv1.2",
            },
            "127.0.0.1": {
              ...(exceptionDomains["127.0.0.1"] || {}),
              NSIncludesSubdomains: true,
              NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
              NSTemporaryExceptionMinimumTLSVersion: "TLSv1.2",
            },
          },
        },
      }
    : {};

  return {
    ...expoConfig,
    newArchEnabled: shouldUseIosNewArchitecture,
    ios: {
      ...ios,
      ...(process.env.IOS_BUILD_NUMBER
        ? { buildNumber: process.env.IOS_BUILD_NUMBER }
        : {}),
      newArchEnabled: shouldUseIosNewArchitecture,
      ...(iosGoogleServicesFile
        ? { googleServicesFile: iosGoogleServicesFile }
        : {}),
      infoPlist: {
        ...infoPlist,
        ...devAts,
      },
    },
    android: {
      ...android,
      ...(androidGoogleServicesFile
        ? { googleServicesFile: androidGoogleServicesFile }
        : {}),
    },
    plugins: [
      // Preserve Scene lifecycle adoption when regenerating the native project.
      "./plugins/withIosSceneLifecycle",
      ...basePlugins,
      [
        "./plugins/withIosNewArchitecture",
        { enabled: shouldUseIosNewArchitecture },
      ],
      "./plugins/withReactNativeFirebaseIos",
      "./plugins/withFmtAppleClang",
      "./plugins/withIosPodsDeploymentTarget",
      "./plugins/withTemisMemoWidget",
    ],
  };
};
