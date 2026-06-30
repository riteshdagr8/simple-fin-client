// Default keyword rules for the auto-categorizer.
// Each rule maps a keyword phrase to a category. The rules engine does
// case-insensitive word-boundary matching against the transaction description.
//
// This list is the single source of truth — server/routes/auth.js (used during
// registration) and server/routes/categories.js (used by the manual "Seed
// categories" button) both import it. Adding a merchant here will populate
// it for new users and any user that re-seeds.
//
// Each keyword list is also deduplicated at the array level so we don't
// insert the same rule twice for the same user.

const RULES = [
  { category: 'Groceries', keywords: [
    'LOBLAWS', 'SOBEYS', 'METRO', 'FOOD BASICS', 'FRESHCO', 'LONGOS', 'FORTINOS',
    'FARM BOY', 'NATURAL GROCERS', 'COSTCO WHOLESALE', 'WHOLE FOODS', 'TRADER JOES',
    'SUPERSTORE', 'REAL CANADIAN', 'NO FRILLS', 'PROVIGO', 'IGA', 'MAXI', 'MARCHE',
    'VALU MART', 'FOODLAND', 'GIANT TIGER', 'WALMART GROCERY', 'WALMART SUPERC',
  ]},
  { category: 'Dining', keywords: [
    'STARBUCKS', 'TIM HORTONS', 'TIM HORTON', 'MCDONALD', 'SUBWAY', 'A&W', 'HARVEY',
    'SWISS CHALET', 'PIZZA HUT', 'DOMINOS', 'DOORDASH', 'UBER EATS', 'SKIP THE DISHES',
    'SKIP THE DISH', 'GRUBHUB', 'POPEYES', 'WENDY', 'BURGER KING', 'KFC',
    'TACO BELL', 'FATBURGER', 'PANDA EXPRESS', 'PHO', 'SUSHI', 'RESTAURANT',
    'CAFÉ', 'COFFEE', 'COFFEE SHOP',
  ]},
  { category: 'Insurance', keywords: [
    'INTACT', 'AVIVA', 'DESJARDINS', 'STATE FARM', 'ALLSTATE', 'GEICO', 'PROGRESSIVE',
    'LIBERTY MUTUAL', 'NATIONWIDE', 'USAA', 'FARMERS', 'INSURANCE', 'HOME INSURANCE',
    'AUTO INSURANCE', 'LIFE INSURANCE', 'HEALTH INSURANCE', 'RBC INSURANCE',
    'TD INSURANCE', 'WAWANESA',
  ]},
  { category: 'Gas/Auto', keywords: [
    'SHELL', 'ESSO', 'PETRO-CANADA', 'PETRO CANADA', 'SUNOCO', 'HUSKY', 'COSTCO GAS',
    'CANADIAN TIRE GAS', 'MR. LUBE', 'MR LUBE', 'JIFFY LUBE', 'MIDAS',
    'CANADIAN TIRE GASOLINE', 'KAL TIRE', 'CALTAIRE', 'VALVOLINE', 'OIL CHANGE',
    'TIRE', 'WHEEL', 'AUTO', 'CAR WASH', 'SERVICE GAS',
  ]},
  { category: 'Shopping', keywords: [
    'AMAZON', 'WALMART', 'BEST BUY', 'IKEA', 'WINNERS', 'MARSHALLS', 'HOMESENSE',
    'HOME DEPOT', 'LOWES', 'HOME HARDWARE', 'RONA', 'CANADIAN TIRE', 'THE BAY',
    'HBC', 'NORDSTROM', 'SEPHORA', 'STAPLES', 'DOLLARAMA', 'DOLLAR TREE',
    'SHOPPERS DRUG MART', 'PHARMASAVE', 'SHOES', 'CLOTHING',
  ]},
  { category: 'Entertainment', keywords: [
    'NETFLIX', 'SPOTIFY', 'DISNEY PLUS', 'DISNEY+', 'CRAPPLE MUSIC', 'APPLE MUSIC',
    'YOUTUBE', 'STEAM', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'GOG.COM', 'EPIC GAMES',
    'HULU', 'AMAZON PRIME', 'AMCR+', 'CRUNCHYROLL', 'APPLE TV', 'BELL MEDIA',
    'ROGERS MEDIA', 'CINEMA', 'MOVIE', 'THEATRE', 'AMC', 'CINEPLEX', 'TIKTOK',
    'TWITCH', 'AMAZON PRIME VIDEO',
  ]},
  { category: 'Travel', keywords: [
    'AIR CANADA', 'WESTJET', 'PORTER', 'FLAIR', 'SUNWING', 'TRANSCAFTA',
    'AIR TRANSAT', 'VIA RAIL', 'GO TRANSIT', 'MARQUIS', 'MARRIOTT', 'HILTON',
    'HYATT', 'ACCOR', 'IHG', 'BEST WESTERN', 'AIRBNB', 'BOOKING.COM', 'EXPEDIA',
    'TRIPADVISOR', 'BUSBUD', 'RENTAL', 'TOLL', 'PARKING', 'AIRPORT', 'LOUNGE',
    'HOTEL', 'MOTEL', 'INN', 'YOUTH HOSTEL',
  ]},
  { category: 'Education', keywords: [
    'UNIVERSITY', 'COLLEGE', 'TUITION', 'SCHOOL', 'COURSERA', 'UDEMY', 'LYNDA',
    'PLURALSIGHT', 'LEARNER', 'EDUCATION', 'SCHOLARSHIP', 'STUDENT LOAN', 'BOOKS',
    'CANVAS', 'BLACKBOARD', 'MYCLASS', 'WILFRID LAURIER', 'UNIVERSITY OF TORONTO',
    'RYERSON', 'TMU', 'YORK UNIVERSITY', 'SENeca',
  ]},
  { category: 'Utilities', keywords: [
    'BELL CANADA', 'ROGERS', 'TELUS', 'SHAW', 'FIDO', 'KOODO', 'FREEDOM MOBILE',
    'TELUS MOBILITY', 'ROGERS WIRELESS', 'TELUS MOBILE', 'TELUS INTERNET',
    'ROGERS INTERNET', 'BELL MOBILITY', 'BELL MTS', 'FREEDOM', 'HYDRO',
    'HYDRO QUEBEC', 'HYDRO OTTAWA', 'HYDRO ONE', 'ENBRIDGE', 'ENMAX', 'ATCO',
    'FORTIS', 'TRANSALTA', 'BC HYDRO', 'ONTARIO HYDRO', 'OVO', 'ENBRIDGE GAS',
    'ENBRIDGE GAS INC', 'ROGERS COMMUNICATIONS', 'SHAW COMMUNICATIONS',
  ]},
  { category: 'Tax/Fee', keywords: [
    'CRA', 'GOVERNMENT OF CANADA', 'GOVERNMENT OF ONTARIO', 'GOVERNMENT OF QUEBEC',
    'GOVERNMENT OF BRITISH COLUMBIA', 'REVENUE', 'TAX', 'FEE', 'PENALTY',
    'SERVICE CHARGE', 'ADMIN FEE', 'MAINTENANCE FEE', 'MONTHLY FEE', 'ACCOUNT FEE',
    'TRANSACTION FEE', 'TAX REFUND', 'PROPERTY TAX', 'INCOME TAX',
  ]},
  { category: 'Healthcare', keywords: [
    'SHOPPERS DRUG MART', 'REXALL', 'PHARMASAVE', 'JEAN COUTU', 'BRUNET', 'UNIPRIX',
    'DOCTOR', 'PHYSICIAN', 'HOSPITAL', 'DENTAL', 'DENTIST', 'VISION', 'EYEGLASSES',
    'OPTOMETRIST', 'OPTICIAN', 'CHIROPRACTOR', 'MASSAGE THERAPY', 'PHYSIOTHERAPY',
    'MENTAL HEALTH', 'PSYCHOLOGIST', 'PSYCHIATRIST', 'CLINIC', 'MEDICAL', 'LAB',
    'IMAGING', 'X-RAY', 'BLOOD WORK', 'PRESCRIPTION', 'RX',
  ]},
  { category: 'Income', keywords: [
    'PAYROLL', 'SALARY', 'DIRECT DEPOSIT', 'EMPLOYER', 'DIVIDEND', 'INTEREST',
    'TRANSFER IN', 'DEPOSIT', 'EMPLOYMENT', 'WAGES', 'BONUS', 'COMMISSION',
    'REFUND', 'CREDIT', 'REIMBURSEMENT', 'GARNISHMENT', 'CHILD SUPPORT',
  ]},
  { category: 'Transfer', keywords: [
    'E-TRANSFER', 'INTERAC', 'INTERAC E-TRANSFER', 'TRANSFER OUT', 'BILL PAYMENT',
    'BILL PAY', 'BIL', 'PAYMENT TO', 'PAYMENT FROM', 'INTER-ACCOUNT', 'INTER ACCOUNT',
    'RECURRING PAYMENT', 'PRE-AUTHORIZED', 'PREAUTHORIZED', 'PRE-AUTH', 'PREAUTH',
    'DIRECT DEBIT', 'PAD PAYMENT',
  ]},
];

// Deduplicate each list — previously, e.g. "WALMART" appeared 3x in Shopping
// and "PROVIGO" appeared 2x in Groceries, generating 800+ redundant INSERTs.
const dedupedRules = RULES.map(r => {
  const seen = new Set();
  const unique = [];
  for (const kw of r.keywords) {
    if (!seen.has(kw)) { seen.add(kw); unique.push(kw); }
  }
  return { category: r.category, keywords: unique };
});

export default dedupedRules;
