/**
 * Canonical AEZ security universe.
 *
 * Tickers are IMMUTABLE canonical identifiers. The order of this list is the
 * "original ranking" from the assignment. Starting reference prices and
 * listing statuses are intentionally NOT present here: they must be imported
 * from the verified original dataset (see docs/DATA_IMPORT.md).
 */
export interface UniverseEntry {
  readonly rank: number;
  readonly ticker: string;
  readonly name: string;
}

export const STOCK_UNIVERSE: readonly UniverseEntry[] = Object.freeze([
  { rank: 1, ticker: 'JINK', name: 'Abhinav Jinka' },
  { rank: 2, ticker: 'TMAN', name: 'Til Kareht' },
  { rank: 3, ticker: 'ALI', name: 'Andrew Li' },
  { rank: 4, ticker: 'AMET', name: 'Aditya Mehta' },
  { rank: 5, ticker: 'NSJP', name: 'Neel Sijp' },
  { rank: 6, ticker: 'SRVSN', name: 'Aarya Srinivasan' },
  { rank: 7, ticker: 'BLPU', name: 'Abhinav Bellapu' },
  { rank: 8, ticker: 'BIJU', name: 'Gowri Biju' },
  { rank: 9, ticker: 'DOPP', name: 'Tanay Doppalapudi' },
  { rank: 10, ticker: 'SUVN', name: 'Suvan Kapoor' },
  { rank: 11, ticker: 'PARM', name: 'Arjun Parmar' },
  { rank: 12, ticker: 'ARYA', name: 'Arya Patel' },
  { rank: 13, ticker: 'SHVM', name: 'Shivm Patel' },
  { rank: 14, ticker: 'YADU', name: 'Yadukrishna Raghu' },
  { rank: 15, ticker: 'ARAT', name: 'Aaron Ratnavel' },
  { rank: 16, ticker: 'VIKR', name: 'Vikram Ravi' },
  { rank: 17, ticker: 'GANDH', name: 'Neel Gandhi' },
  { rank: 18, ticker: 'ATUL', name: 'Atul Kamath' },
  { rank: 19, ticker: 'AYAN', name: 'Ayan Kawlekar' },
  { rank: 20, ticker: 'LAU', name: 'Ethan Lau' },
  { rank: 21, ticker: 'STHAN', name: 'Srithan Meeniga' },
  { rank: 22, ticker: 'BABU', name: 'Mohith Ram Narendra Babu' },
  { rank: 23, ticker: 'RPAL', name: 'Reyansh Pallikonda' },
  { rank: 24, ticker: 'RKP', name: 'Rohin Prashanth' },
  { rank: 25, ticker: 'VRAN', name: 'Varun Rao' },
  { rank: 26, ticker: 'JAHM', name: 'Zahm Siyed' },
  { rank: 27, ticker: 'MUNCH', name: 'Laiq Sorrell' },
  { rank: 28, ticker: 'TEKK', name: 'Nidhish Tekkam' },
  { rank: 29, ticker: 'DVAL', name: 'Dhruv Vallurupalli' },
  { rank: 30, ticker: 'IPPAG', name: 'Aadi Agrawal' },
  { rank: 31, ticker: 'BOKKI', name: 'Neelesh Bokkisam' },
  { rank: 32, ticker: 'KAMT', name: 'Neil Kamath' },
  { rank: 33, ticker: 'MOOKIE', name: 'Abhinav Mukkamala' },
  { rank: 34, ticker: 'SNIG', name: 'Sreekar Nagulapalli' },
  { rank: 35, ticker: 'ASHAH', name: 'Aayush Shah' },
  { rank: 36, ticker: 'KANS', name: 'Kanishk Vankayala' },
  { rank: 37, ticker: 'KDUA', name: 'Kabir Dua' },
  { rank: 38, ticker: 'SSKGP', name: 'Siddarth Kasi' },
  { rank: 39, ticker: 'MOHNT', name: 'Adith Mohanty' },
  { rank: 40, ticker: 'PDAL', name: 'Samhith Padala' },
  { rank: 41, ticker: 'PRANS', name: 'Praneel Pantula' },
  { rank: 42, ticker: 'ZAIN', name: 'Zain Passi' },
  { rank: 43, ticker: 'REDY', name: 'Sebastian Reddy' },
  { rank: 44, ticker: 'STEP', name: 'Bartev Stepanian' },
  { rank: 45, ticker: 'JTOM', name: 'Joshua Thomas' },
] as const);

export const CANONICAL_TICKERS: ReadonlySet<string> = new Set(STOCK_UNIVERSE.map((s) => s.ticker));

/**
 * Historical assignment annotations. These are NOT trades, NOT guaranteed
 * returns and NOT substitutes for verified reference prices.
 * changeBps: basis points (1% = 100 bps).
 */
export interface HistoricalNote {
  readonly ticker: string;
  readonly changeBps: number;
  readonly note: string | null;
}

export const HISTORICAL_NOTES: readonly HistoricalNote[] = Object.freeze([
  { ticker: 'SUVN', changeBps: 200, note: 'USAA and Pacers interviews' },
  { ticker: 'SHVM', changeBps: 50, note: 'Consistent expected steady growth' },
  { ticker: 'GANDH', changeBps: 350, note: 'Citadel interview and Google prospects' },
  { ticker: 'STHAN', changeBps: 350, note: 'Clear View Proper beats expectations' },
  { ticker: 'BABU', changeBps: -950, note: 'NGC-related slump' },
  { ticker: 'RKP', changeBps: 250, note: null },
  { ticker: 'MUNCH', changeBps: -500, note: 'Humorous hunger-related incident' },
  { ticker: 'SNIG', changeBps: 650, note: 'Palantir investment outlook' },
] as const);
