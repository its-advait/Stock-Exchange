/**
 * Fictional, parody-only editorial content for the AEZ Stock Exchange.
 *
 * Everything here is a humorous, business-style framing of the context supplied
 * with the assignment (ticker notes and headline ideas). None of it is a real-world
 * claim about anyone, it contains no contact or private details, and it is always
 * displayed with a "Fictional" / "Parody" label. It never affects prices.
 */
import { STOCK_UNIVERSE } from './universe.js';

export const PARODY_LABEL = 'Fictional AEZ Market News';

export interface BrotherProfile {
  ticker: string;
  /** Fictional sector, for flavor only. */
  sector: string;
  /** One-line fictional "company description". */
  tagline: string;
  /** Short fictional business-style profile. */
  profile: string;
}

const TAILORED: Record<string, Omit<BrotherProfile, 'ticker'>> = {
  JINK: {
    sector: 'Event-Driven Volatility',
    tagline: 'A high-beta assignment-cycle play.',
    profile:
      'JINK trades on the assignment calendar. Analysts model sharp moves around each new announcement and recommend investors keep a seatbelt fastened through deadline season.',
  },
  ALI: {
    sector: 'Communications Infrastructure',
    tagline: 'Industry-leading outbound email throughput.',
    profile:
      'ALI operates one of the most active inboxes on the exchange. Bulls point to record message volume as a leading indicator of productivity; bears note that nobody has audited the reply rate.',
  },
  AMET: {
    sector: 'Turnaround & Restructuring',
    tagline: 'A perennial management-intervention story.',
    profile:
      'AMET carries a well-documented assignment backlog that periodically triggers board-level intervention. Each restructuring round is priced in by the market roughly twelve hours before the deadline.',
  },
  SUVN: {
    sector: 'Financial Services & Sports',
    tagline: 'Diversified across insurance and basketball.',
    profile:
      'SUVN is a rare cross-sector name with exposure to both financial services and professional sports, following interview cycles the AEZ desk describes as "bullish, with a jump shot."',
  },
  SHVM: {
    sector: 'Defensive Compounder',
    tagline: 'Steady growth. Quarter after quarter.',
    profile:
      'SHVM is the exchange’s low-volatility blue chip. Management guides to consistent, expected growth and then, somewhat boringly, delivers it.',
  },
  GANDH: {
    sector: 'Quantitative Finance & Big Tech',
    tagline: 'Optionality on two career paths at once.',
    profile:
      'GANDH holds call options on both trading-floor and big-tech outcomes after a closely watched interview cycle. Analysts call it the exchange’s purest momentum name.',
  },
  STHAN: {
    sector: 'Consumer Services',
    tagline: 'Clear View Proper, executed properly.',
    profile:
      'STHAN’s Clear View Proper division continues to beat expectations. Guidance remains clear, the view remains proper, and the margins remain unexplained.',
  },
  BABU: {
    sector: 'Cyclicals',
    tagline: 'Deep value, or a value trap. Discuss.',
    profile:
      'BABU is navigating NGC-related headwinds that weighed on recent sentiment. Contrarians argue the slump is fully priced in; everyone else is waiting for the next earnings call.',
  },
  RKP: {
    sector: 'Undisclosed',
    tagline: 'The market moved. Nobody wrote down why.',
    profile:
      'RKP posted a historical gain with no accompanying note, making it the exchange’s most mysterious ticker. Analysts have stopped asking and started buying.',
  },
  MUNCH: {
    sector: 'Consumer Staples (Snacks)',
    tagline: 'Unprecedented demand. Concerning margins.',
    profile:
      'MUNCH is the exchange’s food-demand bellwether. Consumption has reached levels that raise legitimate questions about operating margins and the pantry’s supply chain.',
  },
  SNIG: {
    sector: 'Data & Defense Analytics',
    tagline: 'Long the Palantir thesis.',
    profile:
      'SNIG’s investment outlook is anchored by a widely discussed Palantir position. The stock trades as a leveraged proxy for conviction, which management describes as "extremely high."',
  },
};

const GENERIC_SECTORS = [
  'Diversified Brotherhood',
  'Late-Night Productivity',
  'Group Project Logistics',
  'Campus Real Estate',
  'Social Infrastructure',
  'Caffeine & Energy',
  'Strategic Procrastination',
  'Intramural Athletics',
  'Event Planning Services',
];

const GENERIC_TAGLINES = [
  'An under-covered name awaiting its first analyst note.',
  'Fundamentals pending. Vibes priced in.',
  'Quietly compounding while nobody is watching.',
  'A founding-class listing with untested upside.',
  'The market’s best-kept secret, according to its own investor relations.',
];

function genericProfile(ticker: string, rank: number): Omit<BrotherProfile, 'ticker'> {
  return {
    sector: GENERIC_SECTORS[(rank * 7) % GENERIC_SECTORS.length]!,
    tagline: GENERIC_TAGLINES[(rank * 3) % GENERIC_TAGLINES.length]!,
    profile: `${ticker} listed on the AEZ Exchange at original rank #${rank}. The company has filed no fictional earnings guidance yet, so the order book is the only source of truth. Price discovery is, as they say, a group project.`,
  };
}

export const BROTHER_PROFILES: Readonly<Record<string, BrotherProfile>> = Object.freeze(
  Object.fromEntries(
    STOCK_UNIVERSE.map((s) => [s.ticker, { ticker: s.ticker, ...(TAILORED[s.ticker] ?? genericProfile(s.ticker, s.rank)) }]),
  ),
);

export interface SeedNewsStory {
  seedKey: string;
  ticker: string;
  headline: string;
  body: string;
}

/** Default fictional stories, seeded idempotently. Admins can add more through the admin API. */
export const SEED_NEWS: readonly SeedNewsStory[] = Object.freeze([
  {
    seedKey: 'v1-gandh',
    ticker: 'GANDH',
    headline: 'Citadel Interview Sends Investor Confidence Higher',
    body: 'Sources close to the AEZ trading floor report elevated optimism around GANDH after an interview cycle that the AEZ desk describes as "very quant." Analysts caution that confidence is not a cash flow.',
  },
  {
    seedKey: 'v1-snig',
    ticker: 'SNIG',
    headline: 'Palantir Outlook Sparks Bullish Sentiment',
    body: 'SNIG’s long-held Palantir thesis continues to drive chatter. One fictional strategist summarized the setup as "high conviction, higher volume, highest number of times mentioned at dinner."',
  },
  {
    seedKey: 'v1-babu',
    ticker: 'BABU',
    headline: 'NGC Headwinds Pressure Investor Confidence',
    body: 'BABU faces ongoing NGC-related headwinds. Contrarian investors are circling, while the rest of the market waits for management to schedule a fictional earnings call.',
  },
  {
    seedKey: 'v1-shvm',
    ticker: 'SHVM',
    headline: 'PCO Announces Another Quarter of Steady Growth',
    body: 'In a development surprising no one, SHVM delivered another quarter of consistent, expected growth. Volatility traders have filed a formal complaint about the lack of excitement.',
  },
  {
    seedKey: 'v1-munch',
    ticker: 'MUNCH',
    headline: 'Unprecedented Food Demand Raises Questions About Operating Margins',
    body: 'MUNCH reported consumption figures well above consensus. The AEZ desk is investigating whether the pantry can sustain this run rate through finals week.',
  },
  {
    seedKey: 'v1-ali',
    ticker: 'ALI',
    headline: 'Record Email Volume Drives Productivity Expectations',
    body: 'ALI’s outbound message volume hit a fictional all-time high this week. Analysts expect productivity to follow, pending confirmation that any of the emails were answered.',
  },
  {
    seedKey: 'v1-amet',
    ticker: 'AMET',
    headline: 'Assignment Backlog Fuels Another Round of Management Intervention',
    body: 'AMET’s board convened an emergency session over a growing assignment backlog. Restructuring is expected to conclude shortly before the deadline, as is tradition.',
  },
  {
    seedKey: 'v1-jink',
    ticker: 'JINK',
    headline: 'Analysts Predict Increased Volatility Following New Assignment Announcement',
    body: 'Options desks are pricing elevated volatility for JINK after a new assignment was announced. Traders are advised to manage risk and, ideally, start early.',
  },
  {
    seedKey: 'v1-sthan',
    ticker: 'STHAN',
    headline: 'Clear View Proper Performance Exceeds Expectations',
    body: 'STHAN’s Clear View Proper unit beat expectations again. The fictional consensus estimate has been revised upward, then revised upward again for good measure.',
  },
  {
    seedKey: 'v1-suvn',
    ticker: 'SUVN',
    headline: 'USAA and Pacers Interviews Lift Bullish Outlook',
    body: 'SUVN’s dual exposure to insurance and basketball lifted sentiment following a busy interview cycle. Analysts upgraded the stock to "Strong Buy, Nothing But Net."',
  },
]);
