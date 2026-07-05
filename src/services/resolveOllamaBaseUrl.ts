import { NativeModules } from "react-native";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

const parseHostFromUrl = (value: string): string | null => {
  const match = value.match(/^https?:\/\/([^/:]+)(?::\d+)?/i);
  return match?.[1] ?? null;
};

const getDevServerHost = (): string | null => {
  if (typeof __DEV__ !== "boolean" || !__DEV__) {
    return null;
  }
  const scriptURL = NativeModules?.SourceCode?.scriptURL;
  if (typeof scriptURL !== "string" || !scriptURL) {
    return null;
  }
  return parseHostFromUrl(scriptURL);
};

const isLoopbackHost = (host: string | null): boolean =>
  !!host && LOOPBACK_HOSTS.has(host);

export const resolveOllamaBaseUrl = (
  baseUrl: string,
  port = 11434,
): string => {
  const trimmed = baseUrl.trim();
  const baseHost = parseHostFromUrl(trimmed);
  if (!isLoopbackHost(baseHost)) {
    return trimmed;
  }
  const devHost = getDevServerHost();
  if (devHost && !isLoopbackHost(devHost)) {
    return `http://${devHost}:${port}`;
  }
  return trimmed;
};
