// Token Radar's dashboard, model radar-2. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with the
// model's own inputs and the protocol's farm plan, and a sandbox that re-runs the model live.
// No network: every byte it shows is in data.js.
(() => {
  'use strict';

  if (!window.RADAR) return;
  const DATA = window.RADAR;
  const app = document.getElementById('board');
  const state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null };

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** `n` held inside [lo, hi]. */
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** The tiers a dollar amount is shortened by: billions, millions, thousands, then the raw figure. */
  const USD_TIERS = [
    [1e9, (n) => '$' + (n / 1e9).toFixed(2) + 'B'],
    [1e6, (n) => '$' + (n / 1e6).toFixed(1) + 'M'],
    [1e3, (n) => '$' + Math.round(n / 1e3) + 'K'],
  ];
  const fmtUsd = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    const tier = USD_TIERS.find(([floor]) => Math.abs(n) >= floor);
    return tier ? tier[1](n) : usd.format(n);
  };
  const fmtPct = (n) =>
    n === null || n === undefined || !isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const fmtAge = (days) =>
    days === null || days === undefined ? 'unknown' : days >= 365 ? (days / 365).toFixed(1) + 'y' : Math.max(0, Math.round(days)) + 'd';

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. The sandbox runs this same function with changed constants.
  const impliedOf = (row, model) => {
    const growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    const chains = row.chains ? row.chains.length : 0;
    const factors = [
      1 + (growth / 100) * model.growth_weight,
      model.maturity_floor + (clamp(age, 0, model.maturity_days) / model.maturity_days) * model.maturity_range,
      1 + model.chains_step * clamp(chains - 1, 0, model.chains_cap),
    ];
    const implied = Math.max(1, Math.round(factors.reduce((acc, f) => acc * f, row.tvl_usd * model.base_multiple)));
    return { implied, growthMult: factors[0], maturity: factors[1], chainsMult: factors[2], growth, age };
  };
  const modelOf = () => state.sandbox || DATA.model;

  /** How one attribute lands on a node: class, text and html are set directly, on* listens,
   * the rest is an attribute. A null or undefined value sets nothing, so callers can pass
   * a value only when it applies (a selected option, a checked box). */
  const ATTR_HANDLERS = {
    class: (node, v) => { node.className = v; },
    text: (node, v) => { node.textContent = v; },
    html: (node, v) => { node.innerHTML = v; },
  };
  const h = (tag, attrs, kids = []) => {
    const node = document.createElement(tag);
    Object.entries(attrs ?? {}).forEach(([k, v]) => {
      if (v === null || v === undefined) return;
      const handler = ATTR_HANDLERS[k];
      if (handler) handler(node, v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    node.append(
      ...kids
        .flat()
        .filter((c) => c !== null && c !== undefined)
        .map((c) => (typeof c === 'string' ? document.createTextNode(c) : c)),
    );
    return node;
  };

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold, the risk and every cost and time. No name is special-cased.
  const chainOf = (p) => (p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain');
  const CAPITAL_TIERS = [
    [5e9, 250],
    [1e9, 150],
    [1e8, 100],
  ];
  const capitalFor = (p) => CAPITAL_TIERS.find(([floor]) => p.tvl_usd >= floor)?.[1] ?? 50;
  const HOLD_TIERS = [
    [180, 60],
    [365, 45],
  ];
  const holdDaysFor = (age) => (age === null || age === undefined ? 30 : HOLD_TIERS.find(([max]) => age < max)?.[1] ?? 30);
  const ACTION_RULES = [
    { keys: ['lend', 'cdp', 'collateral'], build: (capital, name, chain) => 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.' },
    { keys: ['dex', 'yield', 'leveraged farm'], build: (capital, name, chain) => 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.' },
    { keys: ['bridge'], build: (capital, name, chain) => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.' },
    { keys: ['staking', 'restak'], build: (capital, name, chain) => "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.' },
    { keys: ['perpetual', 'derivative'], build: (capital, name, chain) => 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.' },
    { keys: ['prediction'], build: (capital, name) => 'Fund $' + capital + ' and place one market position on ' + name + '.' },
    { keys: ['curator', 'allocator'], build: (capital, name, chain) => 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.' },
    { keys: ['stable'], build: (capital, name, chain) => 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.' },
    { keys: ['rwa'], build: (capital, name, chain) => "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.' },
    { keys: ['insurance'], build: (capital, name, chain) => 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.' },
    { keys: ['basis'], build: (capital, name, chain) => 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and keep the shares.' },
    { keys: ['chain'], build: (capital, name) => 'Bridge $' + capital + ' of USDC to ' + name + ' and use its flagship apps every week.' },
  ];
  const actionFor = (p, capital, chain) => {
    const c = (p.category || '').toLowerCase();
    const rule = ACTION_RULES.find((r) => r.keys.some((k) => c.includes(k)));
    return rule ? rule.build(capital, p.name, chain) : 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  };
  const RISK_RULES = [
    { keys: ['dex', 'yield', 'leveraged farm'], text: 'Liquidity positions can lose value against simply holding the assets, so size the position so a 20% divergence still leaves you comfortable, and check the pool fee tier before you deposit.' },
    { keys: ['lend', 'cdp', 'perpetual', 'derivative'], text: 'Borrowed and leveraged positions can be liquidated in a sharp move, so keep the health factor above 2 and never borrow against the same collateral twice.' },
    { keys: ['bridge'], text: 'Bridges hold custody of your funds in transit, so move in two smaller transfers first and confirm the first lands before you send the second.' },
    { keys: ['staking', 'restak'], text: 'Staked assets can be slashed and take days to unstake, so keep a separate liquid reserve and note the unbonding period before you lock anything.' },
  ];
  const riskFor = (p) => {
    const c = (p.category || '').toLowerCase();
    return RISK_RULES.find((r) => r.keys.some((k) => c.includes(k)))?.text ??
      'The protocol contracts are unaudited by you, so farm only with funds you can afford to lose and check whether audits are published before you deposit.';
  };
  const stepText = (step) => {
    const s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) return s.slice(0, 596) + '...';
    if (s.length < 20) return s + " Hold the position and check the protocol's own page.";
    return s;
  };
  const farmSteps = (p) => {
    const chain = chainOf(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Open the protocol's own points or rewards page and claim only from a link it publishes, and verify every contract address from its official docs first.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: riskFor(p), cost: 'nothing but the discipline', time: '5 minutes to check' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Unwind in stages when a token is announced, and do not chase the launch price: the farm was the position, not the first candle.', cost: 'about $4 of gas to exit', time: '15 minutes to exit' },
    ].map(stepText);
  };

  /** The hash carries the state: each key knows how to read itself back into the state. */
  const HASH_STATE = [
    ['q', (v) => { state.q = v; }],
    ['p', (v) => { state.selected = v; }],
    ['category', (v) => { state.category = v; }],
    ['chain', (v) => { state.chain = v; }],
    ['watch', (v) => { state.watch = v === '1'; }],
    ['tab', (v) => { state.tab = v; }],
  ];
  const readHash = () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    HASH_STATE.forEach(([key, apply]) => {
      const v = params.get(key);
      if (v !== null) apply(v);
    });
  };
  const writeHash = () => {
    const entries = [
      ['q', state.q],
      ['category', state.category === 'all' ? '' : state.category],
      ['chain', state.chain === 'all' ? '' : state.chain],
      ['watch', state.watch ? '1' : ''],
      ['tab', state.tab === 'pre-token' ? '' : state.tab],
      ['p', state.selected ?? ''],
    ];
    const params = new URLSearchParams(entries.filter(([, v]) => v !== ''));
    const next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  };

  // The board under the sandbox: the same rows, rescored and re-ranked by the sandbox model.
  const byScore = (a, b) => {
    if (a.implied !== b.implied) return b.implied - a.implied;
    return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
  };
  const scoredRows = () =>
    DATA.rows
      .map((r) => ({ row: r, implied: impliedOf(r, modelOf()).implied, rank: 0 }))
      .sort(byScore)
      .map((s, i) => ({ ...s, rank: i + 1 }));
  const visibleRows = () => {
    const q = state.q.trim().toLowerCase();
    const checks = [
      (s) => !state.watch || s.row.watchlist,
      (s) => state.category === 'all' || s.row.category === state.category,
      (s) => state.chain === 'all' || (s.row.chains || []).includes(state.chain),
      (s) => {
        if (!q) return true;
        const hay = [s.row.name, s.row.slug, s.row.category, (s.row.chains || []).join(' ')].join(' ').toLowerCase();
        return hay.includes(q);
      },
    ];
    return scoredRows().filter((s) => checks.every((check) => check(s)));
  };
  /** One comparator per sort key: the page sorts by the key's value, then by slug. */
  const SORTS = {
    name: (a, b) => {
      const x = a.row.name.toLowerCase();
      const y = b.row.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    },
    tvl: (a, b) => a.row.tvl_usd - b.row.tvl_usd,
    growth: (a, b) => (a.row.change_7d ?? -Infinity) - (b.row.change_7d ?? -Infinity),
    age: (a, b) => (a.row.age_days ?? Infinity) - (b.row.age_days ?? Infinity),
    implied: (a, b) => a.implied - b.implied,
  };
  const sortedRows = (list) => {
    const compare = SORTS[state.sort] ?? SORTS.implied;
    return [...list].sort((a, b) => {
      const d = compare(a, b) * state.dir;
      return d !== 0 ? d : a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  };

  const header = () =>
    h('header', { class: 'top' }, [
      h('div', { class: 'brand' }, [
        h('span', { class: 'mark' }),
        h('span', { class: 'brand-name', text: 'Token Radar' }),
      ]),
      h('div', { class: 'top-meta' }, [
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' }),
      ]),
    ]);

  const lede = () => {
    const top10 = DATA.rows.slice(0, 10).reduce((n, r) => n + r.implied_value_usd, 0);
    const facts = [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Top 10 implied value', fmtUsd(top10)],
      ['Live-token protocols set aside', String(DATA.live_size)],
    ];
    return h('section', { class: 'lede' }, [
      h('div', null, [
        h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every one of them. Implied value is a model, not a promise.' }),
      ]),
      h('div', { class: 'facts' }, facts.map(([label, value]) => h('div', { class: 'fact' }, [h('span', { text: label }), h('b', { text: value })]))),
    ]);
  };

  const controls = () => {
    const categories = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort();
    const chains = [...new Set(DATA.rows.flatMap((r) => r.chains || []))].sort();
    const search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { state.q = search.value; writeHash(); render(); });
    const catSelect = h('select', { id: 'category', 'aria-label': 'Filter by category' }, [
      h('option', { value: 'all', text: 'All categories' }),
      ...categories.map((c) => h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null })),
    ]);
    catSelect.addEventListener('change', () => { state.category = catSelect.value; writeHash(); render(); });
    const chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' }, [
      h('option', { value: 'all', text: 'All chains' }),
      ...chains.map((c) => h('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null })),
    ]);
    chainSelect.addEventListener('change', () => { state.chain = chainSelect.value; writeHash(); render(); });
    const watchBox = h('input', { type: 'checkbox', id: 'watch', checked: state.watch ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchBox.addEventListener('change', () => { state.watch = watchBox.checked; writeHash(); render(); });
    const tabButton = (tab, label) =>
      h('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: () => { state.tab = tab; render(); } });
    const count = state.tab === 'pre-token'
      ? visibleRows().length + ' rows shown' + (state.sandbox ? ' (sandbox ranks)' : '')
      : DATA.live.length + ' live-token protocols';
    return h('div', { class: 'controls' }, [
      h('div', { class: 'field' }, [h('label', { for: 'q', text: 'Search' }), search]),
      h('div', { class: 'field' }, [h('label', { for: 'category', text: 'Category' }), catSelect]),
      h('div', { class: 'field' }, [h('label', { for: 'chain', text: 'Chain' }), chainSelect]),
      h('label', { class: 'check', for: 'watch' }, [watchBox, h('span', { text: 'Watchlist only' })]),
      h('div', { class: 'field' }, [h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, [tabButton('pre-token', 'Pre-token'), tabButton('live', 'Live token')])]),
      h('span', { class: 'count', text: count }),
    ]);
  };

  const sortHeader = (key, label) =>
    h('th', { scope: 'col' }, [
      h('button', { type: 'button', onclick: () => { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }, [
        label,
        state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null,
      ]),
    ]);

  /** One board row: rank, protocol, TVL, growth, age, chains, implied value with its bar, token status. */
  const boardRow = (s, max) => {
    const r = s.row;
    const growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return h('tr', {
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: () => openDetail(r.slug),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
    }, [
      h('td', { class: 'num rank', text: String(s.rank) }),
      h('td', null, [
        h('div', { class: 'name' }, [
          h('span', null, [h('b', { text: r.name }), r.watchlist ? h('span', { class: 'badge', text: 'watchlist' }) : null]),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
        ]),
      ]),
      h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: growth }),
      h('td', { class: 'num', text: fmtAge(r.age_days) }),
      h('td', { class: 'num', text: String(r.chains ? r.chains.length : 0) }),
      h('td', null, [
        h('div', { class: 'implied' }, [
          h('div', { class: 'bar', 'aria-hidden': 'true' }, [h('i', { style: 'width:' + Math.max(3, Math.round((s.implied / max) * 100)) + '%' })]),
          h('span', { class: 'num', text: fmtUsd(s.implied) }),
        ]),
      ]),
      h('td', null, [h('span', { class: 'status', text: 'no token' })]),
    ]);
  };

  const boardTable = () => {
    const list = sortedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, [
        h('div', { class: 'empty' }, [
          h('h2', { text: 'No protocol matches that filter' }),
          h('p', { text: 'Clear the search or pick another category to see the board again.' }),
          h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: () => { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } }),
        ]),
      ]);
    }
    const max = list[0].implied || 1;
    const heads = [
      ['implied', 'Rank'],
      ['name', 'Protocol'],
      ['tvl', 'TVL'],
      ['growth', '7d'],
      ['age', 'Age'],
      ['chains', 'Chains'],
      ['implied', 'Implied value'],
    ];
    return h('div', { class: 'panel' }, [
      h('div', { class: 'table-wrap' }, [
        h('table', null, [
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, [h('tr', null, [...heads.map(([key, label]) => sortHeader(key, label)), h('th', { scope: 'col', text: 'Token' })])]),
          h('tbody', null, list.map((s) => boardRow(s, max))),
        ]),
      ]),
    ]);
  };

  const liveTable = () => {
    const rows = DATA.live.map((r) =>
      h('tr', null, [
        h('td', { class: 'num', text: 'live' }),
        h('td', null, [h('div', { class: 'name' }, [h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.join(', ') : 'an unnamed chain') })])]),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', null, [h('span', { class: 'status live', text: 'already trades' })]),
      ]),
    );
    return h('div', { class: 'panel' }, [
      h('div', { class: 'table-wrap' }, [
        h('table', null, [
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, [h('tr', null, ['Status', 'Protocol', 'TVL', '7d', 'Market cap', 'Token'].map((label) => h('th', { scope: 'col', text: label })))]) ,
          h('tbody', null, rows),
        ]),
      ]),
    ]);
  };

  const modelPanel = () => {
    const m = DATA.model;
    const sandbox = state.sandbox;
    const fields = [
      ['base_multiple', 'Base multiple (TVL share)', sandbox ? sandbox.base_multiple : m.base_multiple, '0.05'],
      ['growth_weight', 'Growth weight', sandbox ? sandbox.growth_weight : m.growth_weight, '0.1'],
      ['chains_step', 'Per-chain premium', sandbox ? sandbox.chains_step : m.chains_step, '0.01'],
    ];
    const numField = ([id, label, value, step]) => {
      const input = h('input', { type: 'number', id, value: String(value), step, min: '0', 'aria-label': label });
      input.addEventListener('input', () => {
        const next = { ...DATA.model, ...(state.sandbox || {}) };
        const v = parseFloat(input.value);
        if (isFinite(v) && v >= 0) next[id] = v;
        state.sandbox = next;
        render();
      });
      return h('div', { class: 'field' }, [h('label', { for: id, text: label }), input]);
    };
    return h('section', { class: 'panel model' }, [
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' }, [
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chains_step + ' x min(chains - 1, ' + m.chains_cap + ')) )',
      ]),
      h('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chains is how many chains the protocol runs on: more chains, a wider holder base for the eventual token, at most a 20% premium. The early radar is every pre-token protocol below the watchlist floor that is not a wrapped, staked or bridged product of a token that trades, and the live-token protocols are set aside with their market caps shown.' }),
      h('h3', { text: 'Model sandbox' }),
      h('p', { class: 'sub', text: 'Change a constant and the board re-ranks at once, with this same function. The board on file keeps model ' + DATA.model_version + '; the sandbox only changes what you see here.' }),
      h('div', { class: 'sandbox' }, fields.map(numField)),
      h('div', null, [
        h('button', { class: 'button', type: 'button', text: 'Reset sandbox', onclick: () => { state.sandbox = null; render(); } }),
        sandbox ? h('span', { class: 'sandbox-note', text: ' Sandbox active: ranks on this page are recomputed, not the board on file.' }) : null,
      ]),
    ]);
  };

  const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { state.selected = null; writeHash(); });

  const openDetail = (slug) => {
    const scored = scoredRows().find((s) => s.row.slug === slug);
    if (!scored) return;
    const row = scored.row;
    const c = impliedOf(row, modelOf());
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    const steps = farmSteps(row);
    const equation = [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Seven-day growth', fmtPct(row.change_7d)],
      ['Age with no token', fmtAge(row.age_days)],
      ['Chains', String(row.chains ? row.chains.length : 0)],
      ['Growth multiplier', c.growthMult.toFixed(4)],
      ['Maturity multiplier', c.maturity.toFixed(4)],
      ['Chains multiplier', c.chainsMult.toFixed(4)],
    ];
    const note =
      'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(c.implied) +
      (state.sandbox ? ' under the sandbox constants.' : c.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') +
      ' This is an estimate, not a price.';
    dialog.append(
      h('div', { class: 'detail-head' }, [
        h('div', null, [
          h('span', { class: 'brand-name', text: 'Rank ' + scored.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : '') }),
          h('h2', { id: 'detail-title', text: row.name }),
          h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
        ]),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() }),
      ]),
      h('section', { class: 'detail-section' }, [
        h('h3', { text: 'Implied value' }),
        h('div', { class: 'equation' }, [
          ...equation.map(([label, value]) => h('div', null, [h('span', { text: label }), h('b', { class: 'num', text: value })])),
          h('div', { class: 'total' }, [h('span', { text: 'Implied value' }), h('b', { class: 'num', text: fmtUsd(c.implied) })]),
        ]),
        h('p', { class: 'sub', text: note }),
      ]),
      h('section', { class: 'detail-section' }, [
        h('h3', { text: 'Farm plan' }),
        h('ol', { class: 'steps' }, steps.map((s) => {
          const at = s.indexOf(' Cost: ');
          const action = at >= 0 ? s.slice(0, at) : s;
          const tail = at >= 0 ? s.slice(at + 1) : '';
          return h('li', null, [h('b', { text: action }), h('span', { class: 'cost', text: tail })]);
        })),
      ]),
    );
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  };

  const render = () => {
    app.textContent = '';
    const shell = h('div', { class: 'shell' }, [
      header(),
      lede(),
      controls(),
      state.tab === 'pre-token' ? boardTable() : liveTable(),
      ...(state.tab === 'pre-token' ? [modelPanel()] : []),
    ]);
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  };

  readHash();
  render();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
