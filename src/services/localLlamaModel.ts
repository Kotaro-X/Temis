import * as FileSystem from "expo-file-system/legacy";

const MODEL_FILENAME = "local-llm.gguf";
const DEFAULT_MIN_BYTES = 50_000_000;

const normalizeMinBytes = (value: string | undefined): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MIN_BYTES;
  }
  return Math.floor(parsed);
};

export type BundledModelInfo = {
  uri: string;
  size: number;
};

export const resolveBundledModel = async (): Promise<BundledModelInfo> => {
  const bundleDirectory = FileSystem.bundleDirectory;
  if (!bundleDirectory) {
    throw new Error("バンドルディレクトリが取得できませんでした。");
  }
  const uri = `${bundleDirectory}${MODEL_FILENAME}`;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || typeof info.size !== "number") {
    throw new Error(
      "モデルファイルが見つかりませんでした。dev clientを再ビルドしてモデルをバンドルしてください。",
    );
  }
  const minBytes = normalizeMinBytes(
    process.env.EXPO_PUBLIC_LOCAL_LLM_MIN_BYTES,
  );
  if (info.size < minBytes) {
    throw new Error(
      `モデルファイルが小さすぎます。size=${info.size} bytes min=${minBytes} bytes`,
    );
  }
  return { uri, size: info.size };
};
