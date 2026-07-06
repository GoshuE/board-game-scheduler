const SPREADSHEET_ID = '1hRGTXku0-RVBE5rHx45oce1qwW_LGu2ARb4ci3Deb08';
const APP_KEY = '';
const STATE_SHEET_NAME = 'State';
const MEMBERS = ['郷朱', '彩乃', '純子', '政比呂', '未紗'];
const OWNER = '郷朱';
const APP_URL = 'https://goshue.github.io/board-game-scheduler/';
// LINE通知の設定はコードに直書きせず、スクリプトプロパティ（LINE_TOKEN / LINE_GROUP_ID）に保存する

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
    const isNewDecision = decided && index < 0;
    if (decided && index < 0) state.decidedDates.push(date);
    if (!decided && index >= 0) state.decidedDates.splice(index, 1);
    state.decidedDates.sort();
    const result = saveAndOk_(state);
    if (isNewDecision) notifyLine_(buildDecidedMessage_(date));
    return result;
  }

  if (action === 'reset') {
    assertOwner_(params.actor);
    return saveAndOk_(defaultState_());
  }

  if (action === 'nudge') {
    assertOwner_(params.actor);
    const now = Date.now();
    const last = Number(scriptProp_('LAST_NUDGE_TS')) || 0;
    const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6時間：連打・第三者による無料枠枯渇を防ぐ
    let nudgeResult;
    if (now - last < COOLDOWN_MS) {
      nudgeResult = 'cooldown';
    } else {
      const missing = membersWithNoUpcomingVotes_(state);
      if (missing.length === 0) {
        nudgeResult = 'none';
      } else {
        pushLine_([buildNudgeMessage_(missing)]);
        PropertiesService.getScriptProperties().setProperty('LAST_NUDGE_TS', String(now));
        nudgeResult = 'sent';
      }
    }
    const result = ok_(state);
    result.nudgeResult = nudgeResult;
    return result;
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

// ============== LINE 通知 ==============
function scriptProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

// LINEグループへメッセージ配列を送る。トークン/グループID未設定なら何もしない（＝予定表本体は通常どおり動く）
function pushLine_(messages) {
  const token = scriptProp_('LINE_TOKEN');
  const groupId = scriptProp_('LINE_GROUP_ID');
  if (!token || !groupId) return;
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: groupId, messages: messages }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      // 失敗を実行ログに残す（後から不達に気づけるように）
      console.error('LINE push failed: ' + code + ' ' + res.getContentText());
    }
  } catch (err) {
    // 通知の失敗で予定表の保存処理を止めない
    console.error('LINE push error: ' + err);
  }
}

// シンプルなテキスト通知（実施日決定通知などメンション不要のもの）
function notifyLine_(text) {
  pushLine_([{ type: 'text', text: text }]);
}

function buildDecidedMessage_(date) {
  return [
    '🎲 ボドゲ会の開催日が決まりました！',
    '📅 ' + formatDateJa_(date),
    '',
    'カレンダー空けておいてね〜',
    APP_URL
  ].join('\n');
}

// 名前→LINE userId のマップ（スクリプトプロパティ LINE_USER_IDS にJSONで保存）
function getUserIdMap_() {
  const raw = scriptProp_('LINE_USER_IDS');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

// 未入力者への催促メッセージ（textV2）。userIdが分かる人は @メンション、不明な人は名前のみ。
function buildNudgeMessage_(missing) {
  const idMap = getUserIdMap_();
  const substitution = {};
  const parts = missing.map(function (name, i) {
    const uid = idMap[name];
    if (uid) {
      const key = 'm' + i;
      substitution[key] = { type: 'mention', mentionee: { type: 'user', userId: uid } };
      return '{' + key + '}さん';
    }
    return name + 'さん';
  });
  const text = [
    '🎲 ボドゲ会の日程調整、' + parts.join('・') + 'がまだ回答してないみたい！',
    '空いてる日に ○ / △ を入れてね〜',
    APP_URL
  ].join('\n');
  const message = { type: 'textV2', text: text };
  if (Object.keys(substitution).length > 0) message.substitution = substitution;
  return message;
}

// 今日から21日以内に一度も○/△を入れていないメンバーを返す
function membersWithNoUpcomingVotes_(state) {
  const today = todayIso_();
  const horizon = addDaysIso_(today, 21);
  return state.members.filter(function (m) {
    const dates = state.availability[m] || {};
    return !Object.keys(dates).some(function (d) { return d >= today && d <= horizon; });
  });
}

function todayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function addDaysIso_(iso, days) {
  const p = iso.split('-');
  const dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  dt.setDate(dt.getDate() + days);
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDateJa_(iso) {
  const p = iso.split('-');
  const m = Number(p[1]);
  const d = Number(p[2]);
  const dt = new Date(Number(p[0]), m - 1, d);
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return m + '月' + d + '日(' + days[dt.getDay()] + ')';
}

// ============== LINE Webhook（グループIDの自動取得） ==============
// セットアップ時だけ groupId を1回だけ自動取得する「ワンショット」方式。
// 通常運用時は ALLOW_GROUP_CAPTURE が '1' でないため一切書き込まず、
// 第三者が偽イベントを送っても通知先(LINE_GROUP_ID)を乗っ取れない。
// 【使い方】スクリプトプロパティ ALLOW_GROUP_CAPTURE を '1' にしてからBotをグループに招待
//   → 最初のグループイベントで LINE_GROUP_ID を保存し、ALLOW_GROUP_CAPTURE を自動で '0' に戻す。
function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    // 取得モードが有効、かつ未設定のときだけ受け付ける
    if (props.getProperty('ALLOW_GROUP_CAPTURE') === '1' && !props.getProperty('LINE_GROUP_ID')) {
      const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
      const events = Array.isArray(body.events) ? body.events : [];
      for (let i = 0; i < events.length; i++) {
        const src = events[i] && events[i].source ? events[i].source : {};
        if (src.type === 'group' && src.groupId) {
          props.setProperty('LINE_GROUP_ID', src.groupId);
          props.setProperty('ALLOW_GROUP_CAPTURE', '0'); // 1回取得したら自動でロック
          break;
        }
      }
    }
  } catch (err) {
    // Webhook検証や想定外のペイロードでも 200 を返す
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

// ============== 自動催促（週次トリガー） ==============
// 毎週決まった曜日・時刻に、未入力者がいればLINEで催促する。
// トリガーは setupWeeklyNudge() を一度手動実行して作成する。
function weeklyNudge() {
  var now = Date.now();
  var last = Number(scriptProp_('LAST_NUDGE_TS')) || 0;
  if (now - last < 6 * 60 * 60 * 1000) return; // 直近6時間に送信済みなら手動催促との重複を避けてスキップ
  var state = readState_();
  var missing = membersWithNoUpcomingVotes_(state);
  if (missing.length === 0) return; // 全員入力済みなら送らない
  pushLine_([buildNudgeMessage_(missing)]);
  PropertiesService.getScriptProperties().setProperty('LAST_NUDGE_TS', String(now));
}

// 週次トリガーを作成/再作成する（毎週月曜の20時台に weeklyNudge を実行）。
// GASエディタでこの関数を一度だけ手動実行すること。曜日・時刻を変えたいときは
// onWeekDay / atHour を編集して再実行すれば、古いトリガーは自動で置き換わる。
function setupWeeklyNudge() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyNudge') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyNudge')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(20)
    .create();
}
