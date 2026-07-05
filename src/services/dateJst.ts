const JST_TIMEZONE = "Asia/Tokyo";
const pad2 = (value: number) => String(value).padStart(2, "0");

const toJstDateParts = (date: Date) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: JST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    throw new Error("Failed to format JST date parts.");
  }

  return { year, month, day };
};

const formatYmd = (year: number, month: number, day: number) =>
  `${year}-${pad2(month)}-${pad2(day)}`;

export const getTodayJstYmd = (date: Date = new Date()): string => {
  const { year, month, day } = toJstDateParts(date);
  return formatYmd(year, month, day);
};

export const getWeekStartMondayJstYmd = (date: Date = new Date()): string => {
  const { year, month, day } = toJstDateParts(date);
  const jstMidnightUtcMs = Date.UTC(year, month - 1, day);
  const jstPseudo = new Date(jstMidnightUtcMs);
  const weekday = jstPseudo.getUTCDay();
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  jstPseudo.setUTCDate(jstPseudo.getUTCDate() + diffToMonday);

  return formatYmd(
    jstPseudo.getUTCFullYear(),
    jstPseudo.getUTCMonth() + 1,
    jstPseudo.getUTCDate(),
  );
};
