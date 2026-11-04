const API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'];
class CalendarApiError extends Error {
  constructor(status, reason) { super('Google Calendar request failed.'); this.status = status; this.reason = reason; }
}
const jsonRequest = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new CalendarApiError(response.status, typeof body.error === 'string' ? body.error : body.error?.errors?.[0]?.reason ?? 'api_error');
  return body;
};
const tokenRequest = (config, values) => jsonRequest('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...values }).toString(),
});
const makeApi = accessToken => ({
  request: (path, method = 'GET', body, etag) => jsonRequest(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }),
});
const listCalendars = async api => {
  const calendars = []; let page;
  do {
    const result = await api.request(`/users/me/calendarList?maxResults=250${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
    calendars.push(...(result.items ?? []).filter(item => ['reader', 'writer', 'owner'].includes(item.accessRole)).map(item => ({ id: item.id, name: item.summaryOverride || item.summary, accessRole: item.accessRole, timeZone: item.timeZone || 'Asia/Tokyo' })));
    page = result.nextPageToken;
  } while (page);
  return calendars;
};
module.exports = { SCOPES, CalendarApiError, jsonRequest, tokenRequest, makeApi, listCalendars };
