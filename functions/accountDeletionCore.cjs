// Deliberately independent of SDKs, so destructive ordering is unit-testable.
const runAccountDeletionStages = async (stages, onProgress = async () => {}) => {
  const completedStages = [];
  for (const [stage, operation] of stages) {
    try {
      await operation();
      completedStages.push(stage);
      await onProgress([...completedStages]);
    } catch (cause) {
      const error = new Error("Account deletion stage failed");
      error.stage = stage;
      error.completedStages = [...completedStages];
      error.cause = cause;
      throw error;
    }
  }
  return completedStages;
};

const safeFailureCode = (error) => {
  if (["configuration", "IAM_PERMISSION_DENIED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "SERVICE_DISABLED"].includes(error?.reason)) return error.reason;
  const code = error?.code;
  if (code === 9 || code === "failed-precondition") return "configuration";
  if (code === 7 || code === "permission-denied") return "permission";
  if (code === 4 || error?.name === "TimeoutError" || error?.name === "AbortError") return "timeout";
  if ([400, 401, 403, 429].includes(error?.status)) return `http_${error.status}`;
  return "unknown";
};

const validateAppleDeletionConfig = ({ teamId, keyId }) => {
  if (!/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Z0-9]{10}$/.test(keyId)) {
    throw Object.assign(new Error("Invalid Apple deletion configuration"), { reason: "configuration" });
  }
};

const validateRevenueCatProjectId = (projectId) => {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw Object.assign(new Error("Invalid RevenueCat project identifier"), { reason: "configuration" });
  }
};

const externalDeletionFailure = async (response) => {
  const payload = await response.json().catch(() => null);
  // Only documented ErrorInfo categories are retained. Never log response
  // messages, request URLs, customer IDs or authorization headers.
  const allowed = ["IAM_PERMISSION_DENIED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "SERVICE_DISABLED"];
  const reason = payload?.error?.details?.find((detail) => allowed.includes(detail.reason))?.reason;
  return Object.assign(new Error("External deletion request failed"), { status: response.status, reason });
};

module.exports = { runAccountDeletionStages, safeFailureCode, validateAppleDeletionConfig, validateRevenueCatProjectId, externalDeletionFailure };
