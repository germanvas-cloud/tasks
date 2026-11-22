/* Автокопия apps-script/Core.js. Не править здесь. */
/**
 * Core.js: общий код для Apps Script, мини-аппа (web/core.js) и тестов (Node).
 * Только чистые функции: даты, разбор текста, группировка задач, проверка initData.
 * Здесь не должно быть названий сфер, проектов и любых личных данных:
 * копия этого файла лежит в публичном репозитории мини-аппа.
 * Правки делать только тут, затем: node tests/sync.js (копирует в web/core.js).
 */

/* ===================== ЧИСТЫЕ ФУНКЦИИ (без сервисов Google) ===================== */

var WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
var WD_WORDS = [
  ['воскресенье', 'воскресенья', 'вс'],
  ['понедельник', 'понедельника', 'пн'],
  ['вторник', 'вторника', 'вт'],
  ['среда', 'среду', 'среды', 'ср'],
  ['четверг', 'четверга', 'чт'],
  ['пятница', 'пятницу', 'пятницы', 'пт'],
  ['суббота', 'субботу', 'субботы', 'сб']
];

function ymdToParts(ymd) { var p = ymd.split('-'); return [+p[0], +p[1], +p[2]]; }
function ymdFromUTC(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function ymdAdd(ymd, days) {
  var p = ymdToParts(ymd);
  return ymdFromUTC(new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)));
}
function ymdWeekday(ymd) { var p = ymdToParts(ymd); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
function ymdDiff(a, b) { // b - a в днях
  var pa = ymdToParts(a), pb = ymdToParts(b);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function ymdHuman(ymd) { var p = ymdToParts(ymd); return pad2(p[2]) + '.' + pad2(p[1]) + ', ' + WD_SHORT[ymdWeekday(ymd)]; }
function nextWeekday(today, wd, allowToday) {
  var cur = ymdWeekday(today);
  var diff = (wd - cur + 7) % 7;
  if (diff === 0 && !allowToday) diff = 7;
  return ymdAdd(today, diff);
}
function escRe(s) { return s.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'); }
function normalize(s) { return (s || '').toLowerCase().replace(/ё/g, 'е'); }

/** Ищет дату в тексте. Возвращает {ymd, match} или null. */
function parseDateRu(text, today) {
  var t = normalize(text);
  var m;
  if ((m = t.match(/(^|[^\d])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?!\d)/))) {
    var d = +m[2], mo = +m[3], y = m[4] ? +m[4] : ymdToParts(today)[0];
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      var ymd = y + '-' + pad2(mo) + '-' + pad2(d);
      if (!m[4] && ymdDiff(today, ymd) < -60) ymd = (y + 1) + '-' + pad2(mo) + '-' + pad2(d);
      return { ymd: ymd, match: m[0].trim() };
    }
  }
  if ((m = t.match(/послезавтра/))) return { ymd: ymdAdd(today, 2), match: m[0] };
  if ((m = t.match(/завтра/))) return { ymd: ymdAdd(today, 1), match: m[0] };
  if ((m = t.match(/сегодня/))) return { ymd: today, match: m[0] };
  if ((m = t.match(/через\s+(\d+)\s+(дн[а-я]*|день)/))) return { ymd: ymdAdd(today, +m[1]), match: m[0] };
  if ((m = t.match(/через\s+недел/))) return { ymd: ymdAdd(today, 7), match: m[0] };
  if ((m = t.match(/(на\s+этой\s+неделе|до\s+конца\s+недели)/))) return { ymd: nextWeekday(today, 5, true), match: m[0] };
  if ((m = t.match(/(на\s+следующей\s+неделе)/))) return { ymd: ymdAdd(nextWeekday(today, 1, false), 0), match: m[0] };
  for (var wd = 0; wd < 7; wd++) {
    for (var k = 0; k < WD_WORDS[wd].length; k++) {
      var w = WD_WORDS[wd][k];
      var re = new RegExp('(^|[^а-яa-z])((?:до|к|в|во|на)\\s+)?' + escRe(w) + '(?![а-яa-z])');
      if ((m = t.match(re))) return { ymd: nextWeekday(today, wd, true), match: m[0].trim() };
    }
  }
  return null;
}

/** projects: [{sphere, project, aliases:[...]}]. Возвращает {sphere, project, rest} */
function detectProject(text, projects) {
  var raw = (text || '').trim();
  var t = normalize(raw);
  var best = null;
  // 1) префикс "Алиас:" сильнее всего
  var pm = t.match(/^([^:\n]{1,30}):\s*/);
  projects.forEach(function (p) {
    p.aliases.forEach(function (a) {
      a = normalize(a).trim(); if (!a) return;
      if (pm && pm[1].trim() === a) {
        best = { sphere: p.sphere, project: p.project, rest: raw.slice(pm[0].length), score: 100 + a.length };
      }
    });
  });
  if (best) return best;
  // 2) упоминание в тексте (целым словом)
  projects.forEach(function (p) {
    p.aliases.forEach(function (a) {
      a = normalize(a).trim(); if (!a) return;
      var re = new RegExp('(^|[^а-яa-z0-9])' + escRe(a) + '(?![а-яa-z0-9])');
      if (re.test(t)) {
        var score = a.length + (p.project ? 1 : 0);
        var rest = raw;
        var st = t.match(new RegExp('^' + escRe(a) + '[\\s,.-]+'));
        if (st) rest = raw.slice(st[0].length);
        if (!best || score > best.score) best = { sphere: p.sphere, project: p.project, rest: rest, score: score };
      }
    });
  });
  return best || { sphere: 'Личное', project: '', rest: raw, score: 0 };
}

/** Разбор без ИИ: одна задача из текста. */
function ruleParse(text, today, projects) {
  var pr = detectProject(text, projects);
  var title = pr.rest;
  var dt = parseDateRu(title, today);
  if (dt) {
    var re = new RegExp('\\s*' + escRe(dt.match) + '\\s*', 'i');
    var cleaned = title.replace(re, ' ').replace(/\s{2,}/g, ' ').replace(/[\s,.;]+$/, '').trim();
    if (cleaned.length >= 3) title = cleaned;
  }
  title = title.replace(/^\s*[-:,]\s*/, '').trim();
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
  return { type: 'create', sphere: pr.sphere, project: pr.project, title: title, deadline: dt ? dt.ymd : '', note: '', ipr: '' };
}

/** Повторяющиеся задачи: подходит ли правило на дату. 'пн,пт' | 'месяц:1' | 'ежедневно' | 'будни' */
function ruleMatches(rule, ymd) {
  var r = normalize(rule).replace(/\s/g, '');
  if (!r) return false;
  if (r === 'ежедневно') return true;
  var wd = ymdWeekday(ymd);
  if (r === 'будни') return wd >= 1 && wd <= 5;
  var m = r.match(/^месяц:(\d{1,2})$/);
  if (m) return ymdToParts(ymd)[2] === +m[1];
  var days = r.split(',');
  return days.indexOf(WD_SHORT[wd]) !== -1;
}


function isRoutine(title) {
  return /(отчет|отчёт|сверк|закрыти|one-pager|ванпейдж|статистик)/i.test(title || '');
}

var ST_DONE = 'Готово', ST_CANCEL = 'Отменена', ST_WAIT = 'Жду ответа';
var WAIT_STALE_DAYS = 3;
var MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function isOpenTask(t) { return t.status !== ST_DONE && t.status !== ST_CANCEL; }

/** "пн 24.11" */
function ymdShort(ymd) { var p = ymdToParts(ymd); return WD_SHORT[ymdWeekday(ymd)] + ' ' + pad2(p[2]) + '.' + pad2(p[1]); }
/** "24.11" */
function ymdDM(ymd) { var p = ymdToParts(ymd); return pad2(p[2]) + '.' + pad2(p[1]); }

/** Подпись дня в списках: "Сегодня, вс 22.11", "Завтра, пн 23.11", "вт 24.11" */
function dayLabel(ymd, today) {
  var d = ymdDiff(today, ymd);
  if (d === 0) return 'Сегодня, ' + ymdShort(ymd);
  if (d === 1) return 'Завтра, ' + ymdShort(ymd);
  return ymdShort(ymd);
}

/** Короткий срок для ответа бота и карточки: "сегодня", "завтра", "до пт", "до 05.12", "без срока" */
function deadlineShort(ymd, today) {
  if (!ymd) return 'без срока';
  var d = ymdDiff(today, ymd);
  if (d < 0) return 'было ' + ymdDM(ymd);
  if (d === 0) return 'на сегодня';
  if (d === 1) return 'на завтра';
  if (d < 7) return 'до ' + WD_SHORT[ymdWeekday(ymd)];
  return 'до ' + ymdDM(ymd);
}

/** Быстрые даты для формы: сегодня, завтра, пятница (ближайшая, включая сегодня), следующий понедельник */
function quickDates(today) {
  return {
    today: today,
    tomorrow: ymdAdd(today, 1),
    friday: nextWeekday(today, 5, true),
    nextMonday: nextWeekday(today, 1, false)
  };
}

/** Новая дата для быстрых переносов. to: today | tomorrow | week | date */
function moveTarget(task, to, today, date) {
  if (to === 'today') return today;
  if (to === 'tomorrow') return ymdAdd(today, 1);
  if (to === 'week') return ymdAdd(task.deadline && task.deadline >= today ? task.deadline : today, 7);
  if (to === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(date || '')) return date;
  return null;
}

function waitDays(t, today) { return t.waitSince ? ymdDiff(t.waitSince, today) : 0; }

/** Фильтр по сфере и проекту ('' = все) */
function filterTasks(tasks, sphere, project) {
  return tasks.filter(function (t) {
    return isOpenTask(t) && (!sphere || t.sphere === sphere) && (!project || t.project === project);
  });
}

/** Сортировка: порядок сфер, потом проект, потом номер (дата создания) */
function makeSorter(sphereOrder) {
  return function (a, b) {
    var sa = sphereOrder.indexOf(a.sphere), sb = sphereOrder.indexOf(b.sphere);
    if (sa < 0) sa = 99; if (sb < 0) sb = 99;
    if (sa !== sb) return sa - sb;
    if ((a.project || '') !== (b.project || '')) return (a.project || '') < (b.project || '') ? -1 : 1;
    return a.id - b.id;
  };
}

/**
 * Раскладка задач по экранам мини-аппа.
 * tasks: уже отфильтрованные открытые задачи.
 * Сегодня: просрочено + на сегодня + "жду ответа" 3+ дней (без повторов).
 * Неделя: сегодня..сегодня+6 по дням. Месяц: сегодня..сегодня+29 по неделям (пн-вс) + без срока.
 */
function buildViews(tasks, today, sphereOrder) {
  var sorter = makeSorter(sphereOrder || []);
  var open = tasks.filter(isOpenTask).slice().sort(sorter);
  var overdue = [], todayList = [], waiting = [], shown = {};
  open.forEach(function (t) {
    if (t.deadline && t.deadline < today) { overdue.push(t); shown[t.id] = 1; }
    else if (t.deadline === today) { todayList.push(t); shown[t.id] = 1; }
  });
  overdue.sort(function (a, b) { return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : sorter(a, b); });
  open.forEach(function (t) {
    if (!shown[t.id] && t.status === ST_WAIT && waitDays(t, today) >= WAIT_STALE_DAYS) waiting.push(t);
  });
  waiting.sort(function (a, b) { return waitDays(b, today) - waitDays(a, today) || sorter(a, b); });

  var weekEnd = ymdAdd(today, 6), days = [], byDay = {};
  open.forEach(function (t) {
    if (t.deadline && t.deadline >= today && t.deadline <= weekEnd) (byDay[t.deadline] = byDay[t.deadline] || []).push(t);
  });
  Object.keys(byDay).sort().forEach(function (d) { days.push({ ymd: d, label: dayLabel(d, today), tasks: byDay[d] }); });

  var monthEnd = ymdAdd(today, 29), weeks = [], noDate = [], weekMap = {};
  var thisMonday = ymdAdd(today, -((ymdWeekday(today) + 6) % 7));
  open.forEach(function (t) {
    if (!t.deadline) { noDate.push(t); return; }
    if (t.deadline < today || t.deadline > monthEnd) return;
    var mon = ymdAdd(t.deadline, -((ymdWeekday(t.deadline) + 6) % 7));
    (weekMap[mon] = weekMap[mon] || []).push(t);
  });
  Object.keys(weekMap).sort().forEach(function (mon) {
    var from = mon < today ? today : mon, to = ymdAdd(mon, 6);
    if (to > monthEnd) to = monthEnd;
    var n = ymdDiff(thisMonday, mon) / 7;
    var label = n === 0 ? 'Эта неделя' : 'Следующая неделя';
    var list = weekMap[mon].slice().sort(function (a, b) { return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : sorter(a, b); });
    var range = from === to ? ymdDM(from) : ymdDM(from) + ' - ' + ymdDM(to);
    if (n > 1) label = range;
    weeks.push({ from: from, to: to, label: label, range: range, tasks: list });
  });

  var weekCount = 0; days.forEach(function (d) { weekCount += d.tasks.length; });
  var monthCount = 0; weeks.forEach(function (w) { monthCount += w.tasks.length; });
  return {
    today: { overdue: overdue, today: todayList, waiting: waiting },
    week: { days: days },
    month: { weeks: weeks, noDate: noDate },
    counts: { today: overdue.length + todayList.length, week: weekCount, month: monthCount, noDate: noDate.length,
      overdue: overdue.length, todayOnly: todayList.length, waiting: waiting.length }
  };
}

/** Сводка для бота: "Просрочено 3, на сегодня 5, жду ответа 2" */
function summaryLine(views) {
  var c = views.counts, parts = [];
  if (c.overdue) parts.push('просрочено ' + c.overdue);
  if (c.todayOnly) parts.push('на сегодня ' + c.todayOnly);
  if (c.waiting) parts.push('жду ответа ' + c.waiting);
  if (!parts.length) return 'На сегодня задач нет';
  var s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Задача R10 (или другая "рабочая" сфера) не рутина: можно предложить в достижения */
function suggestAchievement(task, achievementSphere) {
  return task.sphere === achievementSphere && task.achievement !== 'да' && !isRoutine(task.title);
}

/* ===================== Проверка Telegram initData ===================== */

function utf8Bytes(str) {
  var out = [], s = unescape(encodeURIComponent(str));
  for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}
function bytesToHex(bytes) {
  var h = '';
  for (var i = 0; i < bytes.length; i++) { var b = bytes[i] & 255; h += (b < 16 ? '0' : '') + b.toString(16); }
  return h;
}
function decodeQ(s) { return decodeURIComponent(String(s).replace(/\+/g, ' ')); }

function parseInitData(str) {
  var out = {};
  String(str || '').split('&').forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf('=');
    var k = i < 0 ? pair : pair.slice(0, i), v = i < 0 ? '' : pair.slice(i + 1);
    try { out[decodeQ(k)] = decodeQ(v); } catch (e) { out[k] = v; }
  });
  return out;
}

/**
 * Официальный алгоритм Telegram:
 * secret = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = hex(HMAC_SHA256(key=secret, msg=data_check_string)).
 * hmac(keyBytes, msgString) -> массив байтов. Передается снаружи (Node crypto или Utilities в Apps Script).
 * Возвращает {ok, user, reason}.
 */
function checkInitData(initData, botToken, nowSec, hmac, maxAgeSec) {
  if (!initData || !botToken) return { ok: false, reason: 'no_init_data' };
  var data = parseInitData(initData);
  var hash = data.hash;
  if (!hash) return { ok: false, reason: 'no_hash' };
  var dcs = Object.keys(data).filter(function (k) { return k !== 'hash'; }).sort().map(function (k) { return k + '=' + data[k]; }).join('\n');
  var secret = hmac(utf8Bytes('WebAppData'), botToken);
  var calc = bytesToHex(hmac(secret, dcs));
  if (calc.length !== hash.length) return { ok: false, reason: 'bad_hash' };
  var diff = 0;
  for (var i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: 'bad_hash' };
  var age = nowSec - (+data.auth_date || 0);
  if (age > (maxAgeSec || 86400)) return { ok: false, reason: 'expired' };
  var user = null;
  try { user = JSON.parse(data.user || 'null'); } catch (e) { }
  if (!user || !user.id) return { ok: false, reason: 'no_user' };
  return { ok: true, user: user, authDate: +data.auth_date };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseDateRu: parseDateRu, detectProject: detectProject, ruleParse: ruleParse, ruleMatches: ruleMatches,
    isRoutine: isRoutine, ymdAdd: ymdAdd, ymdDiff: ymdDiff, ymdWeekday: ymdWeekday, nextWeekday: nextWeekday,
    buildViews: buildViews, summaryLine: summaryLine, dayLabel: dayLabel, deadlineShort: deadlineShort,
    quickDates: quickDates, moveTarget: moveTarget, filterTasks: filterTasks, suggestAchievement: suggestAchievement,
    parseInitData: parseInitData, checkInitData: checkInitData, bytesToHex: bytesToHex, utf8Bytes: utf8Bytes
  };
}
