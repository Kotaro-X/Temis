import { useCallback, useEffect, useRef } from "react";
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
};

export const useAppBootstrap = ({ syncNow }: Args) => {
  // Refreshing app data can update context values and therefore callback
  // identities. Keep the latest callbacks without treating that refresh as a
  // new app launch; otherwise a completed sync immediately starts another one.
  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;

  const runSyncCycle = useCallback(
    () =>
      cleanupExpiredLocalDeletedState()
        .then(() => syncNowRef.current()),
    [],
  );

  useEffect(() => {
    runSyncCycle().catch((error) => {
      const { errorCode } = classifySyncError(error, "load_local_changes");
      console.warn(`[cloudSync] bootstrap failed code=${errorCode}`);
    });
  }, [runSyncCycle]);

  useEffect(() => {
    let wasBackground = AppState.currentState === "background";
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") wasBackground = true;
      if (state !== "active") {
        return;
      }
      // Native authentication sheets use inactive -> active, not a resume.
      if (!wasBackground) return;
      wasBackground = false;
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
      `[Embedding] provider=${config.provider}`,
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
