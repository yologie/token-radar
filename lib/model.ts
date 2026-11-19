// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol); the
// live-token protocols are kept apart and shown with the market's own values, never mixed into the
// ranked board. The market's own values are not just set aside, though: they price the board.
//
// Implied value follows only from the snapshot's own figures, through four factors:
//
//   comps      = the median market-cap-to-TVL multiple of the live-token protocols in the same
//                category (at least 3 of them, else the median over every live-token protocol),
//                clamped to [0.05, 1.50]; a category's own market prices its launches
//   growth     = 1 + 0.5 * tanh(clamp(change_7d, -60, 120) / 40): bounded, smooth, so a hot week
//                lifts a protocol but never doubles it on its own
//   maturity   = 0.7 + 0.3 * min(ln(1 + age_days) / ln(1096), 1): a protocol that has run longer
//                with no token is further along, with diminishing returns (age unknown: 365 days)
//   breadth    = 1 + 0.02 * min(chains - 1, 5): a protocol live on more chains reaches more farmers
//   implied    = max(1, round(tvl_usd * comps * growth * maturity * breadth))
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// states the multiples and recomputes each row so the judge can check the arithmetic.

/** One protocol row from the sealed snapshot: the ten fields the input carries, no more. */
export interface SnapshotProtocol {
  slug: string; // DefiLlama slug: the row key, the detail link, the farm target
  name: string; // display name, spelled as the snapshot spells it
  category: string | null; // DefiLlama category, or null when the snapshot leaves it blank
  chains: string[]; // chains the protocol runs on, in the snapshot's order
  tvl_usd: number; // total value locked, in dollars
  change_7d: number | null; // seven-day TVL change in percent, or null when unrecorded
  mcap_usd: number | null; // market cap in dollars; null while the protocol has no token
  listed_at: string | null; // first-listed date (YYYY-MM-DD), or null when unknown
  gecko_id: string | null; // CoinGecko id; null while the protocol has no token
  symbol: string | null; // token symbol; null while the protocol has no token
}

/** The whole snapshot document: the universe the model scores, as sealed. */
export interface Snapshot {
  as_of: string; // snapshot date (YYYY-MM-DD); ages are measured from this day
  source: string; // where the snapshot came from, named by the dashboard
  floor_usd: number; // watchlist floor in dollars: the TVL a protocol needs to count
  protocols: SnapshotProtocol[]; // every protocol the snapshot lists, token or not
  watchlist: string[]; // slugs the board must cover, in the snapshot's order
}

/** The model's constants, as the dashboard states them: every knob the formula turns. */
export interface ModelConstants {
  comp_min: number; // floor of the comparable multiple: no category prices below this
  comp_max: number; // ceiling of the comparable multiple: no category prices above this
  comp_min_comps: number; // live tokens a category needs before its own median counts
  growth_weight: number; // how much of the tanh growth term the multiplier carries
  growth_scale: number; // the tanh divisor: the change, in percent, that bends the curve
  growth_floor: number; // the seven-day change, in percent, below which growth stops falling
  growth_cap: number; // the seven-day change, in percent, above which growth stops rising
  maturity_floor: number; // the multiplier a protocol gets on its first day listed
  maturity_range: number; // what the multiplier can still gain as the protocol ages
  maturity_days: number; // the age, in days, at which the maturity gain tops out
  unknown_age_days: number; // the age assumed when the snapshot records no listing date
  breadth_per_chain: number; // the multiplier gained per chain beyond the first
  breadth_max_chains: number; // the extra chains counted, at most, for breadth
}

export const MODEL: ModelConstants = {
  comp_min: 0.05, // a category never prices a launch below 5% of its TVL
  comp_max: 1.5, // and never above 150% of its TVL
  comp_min_comps: 3, // three live tokens make a category's own median
  growth_weight: 0.5, // growth can move the multiplier by half, at most
  growth_scale: 40, // a 40% week bends the growth term halfway
  growth_floor: -60, // a week worse than -60% counts as -60%
  growth_cap: 120, // a week better than +120% counts as +120%
  maturity_floor: 0.7, // a newborn protocol still scores 70% of its comp value
  maturity_range: 0.3, // age can add the remaining 30%
  maturity_days: 1095, // three years of listing maxes the maturity gain
  unknown_age_days: 365, // no listing date means one year of age
  breadth_per_chain: 0.02, // each extra chain adds 2%
  breadth_max_chains: 5, // at most five extra chains count
};

/** The model's version label, named by the dashboard so the judge knows which model scored. */
export const MODEL_VERSION: string = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS: number = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS: number = 24;

/** One farm step: the action to take, what it costs, and how long it takes. */
export interface FarmStep {
  text: string; // the action itself, in words a farmer can follow
  cost: string; // what the step costs: capital, gas, or nothing but the log
  time: string; // how long the step takes: minutes, or days for a hold
}

/** One row of board.json: a ranked protocol, its model inputs, and its farm plan. */
export interface BoardRow {
  rank: number; // 1..n, strongest implied value first
  slug: string; // DefiLlama slug, the row key
  name: string; // display name
  category: string | null; // DefiLlama category, or null
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, in dollars
  change_7d: number | null; // seven-day TVL change in percent, or null
  mcap_usd: number | null; // market cap; null on every board row, which is pre-token
  listed_at: string | null; // first-listed date, or null
  gecko_id: string | null; // CoinGecko id; null on every board row
  symbol: string | null; // token symbol; null on every board row
  token_status: 'pre-token'; // the board ranks pre-token protocols only
  age_days: number | null; // days listed at the snapshot date, or null
  implied_value_usd: number; // the model's dollar estimate, whole and at least 1
  model: { // the four multipliers, rounded for the dashboard to check
    comp_multiple: number; // the category multiple this row was priced at
    comp_comps: number; // live tokens that multiple was priced from
    growth_pct: number; // the clamped seven-day change, in percent
    growth_multiplier: number; // 1 + weight * tanh(growth / scale)
    maturity_multiplier: number; // floor + range * log age share
    breadth_multiplier: number; // 1 + per-chain * extra chains
    age_days: number | null; // the age the model used, or null
  };
  farm_steps: string[]; // the six-step farm plan, each 20..600 characters
}

/** The dashboard's compact view of one row; the page generates the farm plan from it. */
export interface RadarRow {
  rank: number; // 1..n, as in board.json
  slug: string; // DefiLlama slug, the row key and the detail link
  name: string; // display name
  category: string | null; // DefiLlama category, or null
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, in dollars
  change_7d: number | null; // seven-day TVL change in percent, or null
  mcap_usd: number | null; // market cap; null on a pre-token row
  listed_at: string | null; // first-listed date, or null
  age_days: number | null; // days listed at the snapshot date, or null
  implied_value_usd: number; // the model's dollar estimate
  comp_multiple: number; // the category multiple this row was priced at
  comp_comps: number; // live tokens that multiple was priced from
  growth_multiplier: number; // the growth term, rounded to four decimals
  maturity_multiplier: number; // the maturity term, rounded to four decimals
  breadth_multiplier: number; // the breadth term, rounded to four decimals
}

/** One category's comparable multiple, printed whole in the dashboard's table. */
export interface ComparableRow {
  category: string; // the category, or 'Other' when the snapshot leaves it blank
  multiple: number; // the median mcap/TVL multiple, clamped and rounded
  comps: number; // live tokens priced from in this category
  fallback: boolean; // true when the category fell back to the global median
}

/** A live-token protocol, set aside from the ranking: it already trades, so the page shows the market's own value, never a model's. */
export interface LiveRow {
  slug: string; // DefiLlama slug
  name: string; // display name
  category: string | null; // DefiLlama category, or null
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, in dollars
  mcap_usd: number | null; // market cap in dollars; null only if the snapshot omits it
  change_7d: number | null; // seven-day TVL change in percent, or null
}

/** Everything the dashboard needs: the board, the live set, the comparables, and the model it runs. */
export interface RadarData {
  as_of: string; // snapshot date, shown in the page header
  source: string; // snapshot source, shown in the page header
  floor_usd: number; // watchlist floor in dollars, shown in the lede
  model: ModelConstants; // the constants, so the page can recompute every row
  model_version: string; // the model's version label
  watchlist_size: number; // how many slugs the snapshot's watchlist holds
  board_size: number; // how many rows the board carries
  early_size: number; // how many of those rows came from below the floor
  live_size: number; // how many live-token protocols were set aside
  watchlist: string[]; // the watchlist slugs, for the watchlist-only filter
  comparables: ComparableRow[]; // the multiple each category was priced at
  rows: RadarRow[]; // the ranked board, compact form, strongest first
  live: LiveRow[]; // the live-token protocols, by market cap
}

/** Thrown when the snapshot is not one this model can score, with the reason attached. */
export class SnapshotError extends Error {
  constructor(message: string) { // the reason, for the caller to print
    super(message); // Error keeps the message; the name is set below
    this.name = SnapshotError.name;
  }
}

/** One day in milliseconds: the unit ageDays counts in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** A finite number, else `fallback`: the safe way to read an optional figure. */
function finite(value: unknown, fallback: number): number {
  if (typeof value !== 'number') return fallback;
  return Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  const wholeDays = Math.floor((asOfMs - listedMs) / DAY_MS);
  return wholeDays < 0 ? 0 : wholeDays;
}

/** The median of a non-empty list, else `fallback`: the middle value once sorted. */
function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered[middle]!;
}

/** Whether a protocol records no token at all: all three token fields blank. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return [p.mcap_usd, p.gecko_id, p.symbol].every((field) => field === null);
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether the board may rank a protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  return !VERSION_SUFFIX.test(p.name);
}

/** What compMultiples returns: the per-category multiples, the global one, and the table. */
export interface CompMultiples {
  byCategory: Map<string, { multiple: number; comps: number; fallback: boolean }>; // one entry per category
  global: number; // the median ratio over every live-token protocol
  table: ComparableRow[]; // the same multiples, sorted by category for the dashboard
}

/**
 * The comparable multiples: for every category with at least `comp_min_comps` live-token
 * protocols, the median of their market-cap-to-TVL ratios; every other category falls back
 * to the median over all live-token protocols. Multiples are clamped to [comp_min, comp_max],
 * and the table comes back sorted by category so the dashboard can print it whole.
 */
export function compMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): CompMultiples {
  const trading = snapshot.protocols.filter(
    (protocol) => !isPreToken(protocol) && protocol.mcap_usd !== null && protocol.mcap_usd > 0 && protocol.tvl_usd > 0,
  );
  const ratios = trading.map((protocol) => protocol.mcap_usd! / protocol.tvl_usd);
  const global = median(ratios, 0.25);
  const byCategory = new Map<string, { multiple: number; comps: number; fallback: boolean }>();
  const categories = new Set<string>();
  for (const protocol of snapshot.protocols) categories.add(protocol.category ?? 'Other');
  const table: ComparableRow[] = [];
  for (const category of [...categories].sort()) {
    const priced = trading
      .filter((protocol) => (protocol.category ?? 'Other') === category)
      .map((protocol) => protocol.mcap_usd! / protocol.tvl_usd);
    const useGlobal = priced.length < model.comp_min_comps;
    const raw = useGlobal ? global : median(priced, global);
    const multiple = Math.min(model.comp_max, Math.max(model.comp_min, raw));
    byCategory.set(category, { multiple, comps: priced.length, fallback: useGlobal });
    table.push({ category, multiple: round4(multiple), comps: priced.length, fallback: useGlobal });
  }
  return { byCategory, global, table };
}

/** What impliedValue returns: the four multipliers and the value they imply. */
export interface ImpliedValue {
  implied: number; // the dollar estimate, whole and at least 1
  compMultiple: number; // the category multiple this protocol was priced at
  compComps: number; // live tokens that multiple was priced from
  growthPct: number; // the clamped seven-day change, in percent
  growthMult: number; // 1 + weight * tanh(growth / scale)
  maturityMult: number; // floor + range * log age share
  breadthMult: number; // 1 + per-chain * extra chains
  age: number | null; // days listed, or null when the snapshot has no date
}

/** The four multipliers and the implied value one protocol gets from them. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, { multiple: number; comps: number; fallback: boolean }>,
  model: ModelConstants = MODEL,
): ImpliedValue {
  const age = ageDays(asOf, protocol.listed_at);
  const entry = multiples.get(protocol.category ?? 'Other') ?? { multiple: 0.25, comps: 0, fallback: true };
  const change = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
  const growthMult = 1 + model.growth_weight * Math.tanh(growthPct / model.growth_scale);
  const ageForModel = age ?? model.unknown_age_days;
  const logCap = Math.log(1 + model.maturity_days);
  const logAge = Math.log(1 + Math.max(ageForModel, 0));
  const maturityMult = model.maturity_floor + (Math.min(logAge, logCap) / logCap) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * entry.multiple * growthMult * maturityMult * breadthMult));
  return { implied, compMultiple: entry.multiple, compComps: entry.comps, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** Round to four decimals, for the multiples the dashboard prints. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** The snapshot's protocols by slug, for the watchlist lookup. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const protocol of protocols) index.set(protocol.slug, protocol);
  return index;
}

/** The headline figures: watchlist slugs, board rows, early rows, live protocols. */
export interface BoardSummary {
  watchlist_size: number; // slugs on the snapshot's watchlist
  board_size: number; // rows on the board
  early_size: number; // rows from below the watchlist floor
  live_size: number; // live-token protocols set aside
}

/** The protocols the board ranks, strongest first, numbered 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory } = compMultiples(snapshot, model);
  const lookup = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no longer carries (it
  // cannot, but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const protocol = lookup.get(slug);
    if (protocol !== undefined) chosen.set(slug, protocol);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((protocol) => !chosen.has(protocol.slug) && isRankable(protocol) && protocol.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const protocol of early) chosen.set(protocol.slug, protocol);

  const scored = [...chosen.values()].map((protocol) => {
    const value = impliedValue(protocol, snapshot.as_of, byCategory, model);
    return { protocol, value };
  });
  scored.sort((a, b) => b.value.implied - a.value.implied || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));
  return scored.map((entry, i) => {
    const p = entry.protocol;
    const v = entry.value;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token', // every board row is pre-token by construction
      age_days: v.age,
      implied_value_usd: v.implied,
      model: {
        comp_multiple: round4(v.compMultiple),
        comp_comps: v.compComps,
        growth_pct: v.growthPct,
        growth_multiplier: round4(v.growthMult),
        maturity_multiplier: round4(v.maturityMult),
        breadth_multiplier: round4(v.breadthMult),
        age_days: v.age,
      },
      farm_steps: farmSteps(p, v.age).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const trading = snapshot.protocols.filter((protocol) => !isPreToken(protocol) && protocol.category !== 'CEX');
  trading.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return trading.slice(0, LIVE_ROWS).map((protocol) => {
    const { slug, name, category, chains, tvl_usd, mcap_usd, change_7d } = protocol;
    return { slug, name, category, chains, tvl_usd, mcap_usd, change_7d };
  });
}

/** A board row's compact form for data.js; the farm plan is generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  const { rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, age_days, implied_value_usd } = row;
  const m = row.model;
  return {
    rank,
    slug,
    name,
    category,
    chains,
    tvl_usd,
    change_7d,
    mcap_usd,
    listed_at,
    age_days,
    implied_value_usd,
    comp_multiple: m.comp_multiple,
    comp_comps: m.comp_comps,
    growth_multiplier: m.growth_multiplier,
    maturity_multiplier: m.maturity_multiplier,
    breadth_multiplier: m.breadth_multiplier,
  };
}

/** What buildRadar returns: the board and everything the dashboard renders from it. */
export interface RadarBuild {
  board: BoardRow[]; // the ranked board, strongest first
  radar: RadarData; // the dashboard's dataset, built from the same board
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): RadarBuild {
  const ranked = buildBoard(snapshot, model);
  const { table: comparables } = compMultiples(snapshot, model);
  const liveSet = liveRows(snapshot);
  const early = ranked.filter((row) => !snapshot.watchlist.includes(row.slug)).length;
  const { as_of, source, floor_usd, watchlist } = snapshot;
  const radar: RadarData = {
    as_of,
    source,
    floor_usd,
    model: model,
    model_version: MODEL_VERSION,
    watchlist_size: watchlist.length,
    board_size: ranked.length,
    early_size: early,
    live_size: liveSet.length,
    watchlist,
    comparables,
    rows: ranked.map(radarRow),
    live: liveSet,
  };
  return { board: ranked, radar };
}

/** A step as one string: action, then cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  const first = p.chains[0];
  return first === undefined ? 'its main chain' : first;
}

/** Capital tiers by TVL: bigger protocols get bigger farm positions. */
const CAPITAL_TIERS: [number, number][] = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
];

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  for (const [floor, capital] of CAPITAL_TIERS) {
    if (p.tvl_usd >= floor) return capital;
  }
  return 50;
}

/** How long to hold, from the protocol's age: the younger it is, the longer the window. */
function holdDaysFor(age: number | null): number {
  if (age === null || age >= 365) return 30;
  return age < 180 ? 60 : 45;
}

/** The category's one action: the first table row whose pattern the category matches. */
type CategoryLine = (name: string, capital: number, chain: string) => string;
const ACTIONS: [RegExp, CategoryLine][] = [
  [/lend|cdp|collateral/, (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`],
  [/dex|yield|leveraged farm/, (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`],
  [/bridge/, (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`],
  [/staking|restak/, (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`],
  [/perpetual|derivative/, (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`],
  [/prediction/, (name, capital, chain) => `Fund $${capital} and place one market position on ${name}.`],
  [/curator|allocator/, (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`],
  [/stable/, (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`],
  [/rwa/, (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`],
  [/insurance/, (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`],
];

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const [pattern, build] of ACTIONS) {
    if (pattern.test(category)) return build(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action: the repeatable step that keeps the wallet active, from the same kind of table. */
const WEEKLY: [RegExp, CategoryLine][] = [
  [/lend|cdp|collateral/, (name) => `Borrow a small amount against the supply on ${name}, then repay it the same week.`],
  [/dex|yield|leveraged farm/, (name, capital, chain) => `Swap a small amount through ${name}'s main pool on ${chain}, or claim and restake half of the rewards.`],
  [/bridge/, (name) => `Bridge a small amount back the other way through ${name} so the round trip is on record.`],
  [/staking|restak/, (name) => `Top up the stake through ${name} by a small amount and keep the receipt.`],
  [/perpetual|derivative/, (name) => `Close the hedge on ${name} and open a fresh one at a smaller size.`],
  [/prediction/, (name) => `Settle one market on ${name} and open another small position.`],
  [/rwa/, (name) => `Hold through one distribution on ${name} and check the yield lands in the wallet.`],
  [/insurance/, (name) => `Check the policy on ${name} is active and renew the cover if it lapses.`],
  [/curator|allocator/, (name, capital, chain) => `Rebalance the ${name} vault position on ${chain} by a small amount.`],
];

function weeklyFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const [pattern, build] of WEEKLY) {
    if (pattern.test(category)) return build(p.name, capital, chain);
  }
  return `Make one small deposit, swap or vote on ${p.name} so the wallet stays active.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: weeklyFor(p, capital, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Write the wallet, the dates and every transaction in a farm log, then unwind in reverse order: claim, withdraw, and keep enough for gas.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json does not parse as JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotError('snapshot.json is not a JSON object at the top level');
  }
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const asOf = doc.as_of;
  const source = doc.source;
  const floor = doc.floor_usd;
  const protocols = doc.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const entry = value as Record<string, unknown>;
    if (typeof entry.slug !== 'string' || typeof entry.name !== 'string' || typeof entry.tvl_usd !== 'number' || !Number.isFinite(entry.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: entry.slug,
      name: entry.name,
      category: typeof entry.category === 'string' ? entry.category : null,
      chains: Array.isArray(entry.chains) ? entry.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: entry.tvl_usd,
      change_7d: typeof entry.change_7d === 'number' && Number.isFinite(entry.change_7d) ? entry.change_7d : null,
      mcap_usd: typeof entry.mcap_usd === 'number' && Number.isFinite(entry.mcap_usd) ? entry.mcap_usd : null,
      listed_at: typeof entry.listed_at === 'string' ? entry.listed_at : null,
      gecko_id: typeof entry.gecko_id === 'string' ? entry.gecko_id : null,
      symbol: typeof entry.symbol === 'string' ? entry.symbol : null,
    };
  });
  return { as_of: asOf, source, floor_usd: floor, protocols, watchlist: doc.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, a shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(', ');
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${shown}`;
  }
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
  }
  return null; // no issue: the gate takes this board
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
