/* Мини-апп задач. Данные: Google Таблица через API Apps Script. Логика дат и разбора: core.js. */
(function () {
  'use strict';

  var API_URL = 'https://script.google.com/macros/s/AKfycbwbQlNgC1eOh2c5zH09brCKHO-ttNCUhXtAjwKav5PeqZYlVRv0splsT2kFkDr_uVC6/exec';
  var CACHE_KEY = 'tasks.cache.v1';
  var UI_KEY = 'tasks.ui.v1';
  var COLORS = ['#2f80ed', '#8e5bd8', '#27a170', '#e8912d', '#e5484d', '#1fa2b4', '#c2569b'];
  var ST = { NEW: 'Новая', WORK: 'В работе', WAIT: 'Жду ответа', DONE: 'Готово', CANCEL: 'Отменена' };

  var tg = window.Telegram && window.Telegram.WebApp;
  var params = new URLSearchParams(location.search);
  var DEMO = params.get('demo') === '1' || window.__TASKS_DEMO === true;
  var initData = tg && tg.initData || '';
  var inTelegram = !!initData;

  var state = {
    meta: null, tasks: [], tab: 'today', sphere: '', project: '', loaded: false, error: '',
    updatedAt: 0, collapsedNoDate: true
  };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Telegram ---------- */
  function haptic(kind) {
    try {
      var h = tg && tg.HapticFeedback; if (!h || !inTelegram) return;
      if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
      else if (kind === 'select') h.selectionChanged();
      else h.impactOccurred(kind || 'light');
    } catch (e) { }
  }
  function setupTelegram() {
    if (!tg) return;
    try {
      tg.ready(); tg.expand();
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
      if (tg.setHeaderColor) tg.setHeaderColor('secondary_bg_color');
      if (tg.setBackgroundColor) tg.setBackgroundColor('secondary_bg_color');
      if (inTelegram) document.documentElement.classList.add('tg');
      var applyScheme = function () { document.documentElement.classList.toggle('tg-dark', tg.colorScheme === 'dark'); };
      applyScheme(); tg.onEvent('themeChanged', applyScheme);
    } catch (e) { }
  }

  /* ---------- Кеш ---------- */
  function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { } }
  function saveCache() { if (!DEMO && state.meta) writeJSON(CACHE_KEY, { meta: state.meta, tasks: state.tasks, at: state.updatedAt }); }
  function saveUi() { writeJSON(UI_KEY, { tab: state.tab, sphere: state.sphere, project: state.project }); }

  /* ---------- API ---------- */
  function api(method, p) {
    if (DEMO) return demoApi(method, p || {});
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
    return fetch(API_URL, {
      method: 'POST', body: JSON.stringify({ initData: initData, method: method, params: p || {} }),
      signal: ctrl ? ctrl.signal : undefined, redirect: 'follow'
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(timer);
      if (!j.ok) { var e = new Error(j.error || 'Ошибка'); e.code = j.code; throw e; }
      return j.data;
    }, function (err) {
      clearTimeout(timer);
      var e = new Error(err && err.name === 'AbortError' ? 'Сервер долго не отвечает' : 'Нет связи с сервером'); e.code = 0; throw e;
    });
  }

  /* ---------- Помощники ---------- */
  function today() { return state.meta && state.meta.todayLocal || localToday(); }
  function localToday() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return parts.slice(0, 10);
  }
  function sphereColor(s) {
    var i = state.meta ? state.meta.spheres.indexOf(s) : -1;
    return COLORS[(i < 0 ? 6 : i) % COLORS.length];
  }
  function projectsOf(s) { return state.meta ? state.meta.projects.filter(function (p) { return p.sphere === s; }).map(function (p) { return p.project; }) : []; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function findTask(id) { for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) return state.tasks[i]; return null; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isOpen(t) { return t.status !== ST.DONE && t.status !== ST.CANCEL; }
  function replaceTask(t) {
    var i = state.tasks.findIndex(function (x) { return x.id === t.id; });
    if (!isOpen(t)) { if (i >= 0) state.tasks.splice(i, 1); return; }
    if (i >= 0) state.tasks[i] = t; else state.tasks.push(t);
  }
  function plural(n, a, b, c) { var m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; }

  /* ---------- Отрисовка ---------- */
  function renderChips() {
    var spheres = state.meta ? state.meta.spheres : [];
    var html = '<button class="chip' + (!state.sphere ? ' active' : '') + '" data-sphere="">Все</button>';
    spheres.forEach(function (s) {
      html += '<button class="chip' + (state.sphere === s ? ' active' : '') + '" data-sphere="' + esc(s) + '" style="--c:' + sphereColor(s) + '"><span class="dot"></span>' + esc(s) + '</button>';
    });
    $('sphereChips').innerHTML = html;
    var projects = state.sphere ? projectsOf(state.sphere) : [];
    var pc = $('projectChips');
    pc.hidden = !projects.length;
    if (projects.length) {
      pc.innerHTML = '<button class="chip' + (!state.project ? ' active' : '') + '" data-project="">Все проекты</button>' +
        projects.map(function (p) { return '<button class="chip' + (state.project === p ? ' active' : '') + '" data-project="' + esc(p) + '">' + esc(p) + '</button>'; }).join('');
    }
  }

  var NOTE_ICO = '<svg class="note-ico" width="14" height="14" viewBox="0 0 24 24" aria-label="Есть заметка"><path d="M5 4h14v11l-5 5H5z M14 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  var CHECK_ICO = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function cardHtml(t, mode) {
    var td = today(), pills = '';
    if (mode === 'overdue' && t.deadline) {
      var d = ymdDiff(t.deadline, td);
      pills += '<span class="pill red">просрочено ' + d + ' дн.</span>';
    } else if (mode === 'month' && t.deadline) {
      pills += '<span class="pill">' + esc(dayLabel(t.deadline, td)) + '</span>';
    }
    if (t.status === ST.WAIT) { var wd = t.waitSince ? ymdDiff(t.waitSince, td) : 0; pills += '<span class="pill wait">' + (wd > 0 ? 'жду ' + wd + ' дн.' : 'жду ответа') + '</span>'; }
    else if (t.status === ST.WORK) pills += '<span class="pill">в работе</span>';
    var label = t.sphere + (t.project ? ' / ' + t.project : '');
    var waitBtn = t.status === ST.WAIT ? '<button class="act" data-act="work">В работу</button>' : '<button class="act" data-act="wait">Жду ответа</button>';
    var pending = t.id < 0 ? ' pending' : '';
    return '<div class="card' + pending + '" data-id="' + t.id + '">' +
      '<div class="card-bg"><span>Готово</span><span>Завтра</span></div>' +
      '<div class="card-inner">' +
        '<button class="check" data-act="done" aria-label="Готово">' + CHECK_ICO + '</button>' +
        '<div class="card-body">' +
          '<button class="card-open" data-act="open">' +
            '<div class="title">' + esc(t.title) + (t.note ? NOTE_ICO : '') + '</div>' +
            '<div class="meta"><span class="tag" style="--c:' + sphereColor(t.sphere) + '"><span class="dot"></span>' + esc(label) + '</span>' + pills + '</div>' +
          '</button>' +
          '<div class="card-actions">' +
            '<button class="act" data-act="tomorrow">Завтра</button>' +
            '<button class="act" data-act="week">+неделя</button>' + waitBtn +
          '</div>' +
        '</div>' +
      '</div></div>';
  }

  function section(title, tasks, mode, opts) {
    opts = opts || {};
    if (!tasks.length && !opts.showEmpty) return '';
    var head = '<div class="section-head' + (opts.red ? ' red' : '') + '"><span>' + esc(title) +
      (opts.range ? ' <span class="range">' + esc(opts.range) + '</span>' : '') + '</span><span class="n">' + tasks.length + '</span></div>';
    return '<div class="section">' + head + '<div class="list' + (opts.compact ? ' compact' : '') + '">' +
      tasks.map(function (t) { return cardHtml(t, mode); }).join('') + '</div></div>';
  }

  function skeleton() {
    var card = '<div class="sk-card"><div class="sk sk-dot"></div><div style="flex:1"><div class="sk sk-line" style="width:72%"></div><div class="sk sk-line" style="width:38%;height:10px"></div></div></div>';
    return '<div class="section"><div class="section-head"><span class="sk" style="width:90px;height:12px;display:block"></span></div><div class="list">' + card + card + card + '</div></div>' +
      '<div class="section"><div class="section-head"><span class="sk" style="width:70px;height:12px;display:block"></span></div><div class="list">' + card + card + '</div></div>';
  }

  function render() {
    renderChips();
    var content = $('content');
    if (!state.meta) {
      content.innerHTML = state.error ? '<div class="empty"><b>Не удалось загрузить</b>' + esc(state.error) + '</div>' : skeleton();
      updateCounts(null);
      return;
    }
    var td = today();
    var filtered = filterTasks(state.tasks, state.sphere, state.project);
    var v = buildViews(filtered, td, state.meta.spheres);
    var html = '';
    if (state.tab === 'today') {
      html += section('Просрочено', v.today.overdue, 'overdue', { red: true });
      html += section('На сегодня', v.today.today, 'today');
      html += section('Жду ответа 3+ дней', v.today.waiting, 'wait', { compact: true });
      if (!v.today.overdue.length && !v.today.today.length && !v.today.waiting.length) {
        var next = v.week.days.filter(function (d) { return d.ymd > td; })[0];
        html = '<div class="empty"><b>На сегодня все</b>' + (next ? 'Ближайшее: ' + esc(next.label) + ', ' + next.tasks.length + ' ' + plural(next.tasks.length, 'задача', 'задачи', 'задач') : 'Ближайших задач нет') + '</div>';
      }
    } else if (state.tab === 'week') {
      v.week.days.forEach(function (d) { html += section(d.label, d.tasks, 'week'); });
      if (!v.week.days.length) html = '<div class="empty"><b>Неделя свободна</b>Задач на 7 дней нет</div>';
    } else {
      v.month.weeks.forEach(function (w) { html += section(w.label, w.tasks, 'month', { range: /неделя/.test(w.label) ? w.range : '' }); });
      if (!v.month.weeks.length) html += '<div class="empty"><b>Месяц свободен</b>Задач на 30 дней нет</div>';
      if (v.month.noDate.length) {
        html += '<div class="section"><button class="section-head collapse-btn" data-act="toggleNoDate" aria-expanded="' + !state.collapsedNoDate + '"><span>Без срока<span class="chev">›</span></span><span class="n">' + v.month.noDate.length + '</span></button>' +
          (state.collapsedNoDate ? '' : '<div class="list">' + v.month.noDate.map(function (t) { return cardHtml(t, 'nodate'); }).join('') + '</div>') + '</div>';
      }
    }
    if (state.error) html = '<div class="banner">' + esc(state.error) + '</div>' + html;
    content.innerHTML = html;
    updateCounts(v.counts);
  }

  function updateCounts(c) {
    $('cnt-today').textContent = c ? c.today || '' : '';
    $('cnt-today').classList.toggle('red', !!(c && c.overdue));
    $('cnt-week').textContent = c ? c.week || '' : '';
    $('cnt-month').textContent = c ? c.month || '' : '';
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === state.tab); });
  }

  /* ---------- Уведомления ---------- */
  var toastTimer = null;
  function toast(text, opts) {
    opts = opts || {};
    var el = $('toast'), btn = $('toastBtn');
    $('toastText').textContent = text;
    el.classList.toggle('err', !!opts.error);
    btn.hidden = !opts.action;
    btn.textContent = opts.action || '';
    btn.onclick = opts.action ? function () { hideToast(); opts.onAction(); } : null;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.ms || (opts.action ? 5000 : 3000));
  }
  function hideToast() { $('toast').hidden = true; }
  function fail(err, rollback) {
    if (rollback) rollback();
    render(); saveCache();
    haptic('error');
    if (err && err.code === 403) { toast(err.message || 'Нет доступа', { error: true, ms: 6000 }); return; }
    toast('Не сохранилось: ' + (err && err.message || 'ошибка'), { error: true, ms: 5000 });
  }

  /* ---------- Действия ---------- */
  function optimistic(id, change, method, p, after) {
    var t = findTask(id); if (!t) return;
    var before = clone(t);
    change(t); replaceTask(t); render(); saveCache();
    return api(method, p).then(function (res) {
      if (res && res.task) {
        var cur = findTask(id);
        if (cur || isOpen(res.task)) replaceTask(res.task);
      }
      render(); saveCache();
      if (after) after(res);
      return res;
    }).catch(function (err) {
      fail(err, function () { replaceTask(before); });
      throw err;
    });
  }

  function actDone(id, cardEl) {
    var t = findTask(id); if (!t || id < 0) return;
    var prevStatus = t.status;
    haptic('success');
    var go = function () {
      optimistic(id, function (x) { x.status = ST.DONE; }, 'setStatus', { id: id, status: ST.DONE }, function (res) {
        if (res.suggestAchievement) openAchievement(res.task, res.suggestAchievement);
      }).catch(function () { });
      toast('Готово: ' + t.title, { action: 'Вернуть', onAction: function () { actRestore(id, prevStatus, t); } });
    };
    if (cardEl) { cardEl.classList.add('done-anim'); setTimeout(go, 260); } else go();
  }
  function actRestore(id, status, snapshot) {
    var t = clone(snapshot); t.status = status; replaceTask(t); render(); saveCache();
    haptic('light');
    api('setStatus', { id: id, status: status }).then(function (res) { replaceTask(res.task); render(); saveCache(); })
      .catch(function (err) { state.tasks = state.tasks.filter(function (x) { return x.id !== id; }); fail(err); });
  }
  function actMove(id, to, date) {
    var t = findTask(id); if (!t || id < 0) return;
    var target = moveTarget(t, to, today(), date);
    if (!target) return;
    haptic('light');
    optimistic(id, function (x) { x.deadline = target; }, 'move', { id: id, to: to, date: date }).catch(function () { });
    toast('#' + id + ' ' + deadlineShort(target, today()).replace(/^до /, 'на '));
  }
  function actWait(id, on) {
    if (id < 0) return;
    haptic('light');
    var td = today();
    optimistic(id, function (x) { x.status = on ? ST.WAIT : ST.WORK; if (on) x.waitSince = td; },
      'setStatus', { id: id, status: on ? ST.WAIT : ST.WORK }).catch(function () { });
    toast(on ? '#' + id + ': жду ответа' : '#' + id + ': в работе');
  }

  /* ---------- Достижение ---------- */
  var achTaskId = null;
  function fillIpr(select, value) {
    var list = state.meta && state.meta.ipr || [];
    select.innerHTML = '<option value="">Не выбрано</option>' + list.map(function (x) {
      var num = String(x).split(' ')[0];
      return '<option value="' + esc(num) + '"' + (String(value) === num ? ' selected' : '') + '>' + esc(x) + '</option>';
    }).join('');
  }
  function openAchievement(task, sug) {
    achTaskId = task.id;
    $('achText').value = sug.wording || task.title;
    fillIpr($('achIpr'), sug.ipr || task.ipr || '');
    $('achSheet').hidden = false; $('achBackdrop').hidden = false;
    haptic('light');
  }
  function closeAchievement() { $('achSheet').hidden = true; $('achBackdrop').hidden = true; achTaskId = null; }
  function saveAchievement() {
    var id = achTaskId, wording = $('achText').value.trim(), ipr = $('achIpr').value;
    closeAchievement();
    haptic('success');
    toast('Записал в достижения');
    api('achievementAdd', { id: id, wording: wording, ipr: ipr }).catch(function (err) {
      haptic('error'); toast('Достижение не записалось: ' + err.message, { error: true, ms: 5000 });
    });
  }

  /* ---------- Редактирование и добавление ---------- */
  var form = null; // {mode, id, sphere, project, deadline, status, touched:{}}
  function chipsHtml(items, active, attr) {
    return items.map(function (it) {
      var val = typeof it === 'string' ? it : it.value, lab = typeof it === 'string' ? it : it.label;
      return '<button type="button" class="chip' + (val === active ? ' active' : '') + '" data-' + attr + '="' + esc(val) + '">' + esc(lab) + '</button>';
    }).join('');
  }
  function renderForm() {
    var td = today(), q = quickDates(td);
    $('fSphere').innerHTML = chipsHtml(state.meta.spheres, form.sphere, 'v');
    var projs = projectsOf(form.sphere);
    $('fProjectWrap').hidden = !projs.length;
    $('fProject').innerHTML = chipsHtml([{ value: '', label: 'Без проекта' }].concat(projs.map(function (p) { return { value: p, label: p }; })), form.project, 'v');
    var qd = [{ value: q.today, label: 'Сегодня' }, { value: q.tomorrow, label: 'Завтра' }, { value: q.friday, label: 'Пт ' + ymdDMs(q.friday) },
      { value: q.nextMonday, label: 'След. пн' }, { value: '', label: 'Без срока' }];
    var activeQd = qd.some(function (x) { return x.value === form.deadline; }) ? form.deadline : '__none';
    // одна дата может совпадать у "Завтра" и "След. пн": подсвечиваем первую
    var seen = false;
    $('fQuickDates').innerHTML = qd.map(function (x) {
      var on = !seen && x.value === activeQd; if (on) seen = true;
      return '<button type="button" class="chip' + (on ? ' active' : '') + '" data-v="' + esc(x.value) + '">' + esc(x.label) + '</button>';
    }).join('');
    $('fDeadline').value = form.deadline || '';
    $('fStatus').innerHTML = chipsHtml([ST.NEW, ST.WORK, ST.WAIT, ST.DONE], form.status, 'v');
    var achSphere = state.meta.achievementSphere;
    $('fIprWrap').hidden = form.sphere !== achSphere;
    if (!$('fIpr').options.length || $('fIpr').dataset.v !== String(form.ipr)) { fillIpr($('fIpr'), form.ipr); $('fIpr').dataset.v = String(form.ipr); }
  }
  function ymdDMs(ymd) { var p = ymd.split('-'); return p[2] + '.' + p[1]; }

  function openForm(mode, task) {
    if (!state.meta) return;
    var td = today();
    if (mode === 'edit') {
      form = { mode: mode, id: task.id, sphere: task.sphere, project: task.project, deadline: task.deadline, status: task.status, ipr: task.ipr || '', touched: {}, orig: clone(task) };
      $('fTitle').value = task.title; $('fNote').value = task.note || '';
      $('editTitle').textContent = 'Задача'; $('editId').textContent = task.id > 0 ? '#' + task.id : '';
      $('fSave').textContent = 'Сохранить';
    } else {
      var sph = state.sphere || (state.meta.spheres.indexOf('Личное') >= 0 ? 'Личное' : state.meta.spheres[state.meta.spheres.length - 1]);
      form = { mode: mode, id: null, sphere: sph, project: state.project || '', deadline: state.tab === 'today' ? td : '', status: ST.NEW, ipr: '', touched: {} };
      if (state.sphere) form.touched.sphere = true;
      if (state.project) form.touched.project = true;
      $('fQuick').value = ''; $('fTitle').value = ''; $('fNote').value = '';
      $('editTitle').textContent = 'Новая задача'; $('editId').textContent = '';
      $('fSave').textContent = 'Добавить';
    }
    $('quickWrap').hidden = mode !== 'add';
    $('fStatusWrap').hidden = mode === 'add';
    $('fCancelTask').hidden = mode === 'add';
    $('fIpr').dataset.v = '__';
    renderForm();
    $('editPage').hidden = false;
    document.body.style.overflow = 'hidden';
    autosize($('fTitle')); autosize($('fNote'));
    if (tg && tg.BackButton && inTelegram) { tg.BackButton.show(); }
    if (mode === 'add') setTimeout(function () { $('fQuick').focus(); }, 60);
  }
  function formDirty() {
    if (!form) return false;
    if (form.mode === 'add') return !!($('fQuick').value.trim() || $('fTitle').value.trim() || $('fNote').value.trim());
    var o = form.orig;
    return $('fTitle').value.trim() !== o.title || ($('fNote').value || '') !== (o.note || '') || form.sphere !== o.sphere ||
      form.project !== o.project || form.deadline !== o.deadline || form.status !== o.status || String(form.ipr) !== String(o.ipr || '');
  }
  function closeForm(force) {
    if (!form) return;
    if (!force && formDirty()) {
      var ask = 'Выйти без сохранения?';
      if (tg && tg.showConfirm && inTelegram) { tg.showConfirm(ask, function (ok) { if (ok) closeForm(true); }); return; }
      if (!window.confirm(ask)) return;
    }
    form = null;
    $('editPage').hidden = true;
    document.body.style.overflow = '';
    if (tg && tg.BackButton && inTelegram) tg.BackButton.hide();
  }
  function autosize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 240) + 'px'; }

  function onQuickInput() {
    var text = $('fQuick').value;
    var rules = state.meta.parseRules || [];
    var r = ruleParse(text, today(), rules);
    if (!form.touched.title) { $('fTitle').value = text.trim() ? r.title : ''; autosize($('fTitle')); }
    if (!form.touched.sphere && text.trim()) {
      var hasMatch = detectProject(text, rules).score > 0;
      if (hasMatch && state.meta.spheres.indexOf(r.sphere) >= 0) { form.sphere = r.sphere; if (!form.touched.project) form.project = r.project || ''; }
    } else if (!form.touched.project && form.sphere === r.sphere && r.project) form.project = r.project;
    if (!form.touched.deadline) {
      var dt = parseDateRu(text, today());
      if (dt) form.deadline = dt.ymd; else if (!text.trim()) form.deadline = state.tab === 'today' ? today() : '';
    }
    renderForm();
  }

  function saveForm() {
    if (!form) return;
    var title = $('fTitle').value.trim() || (form.mode === 'add' ? ruleParse($('fQuick').value, today(), state.meta.parseRules || []).title : '');
    if (!title) { haptic('error'); toast('Напиши название', { error: true }); $('fTitle').focus(); return; }
    var note = $('fNote').value;
    var f = form;
    var data = { title: title, sphere: f.sphere, project: projectsOf(f.sphere).indexOf(f.project) >= 0 ? f.project : '', deadline: f.deadline || '', note: note };
    if (f.sphere === state.meta.achievementSphere) data.ipr = String(f.ipr || ''); else data.ipr = f.mode === 'edit' ? (f.orig.ipr || '') : '';
    closeForm(true);
    if (f.mode === 'add') return createTask(data);
    var id = f.id, o = f.orig, p = { id: id };
    ['title', 'sphere', 'project', 'deadline', 'note', 'ipr'].forEach(function (k) { if (String(data[k] || '') !== String(o[k] || '')) p[k] = data[k]; });
    if (f.status !== o.status) p.status = f.status;
    if (Object.keys(p).length === 1) return;
    haptic('light');
    var wasDone = f.status === ST.DONE && o.status !== ST.DONE;
    optimistic(id, function (x) {
      Object.keys(p).forEach(function (k) { if (k !== 'id') x[k] = p[k]; });
      if (p.status === ST.WAIT && o.status !== ST.WAIT) x.waitSince = today();
    }, 'update', p, function (res) {
      if (res.suggestAchievement) openAchievement(res.task, res.suggestAchievement);
    }).catch(function () { });
    if (wasDone) toast('Готово: ' + data.title, { action: 'Вернуть', onAction: function () { actRestore(id, o.status, o); } });
    else toast('Сохранено');
  }

  var tempId = -1;
  function createTask(data) {
    var tmp = Object.assign({ id: tempId--, created: today(), status: ST.NEW, waitSince: '', closed: '', achievement: '', source: 'Мини-апп' }, data);
    state.tasks.push(tmp); render();
    haptic('success');
    api('create', data).then(function (res) {
      state.tasks = state.tasks.filter(function (x) { return x.id !== tmp.id; });
      replaceTask(res.task); render(); saveCache();
      toast('Добавил #' + res.task.id + ', ' + res.task.sphere + (res.task.project ? ' / ' + res.task.project : '') + ', ' + deadlineShort(res.task.deadline, today()));
    }).catch(function (err) {
      state.tasks = state.tasks.filter(function (x) { return x.id !== tmp.id; });
      fail(err);
      openForm('add'); $('fQuick').value = ''; $('fTitle').value = data.title; $('fNote').value = data.note || '';
      form.sphere = data.sphere; form.project = data.project; form.deadline = data.deadline; form.touched = { title: true, sphere: true, project: true, deadline: true };
      renderForm();
    });
  }

  function cancelTask() {
    if (!form || form.mode !== 'edit') return;
    var id = form.id, o = form.orig;
    var go = function () {
      closeForm(true);
      haptic('warning');
      optimistic(id, function (x) { x.status = ST.CANCEL; }, 'cancel', { id: id }).catch(function () { });
      toast('Задача отменена', { action: 'Вернуть', onAction: function () { actRestore(id, o.status, o); } });
    };
    var ask = 'Отменить задачу? Она останется в таблице со статусом "Отменена".';
    if (tg && tg.showConfirm && inTelegram) tg.showConfirm(ask, function (ok) { if (ok) go(); });
    else if (window.confirm(ask)) go();
  }

  /* ---------- Свайпы (телефон) ---------- */
  function setupSwipes() {
    var content = $('content'), sx = 0, sy = 0, card = null, inner = null, bg = null, dx = 0, mode = '';
    content.addEventListener('touchstart', function (e) {
      var c = e.target.closest('.card'); if (!c || +c.dataset.id < 0) return;
      card = c; inner = c.querySelector('.card-inner'); bg = c.querySelector('.card-bg');
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; mode = '';
    }, { passive: true });
    content.addEventListener('touchmove', function (e) {
      if (!card) return;
      var x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
      if (!mode) { if (Math.abs(x) > 10 && Math.abs(x) > Math.abs(y) * 1.4) mode = 'h'; else if (Math.abs(y) > 10) { mode = 'v'; } }
      if (mode !== 'h') return;
      dx = x; card.classList.add('dragging');
      inner.style.transform = 'translateX(' + dx + 'px)';
      bg.className = 'card-bg ' + (dx > 0 ? 'right' : 'left');
    }, { passive: true });
    var end = function () {
      if (!card) return;
      var c = card, id = +c.dataset.id, d = dx;
      card.classList.remove('dragging');
      inner.style.transform = '';
      var b = bg; setTimeout(function () { b.className = 'card-bg'; }, 200);
      card = null;
      if (mode === 'h' && d > 90) actDone(id, c);
      else if (mode === 'h' && d < -90) actMove(id, 'tomorrow');
    };
    content.addEventListener('touchend', end); content.addEventListener('touchcancel', end);
  }

  /* ---------- События ---------- */
  function setupEvents() {
    $('sphereChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sphere]'); if (!b) return;
      state.sphere = b.dataset.sphere; state.project = ''; haptic('select'); saveUi(); render();
    });
    $('projectChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-project]'); if (!b) return;
      state.project = b.dataset.project; haptic('select'); saveUi(); render();
    });
    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      state.tab = b.dataset.tab; haptic('select'); saveUi(); render(); window.scrollTo(0, 0);
    });
    $('content').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.dataset.act;
      if (act === 'toggleNoDate') { state.collapsedNoDate = !state.collapsedNoDate; render(); return; }
      var card = b.closest('.card'); if (!card) return;
      var id = +card.dataset.id, t = findTask(id); if (!t) return;
      if (act === 'open') { if (id > 0) openForm('edit', t); return; }
      if (act === 'done') actDone(id, card);
      else if (act === 'tomorrow') actMove(id, 'tomorrow');
      else if (act === 'week') actMove(id, 'week');
      else if (act === 'wait') actWait(id, true);
      else if (act === 'work') actWait(id, false);
    });
    $('fab').addEventListener('click', function () { haptic('light'); openForm('add'); });
    $('editClose').addEventListener('click', function () { closeForm(false); });
    $('fSave').addEventListener('click', saveForm);
    $('fCancelTask').addEventListener('click', cancelTask);
    $('fQuick').addEventListener('input', onQuickInput);
    $('fQuick').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveForm(); } });
    $('fTitle').addEventListener('input', function () { form.touched.title = true; autosize(this); });
    $('fNote').addEventListener('input', function () { autosize(this); });
    $('fSphere').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      if (form.sphere !== b.dataset.v) form.project = '';
      form.sphere = b.dataset.v; form.touched.sphere = true; form.touched.project = true; haptic('select'); renderForm();
    });
    $('fProject').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      form.project = b.dataset.v; form.touched.project = true; haptic('select'); renderForm();
    });
    $('fQuickDates').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      form.deadline = b.dataset.v; form.touched.deadline = true; haptic('select'); renderForm();
    });
    $('fDeadline').addEventListener('change', function () { form.deadline = this.value || ''; form.touched.deadline = true; renderForm(); });
    $('fStatus').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      form.status = b.dataset.v; haptic('select'); renderForm();
    });
    $('fIpr').addEventListener('change', function () { form.ipr = this.value; this.dataset.v = this.value; });
    $('achYes').addEventListener('click', saveAchievement);
    $('achNo').addEventListener('click', function () { closeAchievement(); haptic('light'); });
    $('achBackdrop').addEventListener('click', closeAchievement);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (!$('achSheet').hidden) closeAchievement(); else if (form) closeForm(false); }
    });
    if (tg && tg.BackButton) tg.BackButton.onClick(function () { if (!$('achSheet').hidden) closeAchievement(); else closeForm(false); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && state.loaded && Date.now() - state.updatedAt > 60000) refresh(); });
  }

  /* ---------- Загрузка ---------- */
  function applyBootstrap(data) {
    state.meta = data.meta; state.meta.todayLocal = data.meta.today;
    state.tasks = data.tasks; state.updatedAt = Date.now(); state.error = ''; state.loaded = true;
    if (state.sphere && state.meta.spheres.indexOf(state.sphere) < 0) { state.sphere = ''; state.project = ''; }
  }
  var refreshing = false;
  function refresh() {
    if (refreshing) return Promise.resolve();
    refreshing = true;
    return api('bootstrap').then(function (data) {
      // не затираем задачи, которые еще сохраняются
      var temps = state.tasks.filter(function (t) { return t.id < 0; });
      applyBootstrap(data);
      state.tasks = state.tasks.concat(temps);
      saveCache(); render(); handleDeepLink(true);
    }).catch(function (err) {
      state.error = err.code === 403 ? (err.message || 'Нет доступа') : (state.meta ? 'Не обновилось: ' + err.message + '. Показаны сохраненные данные.' : err.message);
      render();
    }).then(function () { refreshing = false; });
  }
  var deepLinkDone = false;
  // fresh = данные уже с сервера. Из кеша открываем, только если задача там есть.
  function handleDeepLink(fresh) {
    if (deepLinkDone || !state.meta) return;
    var start = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param || '';
    var taskId = +(params.get('task') || (start.match(/^task(\d+)$/) || [])[1] || 0);
    if (!taskId) { deepLinkDone = true; return; }
    var t = findTask(taskId);
    if (t) { deepLinkDone = true; if (!form) openForm('edit', t); }
    else if (fresh) { deepLinkDone = true; toast('Задача #' + taskId + ' уже закрыта или не найдена'); }
  }

  function start() {
    setupTelegram();
    var ui = readJSON(UI_KEY) || {};
    if (ui.tab) state.tab = ui.tab;
    if (ui.sphere !== undefined) { state.sphere = ui.sphere || ''; state.project = ui.project || ''; }
    if (params.get('sphere')) { state.sphere = params.get('sphere'); state.project = params.get('project') || ''; }
    if (params.get('tab')) state.tab = params.get('tab');
    setupEvents(); setupSwipes();
    if (!inTelegram && !DEMO) {
      state.error = 'Открой мини-апп из Telegram, через кнопку в боте.';
      render(); return;
    }
    var cache = DEMO ? null : readJSON(CACHE_KEY);
    if (cache && cache.meta) {
      state.meta = cache.meta; state.meta.todayLocal = localToday(); state.tasks = cache.tasks || []; state.updatedAt = cache.at || 0;
      render(); handleDeepLink();
    } else render();
    refresh();
  }

  /* ---------- Демо-режим (?demo=1): локальные данные для проверки интерфейса без Telegram ---------- */
  var demo = null;
  function demoApi(method, p) {
    var td = localToday();
    if (!demo) {
      var d = function (n) { return n === null ? '' : ymdAdd(td, n); };
      var mk = function (id, sphere, project, title, dl, extra) { return Object.assign({ id: id, created: d(-5), sphere: sphere, project: project, title: title, deadline: d(dl), status: 'Новая', waitSince: '', note: '', ipr: '', closed: '', achievement: '', source: '' }, extra || {}); };
      demo = {
        meta: { spheres: ['Работа', 'Проект Б', 'Студия', 'Личное'], projects: [{ sphere: 'Работа', project: 'Клиент А' }, { sphere: 'Работа', project: 'Клиент Б' }, { sphere: 'Работа', project: 'Внутреннее' }],
          parseRules: [{ sphere: 'Работа', project: 'Клиент А', aliases: ['ка', 'клиент а'] }, { sphere: 'Работа', project: 'Клиент Б', aliases: ['кб'] }, { sphere: 'Студия', project: '', aliases: ['студия'] }, { sphere: 'Личное', project: '', aliases: ['дом'] }],
          statuses: ['Новая', 'В работе', 'Жду ответа', 'Готово', 'Отменена'], ipr: ['1 Пункт один', '2 Пункт два', '3 Пункт три'], achievementSphere: 'Работа', today: td },
        tasks: [
          mk(11, 'Работа', 'Клиент А', 'Прислать сверку за октябрь', -3), mk(12, 'Личное', '', 'Оплатить интернет', -1),
          mk(13, 'Работа', 'Клиент Б', 'Подготовить презентацию по итогам квартала', 0, { note: 'Взять цифры из дашборда' }),
          mk(14, 'Студия', '', 'Найти зал на выходные', 0, { status: 'В работе' }), mk(15, 'Проект Б', '', 'Обновить подборку партнерских ссылок', 1),
          mk(16, 'Работа', 'Внутреннее', 'Запустить новый формат отчета для команды', 2), mk(17, 'Работа', 'Клиент А', 'Созвон по бюджету', 4),
          mk(18, 'Личное', '', 'Записаться к врачу', 9), mk(19, 'Работа', 'Клиент Б', 'Согласовать креативы', null, { status: 'Жду ответа', waitSince: d(-5) }),
          mk(20, 'Проект Б', '', 'Идеи для канала', null), mk(21, 'Работа', 'Клиент А', 'Закрытие месяца', 16)
        ], next: 22
      };
    }
    var find = function (id) { return demo.tasks.filter(function (t) { return t.id === id; })[0]; };
    var res;
    if (method === 'bootstrap') res = { meta: clone(demo.meta), tasks: clone(demo.tasks.filter(isOpen)) };
    else if (method === 'create') { var t = Object.assign({ id: demo.next++, created: td, status: 'Новая', waitSince: '', closed: '', achievement: '', source: 'Мини-апп' }, p); demo.tasks.push(t); res = { task: clone(t) }; }
    else {
      var x = find(p.id); if (!x) return Promise.reject(Object.assign(new Error('Задача не найдена'), { code: 400 }));
      var before = x.status;
      if (method === 'setStatus' || (method === 'update' && p.status)) { x.status = p.status; if (p.status === 'Жду ответа' && before !== 'Жду ответа') x.waitSince = td; }
      if (method === 'update') Object.keys(p).forEach(function (k) { if (k !== 'id' && k !== 'status') x[k] = p[k]; });
      if (method === 'move') { x.deadline = moveTarget(x, p.to, td, p.date); if (!isOpen(x)) x.status = 'Новая'; }
      if (method === 'cancel') x.status = 'Отменена';
      if (method === 'achievementAdd') x.achievement = 'да';
      res = { task: clone(x) };
      if (x.status === 'Готово' && before !== 'Готово' && suggestAchievement(x, 'Работа')) res.suggestAchievement = { wording: x.title, ipr: '' };
    }
    return new Promise(function (ok) { setTimeout(function () { ok(res); }, 350); });
  }

  start();
})();
