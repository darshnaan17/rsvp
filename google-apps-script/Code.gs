const SETTINGS = Object.freeze({
  responsesSheet: "Responses",
  attendeesSheet: "Attendees",
  deadline: "2026-10-01T00:00:00-04:00",
  maxAdditionalGuests: 20,
});

function doGet(e) {
  const callback = safeCallback_(e.parameter.callback);
  const result = String(e.parameter.action || "") === "get"
    ? getRsvp_(String(e.parameter.token || ""))
    : { ok: true, closed: isClosed_() };
  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(result)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  let result;
  try {
    result = saveRsvp_(JSON.parse(e.parameter.payload || "{}"));
  } catch (error) {
    result = { ok: false, message: error.message || "Your RSVP could not be saved." };
  }
  const safe = JSON.stringify({ source: "darshan-rsvp", ...result }).replace(/</g, "\\u003c");
  return HtmlService.createHtmlOutput(
    `<!doctype html><meta charset="utf-8"><script>parent.postMessage(${safe}, "*");</script>`
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function saveRsvp_(payload) {
  if (isClosed_()) return { ok: false, message: "Online RSVPs closed on September 30. Please contact Jayesh Vala at 813-727-6708." };
  if (String(payload.website || "").trim()) return { ok: false, message: "Your RSVP could not be saved." };

  const firstName = cleanName_(payload.firstName);
  const lastName = cleanName_(payload.lastName);
  const status = String(payload.status || "");
  const suppliedGuests = Array.isArray(payload.guests) ? payload.guests : [];
  if (!firstName || !lastName) throw new Error("Please enter your first and last name.");
  if (!["attending", "declined"].includes(status)) throw new Error("Please choose whether you will attend.");
  if (suppliedGuests.length > SETTINGS.maxAdditionalGuests) throw new Error("Please contact the host to RSVP for a larger party.");

  const guests = status === "attending"
    ? suppliedGuests.map((guest) => ({ firstName: cleanName_(guest.firstName), lastName: cleanName_(guest.lastName) }))
    : [];
  if (guests.some((guest) => !guest.firstName || !guest.lastName)) throw new Error("Enter a first and last name for every guest.");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const responses = book.getSheetByName(SETTINGS.responsesSheet);
    const attendees = book.getSheetByName(SETTINGS.attendeesSheet);
    if (!responses || !attendees) throw new Error("The response workbook is not configured correctly.");

    const now = new Date();
    const suppliedToken = String(payload.token || "").trim();
    let row = suppliedToken ? findTokenRow_(responses, suppliedToken) : 0;
    const tokenMatched = Boolean(row);
    if (String(payload.mode || "") === "update" && !tokenMatched) {
      throw new Error("That private edit link is not valid. Please contact the host.");
    }
    if (suppliedToken && !row && !/^[a-f0-9]{64}$/i.test(suppliedToken)) {
      throw new Error("That private edit link is not valid. Please contact the host.");
    }
    if (!row) row = findNameRow_(responses, firstName, lastName);

    const rsvpId = row ? String(responses.getRange(row, 1).getValue()) : Utilities.getUuid();
    const token = tokenMatched ? suppliedToken : suppliedToken || Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    const submittedAt = row ? responses.getRange(row, 8).getValue() : now;
    const revision = row ? Number(responses.getRange(row, 10).getValue() || 0) + 1 : 1;
    const guestCount = status === "attending" ? 1 + guests.length : 0;
    const guestNames = guests.map((guest) => `${guest.firstName} ${guest.lastName}`).join(", ");
    const displayStatus = status === "attending" ? "Will Attend" : "Will Not Attend";
    const values = [[rsvpId, token, firstName, lastName, displayStatus, guestNames, guestCount, submittedAt, now, revision]];

    if (row) responses.getRange(row, 1, 1, 10).setValues(values);
    else { responses.appendRow(values[0]); row = responses.getLastRow(); }
    responses.getRange(row, 8, 1, 2).setNumberFormat("mmm d, yyyy h:mm am/pm");
    replaceAttendees_(attendees, rsvpId, firstName, lastName, status, guests, now);
    return { ok: true, token, status, guestCount };
  } finally {
    lock.releaseLock();
  }
}

function getRsvp_(token) {
  if (!token) return { ok: false, message: "This private edit link is incomplete." };
  if (isClosed_()) return { ok: false, message: "The RSVP deadline has passed. Please contact Jayesh Vala at 813-727-6708." };
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const responses = book.getSheetByName(SETTINGS.responsesSheet);
  const attendees = book.getSheetByName(SETTINGS.attendeesSheet);
  const row = findTokenRow_(responses, token);
  if (!row) return { ok: false, message: "We couldn’t find an RSVP for that private link." };
  const response = responses.getRange(row, 1, 1, 10).getValues()[0];
  const rsvpId = String(response[0]);
  const resultGuests = [];
  if (attendees.getLastRow() > 1) {
    attendees.getRange(2, 1, attendees.getLastRow() - 1, 5).getValues().forEach((person) => {
      if (String(person[0]) === rsvpId && person[3] === "Additional Guest") resultGuests.push({ firstName: person[1], lastName: person[2] });
    });
  }
  return {
    ok: true, token, firstName: response[2], lastName: response[3],
    status: response[4] === "Will Attend" ? "attending" : "declined", guests: resultGuests,
    guestCount: Number(response[6] || 0),
  };
}

function replaceAttendees_(sheet, rsvpId, firstName, lastName, status, guests, updatedAt) {
  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i -= 1) if (String(ids[i][0]) === rsvpId) sheet.deleteRow(i + 2);
  }
  if (status !== "attending") return;
  const rows = [[rsvpId, firstName, lastName, "Primary Guest", updatedAt]];
  guests.forEach((guest) => rows.push([rsvpId, guest.firstName, guest.lastName, "Additional Guest", updatedAt]));
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, 5).setValues(rows);
  sheet.getRange(start, 5, rows.length, 1).setNumberFormat("mmm d, yyyy h:mm am/pm");
}

function findTokenRow_(sheet, token) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const match = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).createTextFinder(token).matchEntireCell(true).findNext();
  return match ? match.getRow() : 0;
}

function findNameRow_(sheet, firstName, lastName) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const names = sheet.getRange(2, 3, sheet.getLastRow() - 1, 2).getDisplayValues();
  const targetFirst = firstName.toLowerCase();
  const targetLast = lastName.toLowerCase();
  for (let index = names.length - 1; index >= 0; index -= 1) {
    if (cleanName_(names[index][0]).toLowerCase() === targetFirst
      && cleanName_(names[index][1]).toLowerCase() === targetLast) return index + 2;
  }
  return 0;
}

function cleanName_(value) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, 60); }
function safeCallback_(value) {
  const callback = String(value || "rsvpCallback");
  return /^[A-Za-z_$][0-9A-Za-z_$\.]{0,80}$/.test(callback) ? callback : "rsvpCallback";
}
function isClosed_() { return Date.now() >= new Date(SETTINGS.deadline).getTime(); }
