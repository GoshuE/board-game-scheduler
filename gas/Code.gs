const SPREADSHEET_ID = '1hRGTXku0-RVBE5rHx45oce1qwW_LGu2ARb4ci3Deb08';
const APP_KEY = '';
const STATE_SHEET_NAME = 'State';
const MEMBERS = ['郷朱', '彩乃', '純子', '政比呂', '未紗'];
const OWNER = '郷朱';

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const callback = params.callback || 'callback';

  try {
    assertKey_(params.key || '');

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const result = handleAction_(params);
      return jsonp_(callback, result);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonp_(callback, { ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function handleAction_(params) {
  const action = params.action || 'get';
  const state = readState_();

  if (action === 'get') {
    return ok_(state);
  }

  if (action === 'setVote') {
    const name = validateMember_(params.name);
    const date = validateDate_(params.date);
    const value = params.value || '';
    if (value && value !== 'o' && value !== 'tri') throw new Error('Invalid vote value');
    if (!state.availability[name]) state.availability[name] = {};
    if (value) state.availability[name][date] = value;
    else delete state.availability[name][date];
    return saveAndOk_(state);
  }

  if (action === 'addComment') {
    const name = validateMember_(params.name);
    const date = validateDate_(params.date);
    const text = String(params.text || '').trim();
    if (!text) throw new Error('Comment is empty');
    if (text.length > 500) throw new Error('Comment is too long');
    state.comments.push({ date, name, text, ts: Date.now() });
    return saveAndOk_(state);
  }

  if (action === 'setDecided') {
    assertOwner_(params.actor);
    const date = validateDate_(params.date);
    const decided = params.decided === '1';
    const index = state.decidedDates.indexOf(date);
    if (decided && index < 0) state.decidedDates.push(date);
    if (!decided && index >= 0) state.decidedDates.splice(index, 1);
    state.decidedDates.sort();
    return saveAndOk_(state);
  }

  if (action === 'reset') {
    assertOwner_(params.actor);
    return saveAndOk_(defaultState_());
  }

  throw new Error('Unknown action');
}

function readState_() {
  const sheet = getStateSheet_();
  const raw = sheet.getRange(1, 1).getValue();
  if (!raw) {
    const initial = defaultState_();
    writeState_(initial);
    return initial;
  }
  try {
    return normalizeState_(JSON.parse(raw));
  } catch (err) {
    const recovered = defaultState_();
    writeState_(recovered);
    return recovered;
  }
}

function writeState_(state) {
  const sheet = getStateSheet_();
  sheet.getRange(1, 1).setValue(JSON.stringify(normalizeState_(state)));
  sheet.getRange(1, 2).setValue(new Date());
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
}

function saveAndOk_(state) {
  writeState_(state);
  return ok_(state);
}

function ok_(state) {
  return {
    ok: true,
    state: normalizeState_(state),
    updatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss')
  };
}

function defaultState_() {
  const availability = {};
  MEMBERS.forEach(name => availability[name] = {});
  return {
    members: MEMBERS.slice(),
    owner: OWNER,
    availability,
    decidedDates: [],
    comments: []
  };
}

function normalizeState_(data) {
  const sourceAvailability = data && data.availability && typeof data.availability === 'object'
    ? data.availability
    : {};
  const availability = {};
  MEMBERS.forEach(name => {
    const dates = sourceAvailability[name] && typeof sourceAvailability[name] === 'object'
      ? sourceAvailability[name]
      : {};
    availability[name] = {};
    Object.keys(dates).forEach(date => {
      const value = dates[date];
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (value === 'o' || value === 'tri')) {
        availability[name][date] = value;
      }
    });
  });

  return {
    members: MEMBERS.slice(),
    owner: OWNER,
    availability,
    decidedDates: Array.isArray(data && data.decidedDates)
      ? data.decidedDates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()
      : [],
    comments: Array.isArray(data && data.comments)
      ? data.comments
          .filter(comment => comment && MEMBERS.indexOf(comment.name) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(comment.date))
          .map(comment => ({
            date: comment.date,
            name: comment.name,
            text: String(comment.text || '').slice(0, 500),
            ts: Number(comment.ts) || Date.now()
          }))
      : []
  };
}

function getStateSheet_() {
  const spreadsheet = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Spreadsheet is not available');

  let sheet = spreadsheet.getSheetByName(STATE_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(STATE_SHEET_NAME);
  sheet.hideSheet();
  return sheet;
}

function assertKey_(key) {
  if (APP_KEY && key !== APP_KEY) throw new Error('Invalid key');
}

function assertOwner_(actor) {
  if (actor !== OWNER) throw new Error('Only owner can update decided dates');
}

function validateMember_(name) {
  if (MEMBERS.indexOf(name) < 0) throw new Error('Invalid member');
  return name;
}

function validateDate_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Invalid date');
  return date;
}

function jsonp_(callback, payload) {
  const safeCallback = /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback) ? callback : 'callback';
  const body = safeCallback + '(' + JSON.stringify(payload) + ');';
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}
