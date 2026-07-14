const appJson = require("./app.json");

module.exports = () => {
  const expoConfig = appJson.expo || {};
  const isDevBuild = process.env.NODE_ENV !== "production";

  const ios = expoConfig.ios || {};
  const android = expoConfig.android || {};
  const iosGoogleServicesFile =
    process.env.GOOGLE_SERVICES_PLIST?.trim() || ios.googleServicesFile;
  const androidGoogleServicesFile =
    process.env.GOOGLE_SERVICES_JSON?.trim() || android.googleServicesFile;
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
    ios: {
      ...ios,
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
      ...(expoConfig.plugins || []),
      "./plugins/withBundledModel",
      "./plugins/withReactNativeFirebaseIos",
    ],
  };
};
