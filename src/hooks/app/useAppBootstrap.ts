import { useCallback, useEffect } from "react";
import { AppState } from "react-native";

import { backfillNoteIndexes } from "../../db/noteRepo";
import { ensureDbReady } from "../../db/sqlite";
import { backfillEmbeddings } from "../../services/embeddingBackfill";
import { runPendingEmbeddingJobs } from "../../services/embeddingJobs";
import {
  configureEmbeddingProviderFromEnv,
  runEmbeddingProviderProbe,
} from "../../services/embeddingSettings";
import {
  configureLLMProviderFromEnv,
  runLLMProviderProbe,
} from "../../services/llmSettings";
import { cleanupExpiredLocalDeletedState } from "../../services/sync/syncRetention";
import { classifySyncError } from "../../services/sync/syncDiagnostics";

type Args = {
  syncNow: () => Promise<unknown>;
  onSynced?: () => Promise<void> | void;
};

export const useAppBootstrap = ({ syncNow, onSynced }: Args) => {
  const runSyncCycle = useCallback(
    () =>
      cleanupExpiredLocalDeletedState()
        .then(() => syncNow())
        .then(() => onSynced?.()),
    [onSynced, syncNow],
  );

  useEffect(() => {
    runSyncCycle().catch((error) => {
      const { errorCode } = classifySyncError(error, "load_local_changes");
      console.warn(`[cloudSync] bootstrap failed code=${errorCode}`);
    });
  }, [runSyncCycle]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        return;
      }
      runSyncCycle().catch((error) => {
        const { errorCode } = classifySyncError(error, "load_local_changes");
        console.warn(`[cloudSync] resume failed code=${errorCode}`);
      });
    });
    return () => {
      subscription.remove();
    };
  }, [runSyncCycle]);

  useEffect(() => {
    const config = configureEmbeddingProviderFromEnv();
    const llmConfig = configureLLMProviderFromEnv();

    console.log(
      `[Embedding] provider=${config.useOllama ? "ollama" : "dummy"} model=${config.ollamaModel}`,
    );
    console.log(
      `[LLM] provider=${llmConfig.provider} baseUrl=${llmConfig.ollamaBaseUrl} model=${llmConfig.ollamaModel}`,
    );

    runEmbeddingProviderProbe(config).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Embedding] probe failed: ${message}`);
    });

    runLLMProviderProbe(llmConfig).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[LLM] probe failed: ${message}`);
    });

    ensureDbReady()
      .then(() =>
        backfillNoteIndexes({ batchSize: 20, jobKey: "note-index-backfill-v1" }),
      )
      .then((progress) => {
        console.log(
          `[Backfill][Note] completed ${progress.processed}/${progress.total} reindexed=${progress.reindexed}`,
        );
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Backfill][Note] failed: ${message}`);
      });

    ensureDbReady()
      .then(() =>
        backfillEmbeddings({
          batchSize: 20,
          jobKey: "embedding-backfill-v1",
        }),
      )
      .then(() => runPendingEmbeddingJobs({ limit: 20 }))
      .then((progress) => {
        console.log(
          `[Backfill][Embedding] resumedJobs=${progress.processedJobs} completedJobs=${progress.completedJobs} failedJobs=${progress.failedJobs}`,
        );
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Backfill][Embedding] failed: ${message}`);
      });
  }, []);
};
