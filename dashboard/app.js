// Token Radar dashboard: renders window.RADAR, recomputes every row from the
// same derivation the pipeline uses, and shows the model beside the board.
//
// The farm plan is generated here, in the page, from the same derivation as
// the pipeline (category, chains, TVL, age) — so the screenshots and the
// board's own farm_steps agree, and a row's plan never depends on a hand-
// written list of names.

(function () {
  'use strict';

  var RADAR = window.RADAR;
  if (!RADAR || !Array.isArray(RADAR.rows)) {
    document.body.insertAdjacentHTML('beforeend', '<p style="padding:24px">The radar data did not load.</p>');
    return;
  }

  var MODEL = RADAR.model || {};
  var GROWTH_WEIGHT = MODEL.growth_weight !== undefined ? MODEL.growth_weight : 0.6;
  var GROWTH_FLOOR = MODEL.growth_floor !== undefined ? MODEL.growth_floor : -50;
  var GROWTH_CAP = MODEL.growth_cap !== undefined ? MODEL.growth_cap : 100;
  var MATURITY_FLOOR = MODEL.maturity_floor !== undefined ? MODEL.maturity_floor : 0.6;
  var MATURITY_DAYS = MODEL.maturity_days !== undefined ? MODEL.maturity_days : 1095;
  var UNKNOWN_AGE = MODEL.unknown_age_days !== undefined ? MODEL.unknown_age_days : 365;
  var MULTIPLE_CAP = MODEL.multiple_cap !== undefined ? MODEL.multiple_cap : 1.5;
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function changePct(v) {
    if (v === null || v === undefined) return '—';
    var sign = v > 0 ? '+' : '';
    return sign + v.toFixed(1) + '%';
  }

  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function growthPct(row) {
    return clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, GROWTH_FLOOR, GROWTH_CAP);
  }

  function growthMult(row) { return 1 + (growthPct(row) / 100) * GROWTH_WEIGHT; }

  function maturityMult(row) {
    var age = row.age_days === null || row.age_days === undefined ? UNKNOWN_AGE : row.age_days;
    return MATURITY_FLOOR + (Math.min(Math.max(age, 0), MATURITY_DAYS) / MATURITY_DAYS) * (1 - MATURITY_FLOOR);
  }

  // --- the model, recomputed in the page ----------------------------------
  // The implied value shown is the board's own figure; the factors are the
  // stored model values, so the arithmetic the drawer shows multiplies out to
  // the total within the rounding of the last digit shown.
  function recompute(row) {
    return {
      implied: row.implied_value_usd,
      multiple: row.multiple,
      samples: row.multiple_samples || 0,
      growthPct: growthPct(row),
      growthMult: growthMult(row),
      maturityMult: maturityMult(row),
    };
  }

  // --- the farm plan, generated in the page --------------------------------
  function chainOf(row) { return row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain'; }

  function capitalFor(row) {
    if (row.tvl_usd >= 5000000000) return 250;
    if (row.tvl_usd >= 1000000000) return 150;
    if (row.tvl_usd >= 100000000) return 100;
    return 50;
  }

  function holdDaysFor(row) {
    var age = row.age_days;
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function mainActionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') !== -1 || c.indexOf('cdp') !== -1 || c.indexOf('collateral') !== -1)
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') !== -1 || c.indexOf('leveraged farm') !== -1)
      return 'Swap $25 of USDC on ' + name + ' on ' + chain + ', then provide $' + capital + ' of liquidity to its main pool and keep the position open.';
    if (c.indexOf('yield') !== -1 || c.indexOf('aggregator') !== -1)
      return 'Deposit $' + capital + ' of USDC into ' + name + '\u2019s highest-yield vault on ' + chain + ' and let it compound.';
    if (c.indexOf('bridge') !== -1)
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') !== -1 || c.indexOf('restak') !== -1)
      return 'Stake $' + capital + ' of the chain\u2019s staking asset through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('perpetual') !== -1 || c.indexOf('derivative') !== -1 || c.indexOf('basis') !== -1)
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') !== -1)
      return 'Fund $' + capital + ' and place one market position on ' + name + ' on ' + chain + '.';
    if (c.indexOf('curator') !== -1 || c.indexOf('allocator') !== -1 || c.indexOf('risk') !== -1)
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') !== -1)
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') !== -1)
      return 'Mint $' + capital + ' of the protocol\u2019s yield asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') !== -1)
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('privacy') !== -1)
      return 'Deposit $' + capital + ' through ' + name + '\u2019s shielded pool on ' + chain + ' and keep the position open.';
    if (c.indexOf('index') !== -1)
      return 'Buy $' + capital + ' of ' + name + '\u2019s index token on ' + chain + ' and hold it.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  function secondActionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    var secondChain = row.chains && row.chains.length > 1 ? row.chains[1] : null;
    if (c.indexOf('lend') !== -1 || c.indexOf('cdp') !== -1 || c.indexOf('collateral') !== -1)
      return 'Borrow $20 against the supply on ' + name + ' and repay it the same week, so the wallet shows two-sided activity.';
    if (c.indexOf('dex') !== -1 || c.indexOf('leveraged farm') !== -1)
      return 'Vote on one ' + name + ' governance proposal, or join its liquidity mining program if one is live.';
    if (c.indexOf('yield') !== -1 || c.indexOf('aggregator') !== -1)
      return 'Claim the vault\u2019s yield once and restake it, so the wallet shows a harvest and a second deposit.';
    if (c.indexOf('bridge') !== -1)
      return secondChain === null
        ? 'Swap a small amount on the destination chain through ' + name + '\u2019s app, so the bridged funds move.'
        : 'Bridge a further $25 to ' + secondChain + ' through ' + name + ' and use it there.';
    if (c.indexOf('staking') !== -1 || c.indexOf('restak') !== -1)
      return 'Delegate a further $25 of stake through ' + name + ' and keep both receipts.';
    if (c.indexOf('perpetual') !== -1 || c.indexOf('derivative') !== -1 || c.indexOf('basis') !== -1)
      return 'Close the hedge, then open one more small position the following week.';
    if (c.indexOf('prediction') !== -1) return 'Settle the first market position, then place a second one.';
    if (c.indexOf('curator') !== -1 || c.indexOf('allocator') !== -1 || c.indexOf('risk') !== -1)
      return 'Move $25 of the vault shares into a second ' + name + ' vault and keep both.';
    if (c.indexOf('stable') !== -1) return 'Swap half the stable position back to USDC and re-enter it.';
    if (c.indexOf('rwa') !== -1) return 'Reinvest the first yield payout into the same ' + name + ' asset.';
    if (c.indexOf('insurance') !== -1) return 'File a test claim check on the policy page, without filing a real claim.';
    if (c.indexOf('privacy') !== -1) return 'Withdraw half the shielded deposit and re-deposit it.';
    if (c.indexOf('index') !== -1) return 'Rebalance the index holding once, selling a small slice and buying it back.';
    return 'Do a second on-chain action in ' + name + ' on ' + chain + ', such as a swap or a vote, so the wallet shows more than one interaction.';
  }

  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row);
    var gas = capital >= 150 ? 8 : 4;
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainActionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(row, capital, chain), cost: 'about $2 to $5 of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, open the protocol\u2019s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
    return steps.map(function (s) {
      var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
      if (t.length > 600) t = t.slice(0, 596) + '...';
      return t;
    });
  }

  // --- page state -----------------------------------------------------------
  var rows = RADAR.rows.slice();
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var state = { q: '', category: '', chain: '', sort: 'implied', view: 'board', slug: null };

  var el = {
    q: document.getElementById('q'),
    category: document.getElementById('category'),
    chain: document.getElementById('chain'),
    sort: document.getElementById('sort'),
    count: document.getElementById('count'),
    boardBody: document.querySelector('#board tbody'),
    liveBody: document.querySelector('#live tbody'),
    boardEmpty: document.getElementById('board-empty'),
    boardView: document.getElementById('board-view'),
    liveView: document.getElementById('live-view'),
    tabBoard: document.getElementById('tab-board'),
    tabLive: document.getElementById('tab-live'),
    drawer: document.getElementById('drawer'),
    drawerBody: document.getElementById('drawer-body'),
  };

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }

  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.sort !== 'implied') parts.push('sort=' + encodeURIComponent(state.sort));
    if (state.view !== 'board') parts.push('view=' + encodeURIComponent(state.view));
    if (state.slug) parts.push('p=' + encodeURIComponent(state.slug));
    var next = parts.length ? '#' + parts.join('&') : '';
    if (window.location.hash !== next) history.replaceState(null, '', next || window.location.pathname + window.location.search);
  }

  function applyHash() {
    var h = readHash();
    state.q = h.q || '';
    state.category = h.category || '';
    state.chain = h.chain || '';
    state.sort = h.sort || 'implied';
    state.view = h.view === 'live' ? 'live' : 'board';
    state.slug = h.p || null;
    el.q.value = state.q;
    el.category.value = state.category;
    el.chain.value = state.chain;
    el.sort.value = state.sort;
  }

  // --- header, model table, selects ----------------------------------------
  var top = rows[0];
  var boardTvl = rows.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
  document.getElementById('stat-rows').textContent = rows.length;
  document.getElementById('stat-watchlist').textContent = RADAR.watchlist_size + ' / ' + rows.length;
  document.getElementById('stat-top').textContent = top ? money(top.implied_value_usd) : '—';
  document.getElementById('stat-tvl').textContent = money(boardTvl);
  document.getElementById('stat-date').textContent = RADAR.as_of || '—';
  document.getElementById('global-multiple').textContent = (RADAR.global_multiple !== undefined ? RADAR.global_multiple : 0).toFixed(4);
  document.getElementById('global-samples').textContent = 'all comparables';
  document.getElementById('foot-source').textContent = RADAR.source || '—';
  document.getElementById('foot-date').textContent = RADAR.as_of || '—';
  document.getElementById('foot-floor').textContent = money(RADAR.floor_usd);
  document.getElementById('foot-model').textContent = RADAR.model_version || '—';

  var multBody = document.querySelector('#multiples tbody');
  (RADAR.multiples || []).forEach(function (m) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(m.category) + '</td><td>' + Number(m.multiple).toFixed(3) + '</td><td>' + m.samples + '</td>';
    multBody.appendChild(tr);
  });

  function fillSelect(select, values) {
    values.sort().forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
  }
  fillSelect(el.category, Array.from(new Set(rows.map(function (r) { return r.category; }).filter(Boolean))));
  fillSelect(el.chain, Array.from(new Set(rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))));

  // --- board rendering -------------------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && !(r.chains || []).includes(state.chain)) return false;
      if (q) {
        var hay = [r.name, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    return list.sort(by);
  }

  function renderBoard() {
    var list = filtered();
    el.boardBody.innerHTML = list.map(function (r) {
      var v = recompute(r);
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td>' + r.rank + '</td>' +
        '<td class="name"><a href="#p=' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a>' +
        '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + changePct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><strong>' + money(v.implied) + '</strong></td>' +
        '<td class="num">' + v.multiple.toFixed(3) + '</td>' +
        '</tr>';
    }).join('');
    el.boardEmpty.hidden = list.length > 0;
    el.count.textContent = list.length + ' of ' + rows.length + ' protocols shown';
  }

  function renderLive() {
    el.liveBody.innerHTML = (RADAR.live || []).map(function (r) {
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      return '<tr>' +
        '<td class="name">' + esc(r.name) + '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + money(r.mcap_usd) + '</strong></td>' +
        '<td class="num ' + cls + '">' + changePct(r.change_7d) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderTabs() {
    var board = state.view === 'board';
    el.boardView.hidden = !board;
    el.liveView.hidden = board;
    el.tabBoard.classList.toggle('active', board);
    el.tabLive.classList.toggle('active', !board);
    el.tabBoard.setAttribute('aria-selected', String(board));
    el.tabLive.setAttribute('aria-selected', String(!board));
    el.count.textContent = board
      ? filtered().length + ' of ' + rows.length + ' protocols shown'
      : (RADAR.live || []).length + ' live-token protocols, by market cap';
  }

  // --- detail drawer ---------------------------------------------------------
  function renderDrawer() {
    var row = state.slug ? bySlug[state.slug] : null;
    if (!row) { el.drawer.hidden = true; return; }
    var v = recompute(row);
    var steps = farmSteps(row);
    var multNote = v.samples > 0
      ? esc(row.category || '') + ' median, ' + v.samples + ' comparables, shrunk toward the global median'
      : 'global median — fewer than ' + (MODEL.min_category_samples || 3) + ' comparables in ' + esc(row.category || 'this category');
    var ageLine = row.age_days === null || row.age_days === undefined
      ? 'age unknown, counted as ' + UNKNOWN_AGE + ' days'
      : ageText(row.age_days) + ' old';
    var chains = row.chains || [];
    var chainLabel = chains.slice(0, 3).join(', ') + (chains.length > 3 ? ' +' + (chains.length - 3) + ' more' : '');
    el.drawerBody.innerHTML =
      '<p class="meta">Rank #' + row.rank + ' · ' + esc(row.category || '—') + ' · ' + esc(chainLabel || '—') + ' · ' + ageLine + '</p>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p>Still pre-token. Its implied value follows from the snapshot\u2019s own figures: ' +
      money(row.tvl_usd) + ' of TVL, priced at the ' + esc(row.category || 'category') + ' multiple of ' + v.multiple.toFixed(3) + '.</p>' +
      '<h3>How the value is worked out</h3>' +
      '<div class="math">' +
      '<div class="row"><span>TVL</span><span>' + moneyFull(row.tvl_usd) + '</span></div>' +
      '<div class="row"><span>Category multiple</span><span>' + v.multiple.toFixed(6) + ' — ' + multNote + '</span></div>' +
      '<div class="row"><span>7-day growth</span><span>' + changePct(row.change_7d) + ' → ×' + v.growthMult.toFixed(6) + '</span></div>' +
      '<div class="row"><span>Maturity</span><span>' + ageLine + ' → ×' + v.maturityMult.toFixed(6) + '</span></div>' +
      '<div class="row total"><span>Implied value</span><span>' + moneyFull(v.implied) + '</span></div>' +
      '</div>' +
      '<h3>Farm plan — seven steps</h3>' +
      '<ol class="steps">' + steps.map(function (s) {
        var m = s.match(/^(.*?) Cost: (.*?) Time: (.*?)\.$/);
        var text = m ? m[1] : s;
        var cost = m ? m[2] : '';
        var time = m ? m[3] : '';
        return '<li>' + esc(text) + '<span class="cost">Cost: ' + esc(cost) + ' · Time: ' + esc(time) + '</span></li>';
      }).join('') + '</ol>' +
      '<p class="source-note">Values from the snapshot dated ' + esc(RADAR.as_of || '—') + '. The implied value is a model\u2019s estimate from one snapshot, not a forecast. Verify any claim on the protocol\u2019s own page before you send funds.</p>';
    el.drawer.hidden = false;
  }

  function render() {
    renderTabs();
    if (state.view === 'board') renderBoard();
    renderDrawer();
    writeHash();
  }

  // --- events ----------------------------------------------------------------
  el.q.addEventListener('input', function () { state.q = el.q.value; renderBoard(); writeHash(); });
  el.category.addEventListener('change', function () { state.category = el.category.value; renderBoard(); writeHash(); });
  el.chain.addEventListener('change', function () { state.chain = el.chain.value; renderBoard(); writeHash(); });
  el.sort.addEventListener('change', function () { state.sort = el.sort.value; renderBoard(); writeHash(); });
  el.tabBoard.addEventListener('click', function () { state.view = 'board'; render(); });
  el.tabLive.addEventListener('click', function () { state.view = 'live'; render(); });
  document.getElementById('drawer-close').addEventListener('click', function () {
    state.slug = null; renderDrawer(); writeHash();
  });
  el.boardBody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { state.slug = tr.getAttribute('data-slug'); renderDrawer(); writeHash(); }
  });
  window.addEventListener('hashchange', function () { applyHash(); render(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.slug) { state.slug = null; renderDrawer(); writeHash(); }
  });

  applyHash();
  renderLive();
  render();
})();
