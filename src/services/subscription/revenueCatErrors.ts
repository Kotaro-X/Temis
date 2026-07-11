const PURCHASE_CANCELLED_ERROR_CODE = "1";
const PURCHASE_CANCELLED_MESSAGE = /^purchase was cancelled\.?$/i;

type RevenueCatErrorLike = {
  code?: unknown;
  message?: unknown;
  userCancelled?: unknown;
};

export const isRevenueCatPurchaseCancelledError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as RevenueCatErrorLike;
  if (candidate.code === PURCHASE_CANCELLED_ERROR_CODE) {
    return true;
  }
  if (candidate.userCancelled === true) {
    return true;
  }
  return (
    typeof candidate.message === "string" &&
    PURCHASE_CANCELLED_MESSAGE.test(candidate.message.trim())
  );
};

export const shouldSuppressRevenueCatLog = (
  logLevel: string,
  message: string,
): boolean =>
  logLevel === "ERROR" && PURCHASE_CANCELLED_MESSAGE.test(message.trim());
