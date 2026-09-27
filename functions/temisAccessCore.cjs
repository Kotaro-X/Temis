const ACCESS_LEASE_MS = 24 * 60 * 60 * 1000;
const AI_WEEKLY_LIMIT = 10;
const RESERVATION_TTL_MS = 10 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const toMillis = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return null;
};

const isActiveUnlimitedGrant = (grant, now = Date.now()) => {
  const expiresAt = toMillis(grant?.expiresAt);
  return grant?.active === true &&
    (grant.grantType === "staff_free" || grant.grantType === "invite_free") &&
    (expiresAt === null || expiresAt > now);
};

const startOfJstWeek = (now = Date.now()) => {
  const local = new Date(now + JST_OFFSET_MS);
  const day = local.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const mondayLocalMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - daysSinceMonday,
  );
  return mondayLocalMidnight - JST_OFFSET_MS;
};

const getJstWeek = (now = Date.now()) => {
  const weekStartsAt = startOfJstWeek(now);
  const resetsAt = weekStartsAt + 7 * 24 * 60 * 60 * 1000;
  const localStart = new Date(weekStartsAt + JST_OFFSET_MS);
  const weekKey = [
    localStart.getUTCFullYear(),
    String(localStart.getUTCMonth() + 1).padStart(2, "0"),
    String(localStart.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return { weekKey, weekStartsAt, resetsAt };
};

const validRequestId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);

const createTemisAccessService = ({ db, HttpsError, verifyRevenueCat }) => {
  const accessRef = (uid) => db.doc(`temisAccessStates/${uid}`);

  const readValidLease = async (uid, now = Date.now()) => {
    const snapshot = await accessRef(uid).get();
    const state = snapshot.exists ? snapshot.data() : null;
    return state?.userId === uid && state?.verifiedUntil > now ? state : null;
  };

  const refreshAccess = async (uid, { force = false } = {}) => {
    const now = Date.now();
    const existing = await readValidLease(uid, now);
    if (existing && !force) return existing;

    const grantSnapshot = await db.doc(`subscriptionAccess/${uid}`).get();
    const grant = grantSnapshot.exists ? grantSnapshot.data() : null;
    let tier = "free";
    let source = "none";
    let verifiedUntil = now + ACCESS_LEASE_MS;

    if (isActiveUnlimitedGrant(grant, now)) {
      tier = "plus";
      source = grant.grantType;
      const grantExpiry = toMillis(grant.expiresAt);
      if (grantExpiry !== null) verifiedUntil = Math.min(verifiedUntil, grantExpiry);
    } else {
      try {
        if (await verifyRevenueCat(uid)) {
          tier = "plus";
          source = "revenuecat";
        }
      } catch (_error) {
        if (existing) return existing;
        throw new HttpsError(
          "unavailable",
          "Temis access could not be refreshed. Please try again.",
        );
      }
    }

    const state = {
      userId: uid,
      tier,
      source,
      verifiedAt: now,
      verifiedUntil,
      updatedAt: now,
    };
    await accessRef(uid).set(state);
    return state;
  };

  const getAccess = async (uid) => refreshAccess(uid);

  return { getAccess, readValidLease, refreshAccess };
};

const createTemisAIUsageService = ({ db, HttpsError, getAccess }) => {
  const usageRef = (uid, weekKey) => db.doc(`temisAIWeeklyUsage/${uid}__${weekKey}`);
  const reservationRef = (uid, _weekKey, requestId) =>
    db.doc(`temisAIUsageReservations/${uid}__${requestId}`);

  const publicUsage = (access, usage, week) => ({
    tier: access.tier,
    unlimited: access.tier === "plus",
    weekKey: week.weekKey,
    weekStartsAt: week.weekStartsAt,
    resetsAt: week.resetsAt,
    used: access.tier === "plus" ? 0 : Math.max(0, Number(usage?.used) || 0),
    limit: access.tier === "plus" ? null : AI_WEEKLY_LIMIT,
    remaining: access.tier === "plus"
      ? null
      : Math.max(0, AI_WEEKLY_LIMIT - Math.max(0, Number(usage?.used) || 0)),
  });

  const getUsage = async (uid, accessOverride = null) => {
    const [access, week] = await Promise.all([accessOverride ?? getAccess(uid), Promise.resolve(getJstWeek())]);
    if (access.tier === "plus") return publicUsage(access, null, week);
    const snapshot = await usageRef(uid, week.weekKey).get();
    return publicUsage(access, snapshot.exists ? snapshot.data() : null, week);
  };

  const begin = async (uid, surface, requestId) => {
    if (!(["memo", "commons"].includes(surface)) || !validRequestId(requestId)) {
      throw new HttpsError("invalid-argument", "A valid AI surface and requestId are required.");
    }
    const access = await getAccess(uid);
    const week = getJstWeek();
    if (access.tier === "plus") {
      return { ...publicUsage(access, null, week), requestId, reserved: false };
    }
    const oldReservations = await db.collection("temisAIUsageReservations")
      .where("userId", "==", uid)
      .where("weekKey", "==", week.weekKey)
      .get();
    for (const document of oldReservations.docs) {
      const reservation = document.data();
      if (
        (reservation.status === "reserved" || reservation.status === "running")
        && reservation.expiresAt <= Date.now()
      ) {
        await settle(uid, reservation.requestId, "refunded");
      }
    }

    const result = await db.runTransaction(async (transaction) => {
      const counterRef = usageRef(uid, week.weekKey);
      const requestRef = reservationRef(uid, week.weekKey, requestId);
      const [counterSnapshot, requestSnapshot] = await Promise.all([
        transaction.get(counterRef),
        transaction.get(requestRef),
      ]);
      const current = counterSnapshot.exists ? counterSnapshot.data() : null;
      const existing = requestSnapshot.exists ? requestSnapshot.data() : null;
      if (existing) {
        if (existing.userId !== uid || existing.surface !== surface) {
          throw new HttpsError("permission-denied", "This AI reservation is not available.");
        }
        if (existing.status === "refunded") {
          throw new HttpsError("failed-precondition", "This AI reservation was already refunded.");
        }
        if (existing.weekKey !== week.weekKey || existing.expiresAt <= Date.now()) {
          throw new HttpsError("failed-precondition", "This AI reservation has expired.");
        }
        return { usage: current, reused: true };
      }
      const used = Math.max(0, Number(current?.used) || 0);
      if (used >= AI_WEEKLY_LIMIT) {
        throw new HttpsError("resource-exhausted", "The weekly Temis AI limit has been reached.");
      }
      const timestamp = Date.now();
      const nextUsage = {
        userId: uid,
        weekKey: week.weekKey,
        weekStartsAt: week.weekStartsAt,
        resetsAt: week.resetsAt,
        used: used + 1,
        limit: AI_WEEKLY_LIMIT,
        updatedAt: timestamp,
      };
      transaction.set(counterRef, nextUsage);
      transaction.set(requestRef, {
        userId: uid,
        weekKey: week.weekKey,
        weekStartsAt: week.weekStartsAt,
        resetsAt: week.resetsAt,
        requestId,
        surface,
        status: "reserved",
        createdAt: timestamp,
        expiresAt: timestamp + RESERVATION_TTL_MS,
      });
      return { usage: nextUsage, reused: false };
    });
    return {
      ...publicUsage(access, result.usage, week),
      requestId,
      reserved: true,
      reused: result.reused,
    };
  };

  const claim = async (uid, surface, requestId) => {
    const access = await getAccess(uid);
    if (access.tier === "plus") return { unlimited: true };
    if (!validRequestId(requestId)) {
      throw new HttpsError("failed-precondition", "A Temis AI reservation is required.");
    }
    const week = getJstWeek();
    await db.runTransaction(async (transaction) => {
      const ref = reservationRef(uid, week.weekKey, requestId);
      const snapshot = await transaction.get(ref);
      const reservation = snapshot.exists ? snapshot.data() : null;
      if (!reservation || reservation.userId !== uid || reservation.surface !== surface) {
        throw new HttpsError("failed-precondition", "A valid Temis AI reservation is required.");
      }
      if (reservation.status !== "reserved") {
        throw new HttpsError("failed-precondition", "This Temis AI reservation was already used.");
      }
      if (reservation.weekKey !== week.weekKey || reservation.expiresAt <= Date.now()) {
        throw new HttpsError("failed-precondition", "This AI reservation has expired.");
      }
      transaction.update(ref, { status: "running" });
    });
    return { unlimited: false, weekKey: week.weekKey };
  };

  const settle = async (uid, requestId, status, reservedOnly = false) => {
    if (!validRequestId(requestId)) return getUsage(uid);
    const week = getJstWeek();
    await db.runTransaction(async (transaction) => {
      const requestRef = reservationRef(uid, week.weekKey, requestId);
      const requestSnapshot = await transaction.get(requestRef);
      const reservation = requestSnapshot.exists ? requestSnapshot.data() : null;
      if (!reservation || reservation.userId !== uid) return;
      if (reservedOnly && reservation.status !== "reserved") return;
      const reservationWeek = {
        weekKey: reservation.weekKey,
        weekStartsAt: reservation.weekStartsAt,
        resetsAt: reservation.resetsAt,
      };
      const counterRef = usageRef(uid, reservation.weekKey);
      const counterSnapshot = await transaction.get(counterRef);
      if (status === "completed") {
        if (reservation.status === "running" || reservation.status === "reserved") {
          transaction.update(requestRef, { status: "completed" });
        }
        return;
      }
      if (reservation.status === "completed" || reservation.status === "refunded") return;
      const used = Math.max(0, Number(counterSnapshot.data()?.used) || 0);
      transaction.update(requestRef, { status: "refunded" });
      transaction.set(counterRef, {
        userId: uid,
        weekKey: reservationWeek.weekKey,
        weekStartsAt: reservationWeek.weekStartsAt,
        resetsAt: reservationWeek.resetsAt,
        used: Math.max(0, used - 1),
        limit: AI_WEEKLY_LIMIT,
        updatedAt: Date.now(),
      });
    });
    return getUsage(uid);
  };

  return {
    begin,
    claim,
    complete: (uid, requestId) => settle(uid, requestId, "completed"),
    refund: (uid, requestId) => settle(uid, requestId, "refunded"),
    cancel: (uid, requestId) => settle(uid, requestId, "refunded", true),
    getUsage,
  };
};

module.exports = {
  ACCESS_LEASE_MS,
  AI_WEEKLY_LIMIT,
  RESERVATION_TTL_MS,
  createTemisAccessService,
  createTemisAIUsageService,
  getJstWeek,
  isActiveUnlimitedGrant,
  startOfJstWeek,
  validRequestId,
};
