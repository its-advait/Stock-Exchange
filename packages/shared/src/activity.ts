/**
 * "Active Rankings" — the pledge class's activity ranking of every brother,
 * transcribed from the Active Rankings document (rank, the count in brackets,
 * and the write-up, verbatim).
 *
 * This is reference CONTENT, not market data. It is used for two things:
 *   1. the "Active Rankings" panel on each brother's page;
 *   2. the SIMULATED starting reference price chosen by the history generator
 *      (`simulatedPriceFromActivity`). Those prices are labeled SIMULATED
 *      everywhere and never replace a verified original price.
 */
export interface ActivityEntry {
  readonly activityRank: number;
  readonly ticker: string;
  readonly title: string;
  /** The number in brackets in the document (ListServ email count). */
  readonly emailCount: number;
  readonly writeup: string;
}

export const ACTIVE_RANKINGS_SOURCE = 'Active Rankings (pledge class document)';

export const ACTIVE_RANKINGS: readonly ActivityEntry[] = Object.freeze([
  { activityRank: 1, ticker: 'ALI', title: 'Mr.', emailCount: 587, writeup: 'His email count being more than double that of the next person speaks for itself. He’s extremely active on ListServ and is always following up on assignments and deadlines. Doesn’t ask for an abnormal amount of food runs or cleanings, though, but the email counts are too high for him not to be 1.' },
  { activityRank: 2, ticker: 'AMET', title: 'Mr.', emailCount: 254, writeup: 'Mostly sends emails to follow up on assignments or deadlines we’ve missed. Does ask for a good amount of food and item runs, along with cleanings. Cleanings and food runs happen constantly; therefore is #2.' },
  { activityRank: 3, ticker: 'JINK', title: 'Mr.', emailCount: 342, writeup: 'Extremely active on email threads, constantly giving us assignments and following up on deadlines, also at every event. Doesn’t really ask for much in terms of food runs or cleanings, though, but all added up, he’s still #3.' },
  { activityRank: 4, ticker: 'SRVSN', title: 'Mr.', emailCount: 178, writeup: 'Extremely active on ListServ and is at pretty much every event we’ve had so far. Doesn’t ask for many food runs or cleanings, though.' },
  { activityRank: 5, ticker: 'SHVM', title: 'Mr.', emailCount: 144, writeup: 'Extremely active as our PCO. He’s at most events, mainly to protect us, and asks for a couple of food runs every week. Also gives us some of the most important assignments.' },
  { activityRank: 6, ticker: 'SNIG', title: 'President', emailCount: 245, writeup: 'Assigns a good amount of tasks through ListServ, but isn’t too active in person or in group chats. The PC also spent a pretty crazy amount of time getting his backyard ready for the Diwali party. All in all, this places him #6.' },
  { activityRank: 7, ticker: 'GANDH', title: 'Mr.', emailCount: 78, writeup: 'The amount of Monsoon food he asks for could break world records. He’s not super active on ListServ, but the food runs alone are enough to put him pretty high.' },
  { activityRank: 8, ticker: 'VIKR', title: 'Mr.', emailCount: 98, writeup: 'Had some pretty demanding private assignments with Namith and Arjun that put him pretty high. Doesn’t ask for too many food runs, but gives us important assignments and a good amount of cleanings.' },
  { activityRank: 9, ticker: 'RKP', title: 'Mr.', emailCount: 64, writeup: 'Has given us a good amount of house cleanings and food runs. Also sends a few ListServ assignments, some of which are pretty important or traditional. His house cleanings usually take a good amount of time.' },
  { activityRank: 10, ticker: 'ATUL', title: 'Mr.', emailCount: 108, writeup: 'Has us doing a lot of cleanings and Chipotle runs. Isn’t too active on ListServ but is pretty prominent in some group chats. Also has a lot of closet time and calls people over at random hours of the night.' },
  { activityRank: 11, ticker: 'MUNCH', title: 'Mr.', emailCount: 41, writeup: 'Mostly assigns punishments and occasionally has private events. Doesn’t really ask for much outside of that.' },
  { activityRank: 12, ticker: 'ARYA', title: 'Mr.', emailCount: 12, writeup: 'Doesn’t really assign anything through ListServ or group chats, but he gives us our pledge tasks and mems after every meeting, which are very important and therefore should be higher on the list.' },
  { activityRank: 13, ticker: 'BIJU', title: 'Mr.', emailCount: 28, writeup: 'Doesn’t send too many emails, but the professional assignments he gives us are pretty demanding. He genuinely cares about the work and wants us to put effort into it. Also asks for a couple of food runs here and there.' },
  { activityRank: 14, ticker: 'LAU', title: 'Mr.', emailCount: 85, writeup: 'Loves his events and is always sitting in the front row during meetings. Not too active on ListServ, but he’s somewhat active in group chats and hops on every once in a while.' },
  { activityRank: 15, ticker: 'AYAN', title: 'Mr.', emailCount: 76, writeup: 'Asks for a couple of food items and runs here and there. He’s also assigned some pretty time-consuming punishments.' },
  { activityRank: 16, ticker: 'JAHM', title: 'Mr.', emailCount: 33, writeup: 'More active over text than email. Asks for personal help here and there, including having us bartend at parties and do his grocery shopping.' },
  { activityRank: 17, ticker: 'STHAN', title: 'Mr.', emailCount: 34, writeup: 'Pretty similar to Mr. Kamath. Doesn’t send too many emails but randomly asks people to come over to his house at all hours of the night. Also has a good amount of food runs.' },
  { activityRank: 18, ticker: 'TEKK', title: 'Mr.', emailCount: 34, writeup: 'Has us doing a couple of food and item runs here and there, but nothing too crazy. He’s active in group chats and sometimes decides to hop on ListServ.' },
  { activityRank: 19, ticker: 'SUVN', title: 'Mr.', emailCount: 51, writeup: 'Rarely sends emails, rarely asks for food runs, and doesn’t assign us too much work overall.' },
  { activityRank: 20, ticker: 'ZAIN', title: 'Mr.', emailCount: 4, writeup: 'Pretty inactive in group chats and on ListServ, but Namith has been doing his laundry for like five weeks straight.' },
  { activityRank: 21, ticker: 'KDUA', title: 'Mr.', emailCount: 29, writeup: 'Pretty much only assigns TikToks and the occasional food run. Overall, pretty chill.' },
  { activityRank: 22, ticker: 'NSJP', title: 'Mr.', emailCount: 70, writeup: 'Has a higher email count but doesn’t ask for much in terms of food runs or cleanings. Pretty laid-back overall and more active in group chats. Mostly the occasional "WHERE".' },
  { activityRank: 23, ticker: 'YADU', title: 'Mr.', emailCount: 14, writeup: 'Not too active on ListServ but asks for the occasional food and cig runs. Did run his Yummies event on us, though, which was a pretty big assignment.' },
  { activityRank: 24, ticker: 'BABU', title: 'Mr.', emailCount: 21, writeup: 'Hops on email threads and group chats every once in a while and has shown up to a couple of events. Doesn’t really ask for much, though. Did give Anthony the gym routine.' },
  { activityRank: 25, ticker: 'KANS', title: 'Mr.', emailCount: 18, writeup: 'Shows up to meetings but doesn’t do too much in terms of emails or cleanings. Asks for food and runs here and there.' },
  { activityRank: 26, ticker: 'ARAT', title: 'Mr.', emailCount: 16, writeup: 'Pretty inactive on both ListServ and group chats. Mostly just asks for TikToks and occasionally assigns punishments.' },
  { activityRank: 27, ticker: 'IPPAG', title: 'Immediate Past President', emailCount: 12, writeup: 'Doesn’t really ask for much. We’ve cleaned his house once and done the occasional food run.' },
  { activityRank: 28, ticker: 'DOPP', title: 'Mr.', emailCount: 10, writeup: 'Doesn’t send many tasks through ListServ or group chats. Mostly asks for IM-related stuff like edits and filming, along with the occasional food run.' },
  { activityRank: 29, ticker: 'PARM', title: 'Mr.', emailCount: 8, writeup: 'Pretty inactive on ListServ and group chats, but somehow asks for a good amount of food runs.' },
  { activityRank: 30, ticker: 'PDAL', title: 'Mr.', emailCount: 0, writeup: 'Not active on ListServ and rarely texts, but is extremely nice in person. Has asked for a few things privately, such as a house and car cleaning.' },
  { activityRank: 31, ticker: 'DVAL', title: 'Mr.', emailCount: 0, writeup: 'Doesn’t send any emails but asks for the occasional food run. No house cleanings or anything crazy. Namith also gets his attendance code every Tuesday.' },
  { activityRank: 32, ticker: 'BLPU', title: 'Mr.', emailCount: 4, writeup: 'Sends a few emails and asks for food runs occasionally. Nothing too crazy.' },
  { activityRank: 33, ticker: 'VRAN', title: 'Mr.', emailCount: 4, writeup: 'Rarely asks for anything. We’ve done a couple of food runs for him, but that’s pretty much it.' },
  { activityRank: 34, ticker: 'TMAN', title: 'Mr.', emailCount: 4, writeup: 'Came to the hike and sent a few emails. No food runs or house cleanings, though.' },
  { activityRank: 35, ticker: 'JTOM', title: 'Mr.', emailCount: 9, writeup: 'Doesn’t send many ListServ assignments but occasionally asks for a house cleaning, item run, or some random miscellaneous task.' },
  { activityRank: 36, ticker: 'PRANS', title: 'Mr.', emailCount: 9, writeup: 'The only thing he’s asked us to do so far is one food run.' },
  { activityRank: 37, ticker: 'RPAL', title: 'Mr.', emailCount: 1, writeup: 'We’ve cleaned his house once, but that’s pretty much it.' },
  { activityRank: 38, ticker: 'SSKGP', title: 'Mr.', emailCount: 0, writeup: 'Zero emails and rarely texts, but somehow asks us what his full name is almost every time we see him.' },
  { activityRank: 39, ticker: 'STEP', title: 'Mr.', emailCount: 0, writeup: 'Doesn’t really text or send emails, but he shows up to meetings and talks to everyone.' },
  { activityRank: 40, ticker: 'MOOKIE', title: 'Mr.', emailCount: 0, writeup: 'Showed up to one event and used that time to make sure we got to know our PBros better. Also gave out the My Singing Monsters task in a group chat.' },
  { activityRank: 41, ticker: 'BOKKI', title: 'Mr.', emailCount: 0, writeup: 'Zero emails and rarely texts.' },
  { activityRank: 42, ticker: 'KAMT', title: 'Mr.', emailCount: 0, writeup: 'Zero emails and rarely texts.' },
  { activityRank: 43, ticker: 'ASHAH', title: 'Mr.', emailCount: 0, writeup: 'Zero emails and rarely texts.' },
  { activityRank: 44, ticker: 'MOHNT', title: 'Mr.', emailCount: 0, writeup: 'Zero emails and rarely texts.' },
  { activityRank: 45, ticker: 'REDY', title: 'Mr.', emailCount: 0, writeup: 'Zero emails and rarely texts.' },
] as const);

export const ACTIVITY_BY_TICKER: ReadonlyMap<string, ActivityEntry> = new Map(ACTIVE_RANKINGS.map((a) => [a.ticker, a]));

const MAX_EMAILS = Math.max(...ACTIVE_RANKINGS.map((a) => a.emailCount));

/**
 * Activity score in [0, 1]: 60% from the ranking position, 40% from the email
 * count (log-scaled, so 587 vs 342 matters less than 10 vs 0).
 */
export function activityScore(a: Pick<ActivityEntry, 'activityRank' | 'emailCount'>): number {
  const n = ACTIVE_RANKINGS.length;
  const rankPart = (n + 1 - a.activityRank) / n;
  const emailPart = Math.log1p(a.emailCount) / Math.log1p(MAX_EMAILS);
  return 0.6 * rankPart + 0.4 * emailPart;
}

/** SIMULATED starting price in cents: $8.00 + score × $52.00, rounded to 5¢. Range ≈ $8.70 – $60.00. */
export function simulatedPriceFromActivity(a: Pick<ActivityEntry, 'activityRank' | 'emailCount'>): number {
  const cents = 800 + activityScore(a) * 5200;
  return Math.round(cents / 5) * 5;
}
