const { membershipStateFor } = require("../functions/projectAccessCore.cjs");

const planBackfillWrites = ({ uid, verifiedAccess, savedAccess, savedStateExists, memberships, now }) => {
  const keepAccess = savedAccess?.userId === uid && savedAccess.verifiedUntil > now;
  const access = keepAccess ? savedAccess : verifiedAccess;
  if (!access || access.userId !== uid || access.verifiedUntil <= now || !["free", "plus"].includes(access.tier)) {
    throw new Error("A valid verified access lease is required for backfill.");
  }
  return {
    access: keepAccess ? null : access,
    state: savedStateExists ? null : membershipStateFor({ uid, memberships, access, previous: null, now }),
  };
};
module.exports = { planBackfillWrites };
