// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// draws the ranked board, a filterable table, a per-protocol detail drawer carrying the model's
// own inputs and the protocol's farm plan, and the comparables the model prices from. No network:
// every byte on screen comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) { // dollars, compact: $1.23B, $45.6M, $789K, or the plain format below $1K
    if (n == null || !isFinite(n)) return 'n/a';
    var magnitude = Math.abs(n);
    if (magnitude >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (magnitude >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (magnitude >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) { // a percent with its sign: +12.34%, -5.00%
    if (n == null || !isFinite(n)) return 'n/a';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }
  function fmtAge(days) { // an age in years past a year, else whole days
    if (days == null) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    var whole = Math.max(0, Math.round(days));
    return whole + 'd';
  }
  function fmtMult(n) { // a multiple: x1.25
    if (n == null || !isFinite(n)) return 'n/a';
    var rounded = n.toFixed(2);
    return 'x' + rounded;
  }
  // The model, in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are the same arithmetic.
  function impliedOf(row, model) {
    var change = row.change_7d == null ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthMult = 1 + model.growth_weight * Math.tanh(growth / model.growth_scale);
    var age = row.age_days == null ? model.unknown_age_days : row.age_days;
    var logCap = Math.log(1 + model.maturity_days);
    var logAge = Math.log(1 + Math.max(age, 0));
    var maturity = model.maturity_floor + (Math.min(logAge, logCap) / logCap) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    var breadth = 1 + model.breadth_per_chain * extra;
    return Math.max(1, Math.round(row.tvl_usd * row.comp_multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null) continue;
      if (Array.isArray(child)) child.forEach(function (grandchild) { if (grandchild) node.appendChild(grandchild); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { var first = p.chains && p.chains.length > 0 ? p.chains[0] : undefined; return first === undefined ? 'its main chain' : first; }
  var CAPITAL_TIERS = [[5e9, 250], [1e9, 150], [1e8, 100]];
  function capitalFor(p) {
    for (var i = 0; i < CAPITAL_TIERS.length; i++) {
      if (p.tvl_usd >= CAPITAL_TIERS[i][0]) return CAPITAL_TIERS[i][1];
    }
    return 50;
  }
  function holdDaysFor(age) {
    if (age == null || age >= 365) return 30;
    return age < 180 ? 60 : 45;
  }
  var ACTIONS = [
    [/lend|cdp|collateral/, function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; }],
    [/dex|yield|leveraged farm/, function (name, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'; }],
    [/bridge/, function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'; }],
    [/staking|restak/, function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'; }],
    [/perpetual|derivative/, function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'; }],
    [/prediction/, function (name, capital, chain) { return 'Fund $' + capital + ' and place one market position on ' + name + '.'; }],
    [/curator|allocator/, function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.'; }],
    [/stable/, function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; }],
    [/rwa/, function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; }],
    [/insurance/, function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'; }]
  ];
  function actionFor(p, capital, chain) {
    var category = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTIONS.length; i++) {
      if (ACTIONS[i][0].test(category)) return ACTIONS[i][1](p.name, capital, chain);
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  var WEEKLY = [
    [/lend|cdp|collateral/, function (name) { return 'Borrow a small amount against the supply on ' + name + ', then repay it the same week.'; }],
    [/dex|yield|leveraged farm/, function (name, capital, chain) { return 'Swap a small amount through ' + name + "'s main pool on " + chain + ', or claim and restake half of the rewards.'; }],
    [/bridge/, function (name) { return 'Bridge a small amount back the other way through ' + name + ' so the round trip is on record.'; }],
    [/staking|restak/, function (name) { return 'Top up the stake through ' + name + ' by a small amount and keep the receipt.'; }],
    [/perpetual|derivative/, function (name) { return 'Close the hedge on ' + name + ' and open a fresh one at a smaller size.'; }],
    [/prediction/, function (name) { return 'Settle one market on ' + name + ' and open another small position.'; }],
    [/rwa/, function (name) { return 'Hold through one distribution on ' + name + ' and check the yield lands in the wallet.'; }],
    [/insurance/, function (name) { return 'Check the policy on ' + name + ' is active and renew the cover if it lapses.'; }],
    [/curator|allocator/, function (name, capital, chain) { return 'Rebalance the ' + name + ' vault position on ' + chain + ' by a small amount.'; }]
  ];
  function weeklyFor(p, capital, chain) {
    var category = (p.category || '').toLowerCase();
    for (var i = 0; i < WEEKLY.length; i++) {
      if (WEEKLY[i][0].test(category)) return WEEKLY[i][1](p.name, capital, chain);
    }
    return 'Make one small deposit, swap or vote on ' + p.name + ' so the wallet stays active.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(p, capital, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, then unwind in reverse order: claim, withdraw, and keep enough for gas.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var raw = window.location.hash;
    var hash = raw.charAt(0) === '#' ? raw.slice(1) : raw;
    if (hash === '') return;
    var params = new URLSearchParams(hash); // the deep-link state: q, p, category, chain, tab, wl
    var get = function (name) { return params.get(name); };
    if (get('q')) state.q = get('q');
    if (get('p')) state.selected = get('p');
    if (get('category')) state.category = get('category');
    if (get('chain')) state.chain = get('chain');
    if (get('tab')) state.tab = get('tab');
    if (get('wl') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    var entries = [
      ['q', state.q],
      ['category', state.category !== 'all' ? state.category : ''],
      ['chain', state.chain !== 'all' ? state.chain : ''],
      ['wl', state.watchlistOnly ? '1' : ''],
      ['tab', state.tab !== 'pre-token' ? state.tab : ''],
      ['p', state.selected]
    ];
    entries.forEach(function (pair) {
      if (pair[1]) params.set(pair[0], pair[1]);
    });
    var next = params.toString();
    // The hash is a convenience, never a load-bearing part of the page: when the browser refuses
    // the history write (a file:// view, a sandboxed frame), fall back to the plain hash setter
    // and, failing that, carry on without it. A thrown history call must never stop a filter or
    // a detail view from opening.
    try {
      if (next) window.history.replaceState(null, '', '#' + next);
      else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (err) {
      try { window.location.hash = next; } catch (ignored) { /* the hash stays stale; the page still works */ }
    }
  }

  function watchlistSet() {
    if (!state._watchlist) state._watchlist = new Set(DATA.watchlist || []);
    return state._watchlist;
  }
  function rows() {
    var query = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (row) {
      if (state.category !== 'all' && (row.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchlistOnly && !watchlistSet().has(row.slug)) return false;
      if (!query) return true;
      var hay = [row.name, row.slug, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(query) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = valueOf(a, key);
      var bv = valueOf(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    function valueOf(row, sortKey) {
      if (sortKey === 'name') return row.name.toLowerCase();
      if (sortKey === 'tvl') return row.tvl_usd;
      if (sortKey === 'growth') return row.change_7d === null ? -Infinity : row.change_7d;
      if (sortKey === 'age') return row.age_days === null ? Infinity : row.age_days;
      if (sortKey === 'comp') return row.comp_multiple;
      return row.implied_value_usd;
    }
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top = DATA.rows.slice(0, 5);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Each implied value is priced from the live market: the median market-cap-to-TVL multiple of the tokens already trading in its category. Implied value is a model, not a promise.' }),
        el('div', { class: 'top5' }, top.map(function (r) {
          return el('span', { class: 'chip' },
            el('span', { class: 'rank-dot', text: '#' + r.rank }),
            el('b', { text: r.name }),
            el('span', { text: fmtUsd(r.implied_value_usd) })
          );
        }))
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'wl' }, wl, el('span', { text: 'Watchlist only' })),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.comp_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('comp', 'Comp x'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they price it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var compRows = (DATA.comparables || []).filter(function (c) { return c.comps >= 1; });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. The multiple comes from the live market: for each category, the median market-cap-to-TVL ratio of the tokens already trading in it. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x comp_multiple x (1 + ' + m.growth_weight + ' x tanh(clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / ' + m.growth_scale + ')) x (' + m.maturity_floor + ' + min(ln(1 + age_days), ln(' + (m.maturity_days + 1) + ')) / ln(' + (m.maturity_days + 1) + ') x ' + m.maturity_range + ') x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + ')) )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Breadth counts the chains the protocol runs on. A category with fewer than ' + m.comp_min_comps + ' live tokens to price from falls back to the median over every live token. The early radar is every pre-token protocol below the watchlist floor, by TVL.' }),
      el('h3', { text: 'Comparables: the multiple each category is priced at' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Median mcap / TVL' }),
            el('th', { scope: 'col', text: 'Live tokens priced from' }),
            el('th', { scope: 'col', text: 'Source' })
          )),
          el('tbody', null, compRows.map(function (c) {
            return el('tr', null,
              el('td', { text: c.category }),
              el('td', { class: 'num', text: fmtMult(c.multiple) }),
              el('td', { class: 'num', text: String(c.comps) }),
              el('td', { class: 'sub', text: c.fallback ? 'global median (too few live tokens in this category)' : 'category median' })
            );
          }))
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Comparable multiple (' + (row.category || 'Other') + ', ' + row.comp_comps + ' live token' + (row.comp_comps === 1 ? '' : 's') + ')' }), el('b', { class: 'num', text: fmtMult(row.comp_multiple) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (Math.abs(recomputed - row.implied_value_usd) <= 0.001 * row.implied_value_usd ? ', the same value board.json carries (to rounding).' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
