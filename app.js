(() => {
  'use strict';

  // ── ユーティリティ ──
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const GROUP_LABEL = Object.fromEntries(GROUPS.map((g) => [g.id, g.label]));

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できない環境では何もしない */ }
    },
  };

  // ── データの下ごしらえ ──
  const ING_BY_NAME = {};
  INGREDIENTS.forEach((x, i) => {
    x.id = 'i' + i;
    x.kind = 'ing';
    ING_BY_NAME[x.n] = x;
    x.aka.forEach((a) => { if (!ING_BY_NAME[a]) ING_BY_NAME[a] = x; });
  });
  const KAMPO_BY_NAME = {};
  KAMPO.forEach((x, i) => { x.id = 'k' + i; x.kind = 'kmp'; x.g = 'kampo'; KAMPO_BY_NAME[x.n] = x; });
  PRODUCTS.forEach((p, i) => {
    p.id = 'p' + i;
    p.kind = 'prd';
    p.links = p.ings.map((e) => {
      const [disp, name] = Array.isArray(e) ? e : [e, e];
      const ing = ING_BY_NAME[name];
      if (!ing) console.warn('成分が見つかりません:', p.n, name);
      return { disp, ing };
    }).filter((l) => l.ing);
  });
  const PRODUCTS_BY_ING = new Map();
  PRODUCTS.forEach((p) => p.links.forEach((l) => {
    if (!PRODUCTS_BY_ING.has(l.ing)) PRODUCTS_BY_ING.set(l.ing, []);
    PRODUCTS_BY_ING.get(l.ing).push(p);
  }));
  const ITEM_BY_ID = {};
  [...INGREDIENTS, ...PRODUCTS, ...KAMPO].forEach((x) => { ITEM_BY_ID[x.id] = x; });

  // 一部しか成分を挙げていない製品の誤答に使わない分類（多くの製品に添加されがちなもの）
  const UBIQ = new Set(['ビタミン成分', 'アミノ酸成分', 'ミネラル成分', '滋養強壮成分', '抗炎症成分', '局所刺激成分',
    '中枢神経興奮成分', '制酸成分', '健胃成分', '消化成分', '組織修復成分', '殺菌消毒成分', '鎮痒成分', '局所麻酔成分',
    '血行促進成分', '婦人薬用生薬', '泌尿器用生薬', '強心成分', '収斂・保護成分', '整腸成分']);
  const isClsOf = (ing, c) => ing.cls === c || ing.also.includes(c);
  const unrelated = (a, b) => !isClsOf(a, b.cls) && !isClsOf(b, a.cls) && a.act !== b.act;
  const WARN_ORDER = ['マオウ', 'カンゾウ', 'ダイオウ'];
  const WARN_LABELS = ['含まない', 'カンゾウ', 'マオウ・カンゾウ', 'ダイオウ', 'カンゾウ・ダイオウ', 'マオウ・カンゾウ・ダイオウ'];
  const warnLabel = (k) => (k.warn.length ? WARN_ORDER.filter((w) => k.warn.includes(w)).join('・') : '含まない');

  // ── 選択肢づくり ──
  // cands: [{ text, ref, pref }]。pref の候補を優先して 3 つ選ぶ。
  function buildOptions(correct, cands, n = 3) {
    const seen = new Set([correct.text]);
    const uniq = [];
    shuffle(cands.slice()).forEach((c) => { if (!seen.has(c.text)) { seen.add(c.text); uniq.push(c); } });
    const chosen = [...uniq.filter((c) => c.pref), ...uniq.filter((c) => !c.pref)].slice(0, n);
    if (chosen.length < n) return null;
    const options = shuffle([correct, ...chosen]);
    return { options, answer: options.indexOf(correct) };
  }

  // ── 問題形式 ──
  const QTYPES = [
    {
      id: 'ing_cls', kind: 'ing', label: '成分 → 分類',
      gen(ing) {
        const all = [...new Set(INGREDIENTS.map((x) => x.cls))].filter((c) => !isClsOf(ing, c));
        const local = new Set(INGREDIENTS.filter((x) => x.g === ing.g).map((x) => x.cls));
        const o = buildOptions({ text: ing.cls }, all.map((c) => ({ text: c, pref: local.has(c) })));
        return o && { lead: 'この成分の分類は？', prompt: ing.n, aka: ing.aka, ...o };
      },
    },
    {
      id: 'cls_ing', kind: 'ing', label: '分類 → 成分',
      gen(ing) {
        const cands = INGREDIENTS.filter((x) => !isClsOf(x, ing.cls)).map((x) => ({ text: x.n, ref: x, pref: x.g === ing.g }));
        const o = buildOptions({ text: ing.n, ref: ing }, cands);
        return o && { lead: 'この分類に当てはまる成分は？', prompt: ing.cls, ...o };
      },
    },
    {
      id: 'ing_act', kind: 'ing', label: '成分 → 作用',
      gen(ing) {
        const cands = INGREDIENTS.filter((x) => unrelated(x, ing)).map((x) => ({ text: x.act, ref: x, pref: x.g === ing.g }));
        const o = buildOptions({ text: ing.act, ref: ing }, cands);
        return o && { lead: 'この成分の作用は？', prompt: ing.n, aka: ing.aka, long: true, ...o };
      },
    },
    {
      id: 'act_ing', kind: 'ing', label: '作用 → 成分',
      gen(ing) {
        const cands = INGREDIENTS.filter((x) => unrelated(x, ing)).map((x) => ({ text: x.n, ref: x, pref: x.g === ing.g }));
        const o = buildOptions({ text: ing.n, ref: ing }, cands);
        return o && { lead: 'この作用をもつ成分は？', prompt: ing.act, small: true, ...o };
      },
    },
    {
      id: 'prd_ing', kind: 'prd', label: '製品 → 配合成分',
      gen(p) {
        if (p.kampo) {
          const k = KAMPO_BY_NAME[p.kampo];
          const cands = KAMPO.filter((x) => x !== k).map((x) => ({ text: x.n, ref: x, pref: x.cat === k.cat }));
          const o = buildOptions({ text: k.n, ref: k }, cands);
          return o && { lead: 'この製品のもとになっている漢方処方は？', prompt: p.n, tag: p.type, ...o };
        }
        if (!p.links.length) return null;
        const mine = p.links.map((l) => l.ing);
        const answer = pick(mine);
        const near = (x) => mine.some((m) => m.n.slice(0, 5) === x.n.slice(0, 5));
        const cands = INGREDIENTS.filter((x) => !mine.includes(x) && !near(x) && (p.complete
          || (x.g !== p.g && !UBIQ.has(x.cls) && !x.sub.includes('生薬') && !mine.some((m) => m.cls === x.cls))))
          .map((x) => ({ text: x.n, ref: x, pref: p.complete && x.g === p.g }));
        const o = buildOptions({ text: answer.n, ref: answer }, cands);
        return o && { lead: 'この製品に配合されている成分は？', prompt: p.n, tag: p.type, ...o };
      },
    },
    {
      id: 'ing_prd', kind: 'prd', label: '成分 → 製品',
      gen(p) {
        if (p.kampo) {
          const cands = PRODUCTS.filter((q) => q.kampo !== p.kampo).map((q) => ({ text: q.n, ref: q, pref: q.g === p.g }));
          const o = buildOptions({ text: p.n, ref: p }, cands);
          return o && { lead: 'この漢方処方を製品化したものは？', prompt: p.kampo, ...o };
        }
        const key = p.links.map((l) => l.ing).find((x) => !UBIQ.has(x.cls));
        if (!key) return null;
        const cands = PRODUCTS.filter((q) => q !== p && !q.links.some((l) => l.ing === key)
          && (q.complete || (q.g !== key.g && q.g !== p.g)))
          .map((q) => ({ text: q.n, ref: q, pref: q.g === p.g }));
        const o = buildOptions({ text: p.n, ref: p }, cands);
        return o && { lead: 'この成分を配合している製品は？', prompt: key.n, ...o };
      },
    },
    {
      id: 'prd_type', kind: 'prd', label: '製品 → 薬効',
      gen(p) {
        const local = new Set(PRODUCTS.filter((q) => q.g === p.g).map((q) => q.type));
        const types = [...new Set(PRODUCTS.map((q) => q.type))].filter((t) => t !== p.type);
        const o = buildOptions({ text: p.type }, types.map((t) => ({ text: t, pref: local.has(t) })));
        return o && { lead: 'この製品の薬効分類は？', prompt: p.n, ...o };
      },
    },
    {
      id: 'kmp_use', kind: 'kmp', label: '漢方 → 適応',
      gen(k) {
        const fmt = (x) => `【${x.sho}】${x.key}`;
        const cands = KAMPO.filter((x) => x !== k).map((x) => ({ text: fmt(x), ref: x, pref: x.cat === k.cat }));
        const o = buildOptions({ text: fmt(k), ref: k }, cands);
        return o && { lead: 'この漢方処方の適応は？', prompt: k.n, aka: [k.yomi], long: true, ...o };
      },
    },
    {
      id: 'use_kmp', kind: 'kmp', label: '適応 → 漢方',
      gen(k) {
        const cands = KAMPO.filter((x) => x !== k).map((x) => ({ text: x.n, ref: x, pref: x.cat === k.cat }));
        const o = buildOptions({ text: k.n, ref: k }, cands);
        return o && { lead: 'この症状・体質に合う漢方処方は？', prompt: `【${k.sho}】${k.key}`, small: true, ...o };
      },
    },
    {
      id: 'kmp_warn', kind: 'kmp', label: '漢方 → 注意生薬',
      gen(k) {
        if (k.warnMaybe.length || k.sho === '外用') return null;
        const right = warnLabel(k);
        const o = buildOptions({ text: right }, WARN_LABELS.filter((l) => l !== right).map((l) => ({ text: l })));
        return o && { lead: 'マオウ・カンゾウ・ダイオウのうち、この処方に含まれるのは？', prompt: k.n, aka: [k.yomi], ...o };
      },
    },
  ];
  const QTYPE_BY_ID = Object.fromEntries(QTYPES.map((t) => [t.id, t]));
  const KIND_LABEL = { ing: '成分', prd: '製品', kmp: '漢方' };
  const itemsOfKind = (kind) => (kind === 'ing' ? INGREDIENTS : kind === 'prd' ? PRODUCTS : KAMPO);

  // ── 状態 ──
  const DEFAULT_SETTINGS = { groups: GROUPS.map((g) => g.id), types: ['ing_cls', 'cls_ing', 'ing_act', 'prd_ing', 'ing_prd', 'kmp_use', 'use_kmp'], count: 20 };
  let settings = Object.assign({}, DEFAULT_SETTINGS, store.get('drill.settings', {}));
  settings.groups = settings.groups.filter((g) => GROUP_LABEL[g]);
  settings.types = settings.types.filter((t) => QTYPE_BY_ID[t]);
  let stats = store.get('drill.stats', {});
  let session = null;

  const isWeak = (id) => { const s = stats[id]; return !!s && (s.last === 0 || s.w > s.c); };
  const weakIds = () => Object.keys(stats).filter((id) => ITEM_BY_ID[id] && isWeak(id));
  function record(item, ok) {
    const s = stats[item.id] || { c: 0, w: 0 };
    if (ok) s.c++; else s.w++;
    s.last = ok ? 1 : 0;
    s.t = Date.now();
    stats[item.id] = s;
    store.set('drill.stats', stats);
  }

  // ── 出題 ──
  function candidatePairs(filterIds) {
    const pairs = [];
    settings.types.forEach((tid) => {
      const t = QTYPE_BY_ID[tid];
      itemsOfKind(t.kind).forEach((item) => {
        if (!settings.groups.includes(item.g)) return;
        if (filterIds && !filterIds.has(item.id)) return;
        pairs.push({ t, item });
      });
    });
    return shuffle(pairs);
  }

  function makeQuestions(pairs, count) {
    const out = [];
    const used = new Set();
    for (const pass of [0, 1]) {
      for (const pr of pairs) {
        if (out.length >= count) break;
        if (pass === 0 && used.has(pr.item.id)) continue;
        if (out.some((q) => q.t === pr.t && q.item === pr.item)) continue;
        const q = pr.t.gen(pr.item);
        if (!q) continue;
        used.add(pr.item.id);
        out.push(Object.assign(q, { t: pr.t, item: pr.item }));
      }
    }
    return shuffle(out);
  }

  function startSession(mode, retryPairs) {
    let qs;
    if (retryPairs) {
      qs = retryPairs.map((pr) => { const q = pr.t.gen(pr.item); return q && Object.assign(q, { t: pr.t, item: pr.item }); }).filter(Boolean);
      qs = shuffle(qs);
    } else {
      const filter = mode === 'weak' ? new Set(weakIds()) : null;
      const pairs = candidatePairs(filter);
      qs = makeQuestions(pairs, mode === 'weak' ? Math.max(settings.count, 50) : settings.count);
    }
    if (!qs.length) {
      toast(mode === 'weak' ? '選んだ範囲に苦手な項目はありません' : '出題範囲と問題形式の組み合わせで作れる問題がありません');
      return;
    }
    session = { mode, qs, i: 0, results: [] };
    show('quiz');
    renderQuestion();
  }

  // ── 表示 ──
  function show(view) {
    document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== view; });
    const navView = view === 'zukan' ? 'zukan' : 'home';
    document.querySelectorAll('.nav-btn').forEach((b) => b.setAttribute('aria-current', b.dataset.go === navView ? 'page' : 'false'));
    window.scrollTo(0, 0);
    if (view === 'home') renderHome();
    if (view === 'zukan') renderZukan();
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function renderHome() {
    const ids = Object.keys(stats).filter((id) => ITEM_BY_ID[id]);
    const c = ids.reduce((a, id) => a + stats[id].c, 0);
    const w = ids.reduce((a, id) => a + stats[id].w, 0);
    const weak = weakIds();
    $('#stat-items').textContent = `${INGREDIENTS.length}・${PRODUCTS.length}・${KAMPO.length}`;
    $('#stat-seen').textContent = ids.length;
    $('#stat-rate').textContent = c + w ? Math.round((c / (c + w)) * 100) + '%' : '—';
    $('#stat-weak').textContent = weak.length;

    const countIn = (g) => INGREDIENTS.filter((x) => x.g === g).length + PRODUCTS.filter((x) => x.g === g).length + (g === 'kampo' ? KAMPO.length : 0);
    $('#groups').innerHTML = GROUPS.map((g) => `
      <button type="button" class="chip" role="switch" data-group="${g.id}" aria-checked="${settings.groups.includes(g.id)}">
        <span>${esc(g.label)}</span><span class="chip-n">${countIn(g.id)}</span>
      </button>`).join('');

    $('#types').innerHTML = ['ing', 'prd', 'kmp'].map((kind) => `
      <div class="type-row">
        <span class="type-kind">${KIND_LABEL[kind]}</span>
        <div class="chips">${QTYPES.filter((t) => t.kind === kind).map((t) => `
          <button type="button" class="chip" role="switch" data-type="${t.id}" aria-checked="${settings.types.includes(t.id)}">${esc(t.label)}</button>`).join('')}
        </div>
      </div>`).join('');

    document.querySelectorAll('#count button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.count === settings.count)));
    const wbtn = $('#start-weak');
    wbtn.disabled = weak.length === 0;
    $('#weak-n').textContent = weak.length;
  }

  function saveSettings() { store.set('drill.settings', settings); }

  function toggleIn(list, v) { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); }

  function akaLine(aka) { return aka && aka.length ? `<div class="q-aka">${aka.map(esc).join('／')}</div>` : ''; }

  function renderQuestion() {
    const q = session.qs[session.i];
    const n = session.qs.length;
    const correct = session.results.filter((r) => r.ok).length;
    $('#q-progress').textContent = `${session.i + 1} / ${n}`;
    $('#q-score').textContent = `正解 ${correct}`;
    $('#q-bar').style.width = `${(session.i / n) * 100}%`;
    $('#q-type').textContent = q.t.label;
    $('#q-group').textContent = GROUP_LABEL[q.item.g];
    $('#q-lead').textContent = q.lead;
    $('#q-prompt').className = 'q-prompt' + (q.small ? ' is-small' : '');
    $('#q-prompt').innerHTML = esc(q.prompt) + (q.tag ? ` <span class="q-tag">${esc(q.tag)}</span>` : '') + akaLine(q.aka);
    $('#q-options').className = 'options' + (q.long ? ' is-long' : '');
    $('#q-options').innerHTML = q.options.map((o, i) => `
      <button type="button" class="option" data-i="${i}">
        <span class="option-key">${i + 1}</span><span class="option-text">${esc(o.text)}</span>
      </button>`).join('');
    $('#q-feedback').hidden = true;
    $('#q-feedback').innerHTML = '';
    $('#q-next').hidden = true;
    $('#q-options .option').focus({ preventScroll: true });
  }

  function answer(i) {
    const q = session.qs[session.i];
    if (q.chosen !== undefined) return;
    q.chosen = i;
    const ok = i === q.answer;
    record(q.item, ok);
    session.results.push({ q, ok });
    document.querySelectorAll('#q-options .option').forEach((b, j) => {
      b.disabled = true;
      if (j === q.answer) b.classList.add('is-right');
      else if (j === i) b.classList.add('is-wrong');
    });
    const picked = q.options[i];
    let html = `<div class="verdict ${ok ? 'is-ok' : 'is-ng'}">${ok ? '正解' : '不正解'}</div>`;
    if (!ok && picked.ref && picked.ref !== q.item) html += `<div class="picked"><div class="picked-label">選んだ選択肢</div>${miniCard(picked.ref)}</div>`;
    html += card(q.item, { open: true });
    $('#q-feedback').innerHTML = html;
    $('#q-feedback').hidden = false;
    $('#q-next').hidden = false;
    $('#q-next').textContent = session.i + 1 < session.qs.length ? '次の問題' : '結果を見る';
    $('#q-next').focus({ preventScroll: true });
    $('#q-score').textContent = `正解 ${session.results.filter((r) => r.ok).length}`;
  }

  function next() {
    session.i++;
    if (session.i < session.qs.length) { renderQuestion(); window.scrollTo(0, 0); } else renderResult();
  }

  function renderResult() {
    show('result');
    const n = session.results.length;
    const ok = session.results.filter((r) => r.ok).length;
    const pct = n ? Math.round((ok / n) * 100) : 0;
    $('#r-score').innerHTML = `<span class="r-num">${ok}</span><span class="r-den">/ ${n}</span>`;
    $('#r-pct').textContent = `正答率 ${pct}%`;
    $('#r-msg').textContent = pct === 100 ? '全問正解です。範囲を広げるか、別の形式も試してみましょう。'
      : pct >= 80 ? 'よく覚えています。間違えた項目だけ見直しましょう。'
      : pct >= 50 ? '半分以上は定着しています。間違えた問題をもう一度解くと効果的です。'
      : 'まずは図鑑で分類と作用を眺めてから、もう一度挑戦してみましょう。';
    const missed = session.results.filter((r) => !r.ok);
    $('#r-retry').hidden = missed.length === 0;
    $('#r-list').innerHTML = session.results.map((r) => `
      <li class="r-item ${r.ok ? 'is-ok' : 'is-ng'}">
        <span class="r-mark" aria-label="${r.ok ? '正解' : '不正解'}">${r.ok ? '○' : '×'}</span>
        <div class="r-body">
          <div class="r-meta">${esc(r.q.t.label)}</div>
          <div class="r-prompt">${esc(r.q.prompt)}</div>
          <div class="r-answer">正解：${esc(r.q.options[r.q.answer].text)}</div>
          ${r.ok ? '' : `<div class="r-chosen">選んだ答え：${esc(r.q.options[r.q.chosen].text)}</div>`}
        </div>
      </li>`).join('');
  }

  // ── 項目カード ──
  function statBadge(item) {
    const s = stats[item.id];
    if (!s) return '';
    return `<span class="badge ${isWeak(item.id) ? 'is-weak' : 'is-good'}">${isWeak(item.id) ? '苦手' : '定着'} ${s.c}/${s.c + s.w}</span>`;
  }

  function row(label, value, cls) {
    return value ? `<div class="row ${cls || ''}"><dt>${label}</dt><dd>${value}</dd></div>` : '';
  }

  function card(item, opt = {}) {
    const hidden = opt.hide ? ' is-hidden' : '';
    if (item.kind === 'ing') {
      const prods = PRODUCTS_BY_ING.get(item) || [];
      const clsText = esc(item.cls) + (item.sub ? `<span class="sub">（${esc(item.sub)}）</span>` : '') + (item.also.length ? `<span class="sub">／${item.also.map(esc).join('・')}としても</span>` : '');
      return `<article class="card" data-id="${item.id}">
        <header class="card-head"><div><h3 class="card-name">${esc(item.n)}</h3>${akaLine(item.aka)}</div>
          <div class="card-tags"><span class="tag">${esc(GROUP_LABEL[item.g])}</span>${statBadge(item)}</div></header>
        <dl class="rows${hidden}">
          ${row('分類', clsText)}
          ${row('作用', esc(item.act))}
          ${row('ポイント', esc(item.note), 'is-note')}
          ${prods.length ? row('配合製品', prods.map((p) => esc(p.n)).join('、')) : ''}
        </dl></article>`;
    }
    if (item.kind === 'prd') {
      const k = item.kampo && KAMPO_BY_NAME[item.kampo];
      const ings = k ? `${esc(k.n)}（${esc(k.yomi)}）`
        : item.links.map((l) => `${esc(l.disp)}<span class="sub">〔${esc(l.ing.cls)}〕</span>`).join('、') + (item.complete ? '' : '<span class="sub"> ほか</span>');
      return `<article class="card" data-id="${item.id}">
        <header class="card-head"><div><h3 class="card-name">${esc(item.n)}</h3></div>
          <div class="card-tags"><span class="tag">${esc(item.type)}</span>${statBadge(item)}</div></header>
        <dl class="rows${hidden}">
          ${row(k ? '処方' : '配合成分', ings)}
          ${row('効能', esc(item.use))}
          ${row('ポイント', esc(item.note), 'is-note')}
          ${k ? row('体質', esc(k.sho)) : ''}
        </dl></article>`;
    }
    const prods = PRODUCTS.filter((p) => p.kampo === item.n);
    const warn = item.warn.length || item.warnMaybe.length
      ? [...item.warn.map(esc), ...item.warnMaybe.map((w) => esc(w) + '（含む製品あり）')].join('・') : '含まない';
    return `<article class="card" data-id="${item.id}">
      <header class="card-head"><div><h3 class="card-name">${esc(item.n)}</h3>${akaLine([item.yomi])}</div>
        <div class="card-tags"><span class="tag">${esc(item.cat)}</span>${statBadge(item)}</div></header>
      <dl class="rows${hidden}">
        ${row('体質', esc(item.sho))}
        ${row('適応', esc(item.key))}
        ${row('注意生薬', warn)}
        ${row('ポイント', esc(item.note), 'is-note')}
        ${prods.length ? row('製品例', prods.map((p) => esc(p.n)).join('、')) : ''}
      </dl></article>`;
  }

  function miniCard(item) {
    if (item.kind === 'ing') return `<div class="mini"><strong>${esc(item.n)}</strong> は <em>${esc(item.cls)}</em>${item.sub ? `（${esc(item.sub)}）` : ''}。${esc(item.act)}</div>`;
    if (item.kind === 'prd') return `<div class="mini"><strong>${esc(item.n)}</strong> は <em>${esc(item.type)}</em>。${item.kampo ? esc(item.kampo) : item.links.map((l) => esc(l.disp)).join('、')}${item.complete ? '' : ' ほか'}</div>`;
    return `<div class="mini"><strong>${esc(item.n)}</strong>（${esc(item.yomi)}）は 【${esc(item.sho)}】${esc(item.key)}</div>`;
  }

  // ── 図鑑 ──
  const zukan = { tab: store.get('drill.zukanTab', 'ing'), q: '', g: '', hide: false };
  function renderZukan() {
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === zukan.tab)));
    const sel = $('#z-group');
    if (!sel.options.length) {
      sel.innerHTML = '<option value="">すべてのグループ</option>' + GROUPS.map((g) => `<option value="${g.id}">${esc(g.label)}</option>`).join('');
    }
    sel.hidden = zukan.tab === 'kmp';
    const q = zukan.q.trim().toLowerCase();
    const items = itemsOfKind(zukan.tab).filter((x) => {
      if (zukan.g && zukan.tab !== 'kmp' && x.g !== zukan.g) return false;
      if (!q) return true;
      const hay = [x.n, ...(x.aka || []), x.yomi, x.cls, x.sub, x.act, x.note, x.type, x.use, x.key, x.sho, x.cat, x.kampo,
        ...(x.links || []).map((l) => l.disp + l.ing.n)].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    $('#z-count').textContent = `${items.length}件`;
    $('#z-list').innerHTML = items.length ? items.map((x) => card(x, { hide: zukan.hide })).join('')
      : '<p class="empty">条件に合う項目はありません。検索語を短くするか、グループを「すべて」にしてください。</p>';
  }

  // ── イベント ──
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, .card');
    if (!t) return;
    if (t.dataset.go) { show(t.dataset.go); return; }
    if (t.dataset.group) { toggleIn(settings.groups, t.dataset.group); saveSettings(); t.setAttribute('aria-checked', String(settings.groups.includes(t.dataset.group))); return; }
    if (t.dataset.type) { toggleIn(settings.types, t.dataset.type); saveSettings(); t.setAttribute('aria-checked', String(settings.types.includes(t.dataset.type))); return; }
    if (t.dataset.count) { settings.count = +t.dataset.count; saveSettings(); renderHome(); return; }
    if (t.dataset.all !== undefined) {
      const key = t.dataset.all;
      const full = key === 'groups' ? GROUPS.map((g) => g.id) : QTYPES.map((q) => q.id);
      settings[key] = settings[key].length === full.length ? [] : full.slice();
      saveSettings(); renderHome(); return;
    }
    if (t.dataset.tab) { zukan.tab = t.dataset.tab; store.set('drill.zukanTab', zukan.tab); renderZukan(); return; }
    if (t.classList.contains('option')) { answer(+t.dataset.i); return; }
    if (t.classList.contains('card') && zukan.hide) { const r = t.querySelector('.rows'); if (r) r.classList.toggle('is-hidden'); return; }
    switch (t.id) {
      case 'start': startSession('normal'); break;
      case 'start-weak': startSession('weak'); break;
      case 'q-next': next(); break;
      case 'q-quit': session = null; show('home'); break;
      case 'r-retry': startSession('retry', session.results.filter((r) => !r.ok).map((r) => ({ t: r.q.t, item: r.q.item }))); break;
      case 'r-again': startSession(session.mode === 'weak' ? 'weak' : 'normal'); break;
      case 'r-home': show('home'); break;
      case 'reset-stats': {
        if (t.dataset.armed) { stats = {}; store.set('drill.stats', stats); delete t.dataset.armed; t.textContent = '学習記録をリセット'; renderHome(); toast('学習記録をリセットしました'); }
        else { t.dataset.armed = '1'; t.textContent = 'もう一度押すとリセット'; setTimeout(() => { delete t.dataset.armed; t.textContent = '学習記録をリセット'; }, 4000); }
        break;
      }
      default:
    }
  });

  $('#z-search').addEventListener('input', (e) => { zukan.q = e.target.value; renderZukan(); });
  $('#z-group').addEventListener('change', (e) => { zukan.g = e.target.value; renderZukan(); });
  $('#z-hide').addEventListener('change', (e) => { zukan.hide = e.target.checked; renderZukan(); });

  document.addEventListener('keydown', (e) => {
    if ($('[data-view="quiz"]').hidden || !session) return;
    if (e.target.matches('input, select, textarea')) return;
    const q = session.qs[session.i];
    if (q.chosen === undefined && /^[1-4]$/.test(e.key)) { e.preventDefault(); answer(+e.key - 1); }
    else if (q.chosen !== undefined && e.key === 'Enter' && document.activeElement?.id !== 'q-next') { e.preventDefault(); next(); }
  });

  show('home');
})();
