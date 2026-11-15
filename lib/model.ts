// Token Radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every other rankable pre-token protocol below the watchlist floor: the early rows the radar
// exists to find. A protocol is pre-token when its index entry records no token (no market cap,
// no CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown as
// the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, the same function for every row:
//
//   base       = tvl_usd x BASE_MULTIPLE
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   chainsMult = 1 + 0.02 x min(max(chains - 1, 0), 10)
//   implied    = max(1, round(base x growthMult x maturityMult x chainsMult))
//
// TVL is the size of the economy that would back a token. Seven-day growth is momentum: a
// protocol gaining TVL is gaining the users a launch would reward. Maturity is how long it has
// run with no token: a protocol that has held billions for years without launching is a deeper
// backlog of value than one listed last month. Chains is reach: a protocol live on more chains
// serves more users and more wallets, so its eventual token has a wider holder base; the premium
// is small (at most 20%) so TVL still decides the order. No protocol name is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export type SnapshotProtocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

/** The whole snapshot document. */
export type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
};

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export type ModelConstants = {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chains_step: number;
  chains_cap: number;
};

const BASE = { base_multiple: 0.25, unknown_age_days: 365 };
const GROWTH = { growth_weight: 0.5, growth_floor: -60, growth_cap: 120 };
const MATURITY = { maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095 };
const CHAINS = { chains_step: 0.02, chains_cap: 10 };

export const MODEL: ModelConstants = { ...BASE, ...GROWTH, ...MATURITY, ...CHAINS };

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export type FarmStep = { text: string; cost: string; time: string };

/** One row of board.json: the ranked board's row. */
export type BoardRow = {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    age_days: number | null;
    chains_count: number;
    chains_multiplier: number;
    maturity_multiplier: number;
    growth_multiplier: number;
    growth_pct: number;
    base_multiple: number;
  };
  farm_steps: string[];
};

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export type RadarRow = {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chains_multiplier: number;
  watchlist: boolean;
};

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export type LiveRow = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
};

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export type RadarData = {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
};

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** `n` held inside [lo, hi]. */
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Only the named fields of an object, in the order given. */
const pick = <T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> =>
  keys.reduce((out, k) => ({ ...out, [k]: obj[k] }), {} as Pick<T, K>);

/** A finite number, else `fallback`. */
const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A finite number, else null. */
const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The strings of an unknown value, or an empty list. */
const stringList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter((c): c is string => typeof c === 'string');

/** A number to four decimals, for the model breakdown the board carries. */
const round4 = (n: number): number => {
  const scaled = n * 1e4;
  return Math.round(scaled) / 1e4;
};

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export const ageDays = (asOf: string, listedAt: string | null): number | null => {
  if (listedAt === null) return null;
  const [a, b] = [asOf, listedAt].map((d) => Date.parse(`${d}T00:00:00Z`));
  return a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b)
    ? Math.max(0, Math.floor((a - b) / DAY_MS))
    : null;
};

/** A protocol with its score: the implied value and every multiplier that made it. */
export type Scored = {
  p: SnapshotProtocol;
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainsMult: number;
  age: number | null;
};

/** The four multipliers and the implied value one protocol gets under `model`. */
export const impliedValue = (protocol: SnapshotProtocol, asOf: string, model: ModelConstants): Scored => {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const factors = [
    1 + (growthPct / 100) * model.growth_weight,
    model.maturity_floor +
      (clamp(age ?? model.unknown_age_days, 0, model.maturity_days) / model.maturity_days) * model.maturity_range,
    1 + model.chains_step * clamp(protocol.chains.length - 1, 0, model.chains_cap),
  ];
  const implied = Math.max(1, Math.round(factors.reduce((acc, f) => acc * f, protocol.tvl_usd * model.base_multiple)));
  return { p: protocol, implied, growthPct, growthMult: factors[0]!, maturityMult: factors[1]!, chainsMult: factors[2]!, age };
};

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** An exchange's name at the start of a protocol's name: the product of that exchange. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** A whole word that marks a wrapped, staked or bridged product of another protocol's token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A category that is a wrapped, staked or bridged product of another protocol, not a protocol of its own. */
const PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export const isPreToken = (p: SnapshotProtocol): boolean =>
  p.mcap_usd === null && p.gecko_id === null && p.symbol === null;

/** One of the five tests a rankable protocol must pass, from the field guide's own definition. */
const RANKABLE_CHECKS: Array<(p: SnapshotProtocol) => boolean> = [
  (p) => isPreToken(p),
  (p) => !PRODUCT_CATEGORY.has(p.category ?? ''),
  (p) => !VERSIONED.test(p.name),
  (p) => !EXCHANGE_PREFIX.test(p.name),
  (p) => !WRAPPED_WORD.test(p.name),
];

/**
 * Whether a protocol is one the board may rank: pre-token, and meeting the field guide's own
 * watchlist definition — not a wrapped, staked or bridged product of a token that already trades.
 * The guide's own examples: WBTC is Bitcoin on Ethereum and Binance staked ETH is ETH in Binance's
 * staking product, and neither is a protocol still waiting on a launch of its own. The watchlist is
 * the floor: the board is every protocol meeting this definition, at any size, not just the 40 above
 * the floor.
 */
export const isRankable = (p: SnapshotProtocol): boolean => RANKABLE_CHECKS.every((check) => check(p));

/** Strongest implied value first, ties broken by slug so the order is stable. */
const byScore = (a: Scored, b: Scored): number => {
  if (a.implied !== b.implied) return b.implied - a.implied;
  return a.p.slug < b.p.slug ? -1 : 1;
};

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export const buildBoard = (snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] => {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p] as const));
  const watch = new Set(snapshot.watchlist);
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record). The
  // early radar adds every rankable pre-token protocol below the watchlist floor, not just the
  // biggest few. A chosen protocol stays chosen; the floor is never the whole board.
  const chosen = [...snapshot.watchlist, ...snapshot.protocols.map((p) => p.slug)].reduce(
    (acc, slug) => {
      const p = index.get(slug);
      if (p === undefined || acc.has(slug)) return acc;
      if (!watch.has(slug) && !isRankable(p)) return acc;
      return acc.set(slug, p);
    },
    new Map<string, SnapshotProtocol>(),
  );
  return [...chosen.values()]
    .map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }))
    .sort(byScore)
    .map((s, i) => ({
      rank: i + 1,
      ...pick(s.p, ['slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol']),
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        age_days: s.age,
        chains_count: s.p.chains.length,
        chains_multiplier: round4(s.chainsMult),
        maturity_multiplier: round4(s.maturityMult),
        growth_multiplier: round4(s.growthMult),
        growth_pct: s.growthPct,
        base_multiple: model.base_multiple,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    }));
};

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export const stepText = (step: FarmStep): string => {
  const joined = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  return joined.length > 600
    ? `${joined.slice(0, 596)}...`
    : joined.length < 20
      ? `${joined} Hold the position and check the protocol's own page.`
      : joined;
};

/** A step from its three parts. */
const step = (text: string, cost: string, time: string): FarmStep => ({ text, cost, time });

/** The first chain a protocol names, or a neutral phrase. */
const chainOf = (p: SnapshotProtocol): string => p.chains[0] ?? 'its main chain';

/** How much capital one farm position needs, from the protocol's own TVL. */
const CAPITAL_TIERS: Array<readonly [number, number]> = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
];
const capitalFor = (p: SnapshotProtocol): number => CAPITAL_TIERS.find(([floor]) => p.tvl_usd >= floor)?.[1] ?? 50;

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
const HOLD_TIERS: Array<readonly [number, number]> = [
  [180, 60],
  [365, 45],
];
const holdDaysFor = (age: number | null): number =>
  age === null ? 30 : HOLD_TIERS.find(([max]) => age < max)?.[1] ?? 30;

/** One category rule: the words that match it, and the action it builds. */
type ActionRule = {
  keys: string[];
  build: (capital: number, name: string, chain: string) => string;
};

/** The category's one action, in the words a farmer can follow. */
const ACTION_RULES: ActionRule[] = [
  { keys: ['lend', 'cdp', 'collateral'], build: (capital, name, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.` },
  { keys: ['dex', 'yield', 'leveraged farm'], build: (capital, name, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
  { keys: ['bridge'], build: (capital, name, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.` },
  { keys: ['staking', 'restak'], build: (capital, name, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.` },
  { keys: ['perpetual', 'derivative'], build: (capital, name, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.` },
  { keys: ['prediction'], build: (capital, name) => `Fund $${capital} and place one market position on ${name}.` },
  { keys: ['curator', 'allocator'], build: (capital, name, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.` },
  { keys: ['stable'], build: (capital, name, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.` },
  { keys: ['rwa'], build: (capital, name, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.` },
  { keys: ['insurance'], build: (capital, name, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.` },
  { keys: ['basis'], build: (capital, name, chain) => `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the shares.` },
  { keys: ['chain'], build: (capital, name) => `Bridge $${capital} of USDC to ${name} and use its flagship apps every week.` },
];

const actionFor = (p: SnapshotProtocol, capital: number, chain: string): string => {
  const c = (p.category ?? '').toLowerCase();
  const rule = ACTION_RULES.find((r) => r.keys.some((k) => c.includes(k)));
  return rule === undefined
    ? `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`
    : rule.build(capital, p.name, chain);
};

/** One risk rule: the words that match it, and the warning it gives. */
type RiskRule = { keys: string[]; text: string };

/** The category's main risk, in the words a farmer can act on. */
const RISK_RULES: RiskRule[] = [
  { keys: ['dex', 'yield', 'leveraged farm'], text: 'Liquidity positions can lose value against simply holding the assets, so size the position so a 20% divergence still leaves you comfortable, and check the pool fee tier before you deposit.' },
  { keys: ['lend', 'cdp', 'perpetual', 'derivative'], text: 'Borrowed and leveraged positions can be liquidated in a sharp move, so keep the health factor above 2 and never borrow against the same collateral twice.' },
  { keys: ['bridge'], text: 'Bridges hold custody of your funds in transit, so move in two smaller transfers first and confirm the first lands before you send the second.' },
  { keys: ['staking', 'restak'], text: 'Staked assets can be slashed and take days to unstake, so keep a separate liquid reserve and note the unbonding period before you lock anything.' },
];

const riskFor = (p: SnapshotProtocol): string => {
  const c = (p.category ?? '').toLowerCase();
  return (
    RISK_RULES.find((r) => r.keys.some((k) => c.includes(k)))?.text ??
    'The protocol contracts are unaudited by you, so farm only with funds you can afford to lose and check whether audits are published before you deposit.'
  );
};

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export const farmSteps = (p: SnapshotProtocol, age: number | null): FarmStep[] => {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    step('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
    step(actionFor(p, capital, chain), `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'),
    step('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', 'about $2 of gas a week', '10 minutes a week'),
    step(`Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, `the $${capital} stays in the position`, `${hold} days`),
    step("Open the protocol's own points or rewards page and claim only from a link it publishes, and verify every contract address from its official docs first.", 'no fee to check, and never pay to claim', '10 minutes'),
    step(riskFor(p), 'nothing but the discipline', '5 minutes to check'),
    step('Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes'),
    step('Unwind in stages when a token is announced, and do not chase the launch price: the farm was the position, not the first candle.', 'about $4 of gas to exit', '15 minutes to exit'),
  ];
};

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export const liveRows = (snapshot: Snapshot): LiveRow[] => {
  const byValue = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
    (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd;
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(byValue)
    .slice(0, LIVE_ROWS)
    .map((p) => pick(p, ['slug', 'name', 'category', 'chains', 'tvl_usd', 'mcap_usd', 'change_7d']));
};

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export const radarRow = (row: BoardRow, watchlist: Set<string>): RadarRow => ({
  ...pick(row, ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'age_days', 'implied_value_usd']),
  growth_multiplier: row.model.growth_multiplier,
  maturity_multiplier: row.model.maturity_multiplier,
  chains_multiplier: row.model.chains_multiplier,
  watchlist: watchlist.has(row.slug),
});

/** Everything the dashboard renders, from the snapshot. */
export const buildRadar = (snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } => {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.reduce((n, r) => n + (watch.has(r.slug) ? 0 : 1), 0);
  const radar: RadarData = {
    live,
    rows: board.map((r) => radarRow(r, watch)),
    live_size: live.length,
    early_size: early,
    board_size: board.length,
    watchlist_size: snapshot.watchlist.length,
    model_version: MODEL_VERSION,
    model,
    floor_usd: snapshot.floor_usd,
    source: snapshot.source,
    as_of: snapshot.as_of,
  };
  return { board, radar };
};

/** A fatal snapshot problem: the message the program reports and the exit it takes.
 * Every refusal below goes through this one throw so the message stays the program's own. */
const badSnapshot = (message: string): never => {
  throw new SnapshotError(message);
};

/** One protocol out of the snapshot's raw record, refused unless it carries a slug, a name and a TVL. */
const parseProtocol = (v: unknown, i: number): SnapshotProtocol => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    badSnapshot(`snapshot.json's protocol ${i} is not an object`);
  }
  const p = v as Record<string, unknown>;
  const valid = typeof p.slug === 'string' && typeof p.name === 'string' && typeof p.tvl_usd === 'number' && Number.isFinite(p.tvl_usd);
  if (!valid) badSnapshot(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  return {
    ...pick(p, ['slug', 'name']),
    category: typeof p.category === 'string' ? p.category : null,
    chains: stringList(p.chains),
    tvl_usd: p.tvl_usd as number,
    change_7d: finiteOrNull(p.change_7d),
    mcap_usd: finiteOrNull(p.mcap_usd),
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
};

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export const parseSnapshot = (text: string): Snapshot => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    badSnapshot('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) badSnapshot('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  const asOf = typeof o.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.as_of) ? o.as_of : badSnapshot('snapshot.json has no as_of date');
  const source = typeof o.source === 'string' ? o.source : badSnapshot('snapshot.json has no source');
  const floor = typeof o.floor_usd === 'number' && Number.isSafeInteger(o.floor_usd) && o.floor_usd > 0 ? o.floor_usd : badSnapshot('snapshot.json has no floor_usd');
  const protocols = Array.isArray(o.protocols) ? o.protocols.map(parseProtocol) : badSnapshot('snapshot.json has no protocols array');
  const watchlist =
    Array.isArray(o.watchlist) && o.watchlist.every((s) => typeof s === 'string')
      ? (o.watchlist as string[])
      : badSnapshot('snapshot.json has no watchlist of slugs');
  return { as_of: asOf, source, floor_usd: floor, protocols, watchlist };
};

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export const boardIssue = (board: BoardRow[], snapshot: Snapshot): string | null => {
  const slugs = new Set(board.map((r) => r.slug));
  const checks: Array<() => string | null> = [
    () => {
      const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
      return missing.length > 0 ? `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}` : null;
    },
    () => {
      const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
      const bad = ranks.findIndex((rank, i) => rank !== i + 1);
      return bad < 0 ? null : `rank ${bad + 1} is ${ranks[bad]}`;
    },
    () => {
      const out = board.findIndex((r, i) => i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd);
      return out < 0 ? null : `row ${out + 1} outranks row ${out} on implied value`;
    },
    () =>
      board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd
        ? `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`
        : null,
    () => {
      const badRow = board.find((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12);
      if (badRow !== undefined) return `${badRow.slug} has ${badRow.farm_steps.length} farm steps`;
      const badStep = board.find((r) => r.farm_steps.some((s) => s.length < 20 || s.length > 600));
      if (badStep !== undefined) {
        const s = badStep.farm_steps.find((x) => x.length < 20 || x.length > 600)!;
        return `${badStep.slug} has a farm step of ${s.length} characters`;
      }
      const badValue = board.find((r) => !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0);
      return badValue === undefined ? null : `${badValue.slug} has implied value ${badValue.implied_value_usd}`;
    },
  ];
  for (const check of checks) {
    const issue = check();
    if (issue !== null) return issue;
  }
  return null;
};

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export const dataScript = (radar: RadarData): string => `window.RADAR=${JSON.stringify(radar)};\n`;
