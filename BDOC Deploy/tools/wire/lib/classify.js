// ============================================================
// classify — what a headline is about and how bad it claims to be
// ============================================================
// WHY THIS EXISTS
// The owner's question is "what is going on", and 115 feeds answer it with a few
// thousand lines a day, most of them a zoning board meeting on Nov. 4. This file
// is what stands between that and the owner's phone. Its one job is to separate an event
// that is being asserted from a word that merely appeared.
//
// DESIGN NOTES
// - Compiled regex only, no model: Spec ground rule 1 forbids passing feed text to
//   an LLM, and the firehose needs 50+ posts a second. classify() runs in tens of
//   microseconds.
// - False friends are removed BEFORE any rule runs (IDIOMS). "Heart attack" and
//   "Riot Games" never reach the rules, so no rule has to know about them, and a
//   new false positive is one line in one list.
// - Severity 3 needs a finite verb. "Trump invokes" is an event; "invoking",
//   "to invoke" and "could invoke" are not. Most of this file is that distinction.
// - Severity rules read the headline only. Snippets wander: a story about a bake
//   sale can end with a line about last year's riot. Categories and watch hits may
//   read the snippet, because a false tag costs far less than a false alarm.
// - Severity here is the claim made by the text. The truth ladder (cluster.js) then
//   decides how much of that claim to believe. A lone post can say sev 3 and still
//   display as 1.
// - classify() is pure apart from the custom terms set by setCustomTerms().

'use strict';

const { places } = require('./gazetteer');

const CATEGORIES = ['election', 'unrest', 'security', 'military', 'cyber', 'infra', 'disaster',
  'health', 'finance', 'gov', 'labor', 'rumor'];

// perMin buckets. Everything except nov4 and ports is also a category.
const BUCKETS = ['nov4', 'election', 'unrest', 'security', 'infra', 'cyber', 'military', 'rumor', 'ports'];

const MAX_CHARS = 700;      // both fields fit. A longer input is hostile, not news.
const WATCH_YEAR = '2026';  // "Nov. 4, 2022" is some other Nov. 4

function words(list, flags) {
  return new RegExp('\\b(?:' + list.join('|') + ')\\b', flags || 'i');
}

function norm(s) {
  return String(s == null ? '' : s).slice(0, MAX_CHARS)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── False friends. Replaced with a marker before any rule sees the text. ─────
const IDIOMS = new RegExp('\\b(?:' + [
  // attack
  '(?:heart|shark|panic|anxiety|asthma|gout|migraine|bear|dog|pit bull|snake|bee|alligator|gator|cougar|coyote|wolf|tiger|lion|hippo|crocodile|sneak|sugar) attacks?',
  'attack (?:ads?|dogs?|on titan|of the \\w+)',
  'attack(?:s|ed|ing)? (?:the|a whole) (?:rim|basket|paint|ball|net|glass|boards?|chicken|turkey|recipe|dish|steak)',
  // bomb
  '(?:bath|photo|f|truth|seed|cherry|sex|glitter|stink|box[- ]office|calorie|flavou?r|time|fat|cocoa|cinnamon|jager|nacho|dive|love|yarn)[- ]?bomb(?:s|ed|ing|ers?)?',
  'bomb (?:cyclones?|pops?)', 'bomb(?:s|ed)? at the box office',
  // riot
  'riot (?:games|fest|grrrls?|act|points|of colou?rs?|of flavou?rs?)', '(?:pussy|quiet) riot',
  'ran riot', 'run(?:s|ning)? riot',
  // strike
  'lightning strikes?', 'struck by lightning', 'bird strikes?', 'strike-slip',
  'strikes? (?:a |the |up a )?(?:pose|deal|balance|chord|nerve|match|tone|bargain|gold|oil|conversation|friendship)',
  'strikes? out', 'struck out', 'strikeouts?', 'strike (?:zone|three|two|one|price|rate|it rich)',
  'three strikes',
  // shoot
  'photo ?shoots?', '(?:film|movie|fashion|video|commercial|music video|photo) shoots?',
  'shooting (?:stars?|guards?|percentage|range|sports?|sleeves?|stick|a (?:film|movie|video|scene|commercial|documentary))',
  'shoot(?:s|ing)? (?:hoops|a film|a movie|a video|a scene|a documentary)',
  'clay shooting', 'skeet shooting', 'trap shooting', 'sharp ?shoot\\w*',
  // coup
  "coup de (?:grace|theatre|main|foudre)", 'coup for', 'pr coup',
  // blackout
  'blackout (?:curtains?|dates?|tattoos?|poetry|drunk|shades?|blinds?|period|rules?|restrictions?)',
  '(?:tv|broadcast|sports|local|streaming) blackouts?',
  // grid
  'grid (?:girls?|search|penalty)', 'off[- ]the[- ]grid', 'starting grid',
  // cyber
  'cyber (?:monday|week|deals?|sales?)',
  // shutdown
  'shutdown (?:corner|defense|inning|performance|win)',
  // war
  'star wars', '(?:culture|price|bidding|console|turf|streaming|flame|format|cola|talent) wars?',
  'war (?:on christmas|of words|of the \\w+|room|chest|horse|paint)',
  // threat
  '(?:triple|dual|double|two[- ]way|three[- ]level) threats?',
  // emergency
  'emergency (?:rooms?|contacts?|funds?|savings|brake|department|medicine|vet|dentist|physician|exit)',
  // warning
  '(?:spoiler|trigger|content) warnings?', 'warning (?:track|labels?|lights?)',
  // march
  'march madness', 'marching bands?', 'march of (?:dimes|the \\w+)', 'ides of march',
  // plot
  'plot (?:twists?|holes?|of land|armou?r|points?|lines?)', '(?:garden|cemetery|burial) plots?',
  // martial
  'martial arts?',
  // terror
  'night terrors?', 'tiny terrors?', 'reign of terror',
  // civil war as history
  'civil war (?:reenact\\w+|re-enact\\w+|museum|battlefield|era|general|historian|monument|memorial|buff|history|soldiers?|cemetery|cannon|veterans?|trail)',
  '(?:american|spanish|english) civil war',
  // collapse
  'colony collapse'
].join('|') + ')\\b', 'gi');

// A URL is not a claim. "www.mobilize.us/nokings" must not read as a troop mobilization,
// and a domain name should never be what makes a post look like signal.
const URLISH = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|gov|edu|us|io|co|news|tv|info|app|ly)\b(?:\/\S*)?/gi;

function neutralize(t) {
  return t.replace(URLISH, ' ').replace(IDIOMS, ' ~ ');
}

// ── Nov. 4 ───────────────────────────────────────────────────────────────────
const MON = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NOV = 'nov(?:ember)?\\.?';
// A year other than the watch year makes it a different date. "11/4" must not be
// the tail of a longer date or a fraction like 1/11/4.
const NOT_OTHER_YEAR = `(?!,?\\s*(?!${WATCH_YEAR}\\b)(?:19|20)\\d\\d\\b)`;
const NOV4_RE = new RegExp(
  `\\b${NOV}\\s*0?4(?:th)?\\b${NOT_OTHER_YEAR}` +
  `|\\b0?4(?:th)?\\s+(?:of\\s+)?${NOV}(?![a-z])${NOT_OTHER_YEAR}` +
  '|(?<![\\d/.-])11/0?4(?:/(?:20)?26)?(?![\\d/])', 'i');

const NOV4_RANGE = new RegExp(
  `\\b${MON}\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?\\s*(?:-|to|through|thru)\\s*(?:${NOV}\\s*)?0?4(?:th)?\\b` +
  `|\\b${NOV}\\s*0?4(?:th)?\\s*(?:-|to|through|thru)\\s*(?:${MON}\\.?\\s*)?\\d{1,2}\\b`, 'i');

const ROUTINE = words(['meet(?:s|ing|ings)?', 'opens?', 'open house', 'openers?', 'playoffs?', 'games?', 'match(?:es)?',
  'tournaments?', 'concerts?', 'tours?', 'festivals?', '(?<!and )fairs?', 'workshops?', 'webinars?', 'earnings', 'results',
  'dividends?', 'book club', 'pantry', 'pantries', 'ceremony', 'ceremonies', 'auctions?', 'screenings?', 'premieres?',
  'launch(?:es|ed|ing)?', 'sale', 'expires?', 'enrollment', 'board', 'commission', 'council', 'foliage', 'flashbacks?',
  'this week in history', 'birthdays?', 'streaming', 'new movies', 'reenactment']);

const STRONG = words(['attack\\w*', 'threat\\w*', 'warnings?', 'rumou?r\\w*', 'plots?', 'plotting', 'plotted', 'protest\\w*',
  'march(?:es|ed|ers)?', 'strikes?', 'striking', 'strikers?', 'walkouts?', 'shutdowns?', 'blackouts?', 'outages?', 'riot\\w*', 'unrest',
  'emergenc(?:y|ies)', 'evacuat\\w*', 'martial', 'insurrection\\w*', 'national guard', 'civil war', 'coups?', 'false flags?',
  'cyber\\w*', 'bomb\\w*', 'shoot\\w*', 'terror\\w*', 'militias?', 'collaps\\w*', 'bank runs?', 'something big', 'be prepared',
  'stock up', 'get ready', "it's happening", 'sabotag\\w*', 'interference', 'fight back', 'rise up', 'take to the streets',
  'uprising', 'revolt', 'rall(?:y|ies)', 'expect something', 'something (?:is )?(?:coming|happening)', 'day after the election']);

// Weaker evidence: enough alone, not beside a routine-event word. "Board of elections
// meets Nov. 4" is a calendar entry. "10,000 police deployed ahead of Nov. 4 polls" is not.
const NOV4_SOFT = words(['elections?', 'polls?', 'polling', 'ballots?', 'voters?', 'subpoena\\w*', 'grand jury', 'indict\\w*',
  'police', 'troops', 'deploy\\w*', 'courts?', 'judges?']);

// A weather product's expiry time is not a claim about the date.
const NOV4_EXPIRY = /\b(?:watch|warning|advisory|statement)\b.{0,80}\b(?:until|through)\b/i;

// ── Watches ──────────────────────────────────────────────────────────────────
const PORTS_CI = words(['ilwu', 'ila local', 'pacific maritime association', 'longshore(?:men|man|workers?)?', 'dockworkers?',
  'dock workers?', 'port (?:strike|workers?|security workers?|terminals?|complex)', 'ports? of (?:los angeles|la|long beach|oakland|seattle|tacoma|new york|savannah|houston|baltimore|charleston)',
  'long beach ports?', 'la[ /-]lb', 'la[/ -]long beach', 'los angeles[ /,-]+(?:and )?long beach', '(?:los angeles|la) ports?']);
const PORTS_CS = /\b(?:PMA|ILA)\b/;

// ── Forms that cap severity ──────────────────────────────────────────────────
const DRILL = new RegExp([
  '\\b(?:emergency(?: response)?|disaster|preparedness|response|training|tabletop|table[- ]top|full[- ]scale|field|functional|mock|simulated|military|naval|navy|joint|live[- ]fire|war|air defense|nuclear|security|evacuation|fire|lockdown|active[- ]shooter|shooter|safety|earthquake|tsunami|tornado|hurricane|mass[- ]casualty|casualty|cyber|readiness|annual|multi-?agency|interagency)\\s+(?:drills?|exercises?)\\b',
  '\\b(?:hosts?|hosting|holds?|holding|conducts?|conducting|stages?|staging|runs?|running|plans?|planning|schedules?|scheduled|participates? in|takes? part in)\\s+(?:(?:a|an|the|its|their|annual|large-scale|major|\\w+)\\s+){0,3}(?:drills?|exercises?)\\b',
  '\\bwar[- ]?gam\\w+',
  '\\b(?:this is|only|just|part of)\\s+(?:a|an)\\s+(?:drill|exercise|test)\\b',
  '\\bmock (?:attacks?|disasters?|shootings?|elections?|emergenc(?:y|ies)|crash(?:es)?|evacuations?|invasions?)\\b',
  '\\bsimulat(?:es?|ed|ing|ions?)\\b.{0,30}\\b(?:attacks?|shootings?|disasters?|emergenc(?:y|ies)|crash(?:es)?|outbreaks?|bomb\\w*|blackouts?|casualt\\w+)\\b',
  '\\b(?:emergency alert|emergency broadcast|alert system|warning system|wireless emergency alert|outdoor siren|tornado siren|siren|sirens)\\s+(?:system\\s+)?tests?\\b',
  '\\btest(?:s|ing)?\\s+(?:of\\s+)?(?:(?:the|its|their|tornado|outdoor|emergency|warning)\\s+)*(?:sirens?|alert system|warning system|emergency alert|emergency broadcast)\\b',
  '\\bactive[- ]shooter (?:training|course|class|preparedness)\\b'
].join('|'), 'i');

const DEBUNK = words(['fact[- ]?check\\w*', 'debunk\\w*', 'hoax\\w*', 'no evidence', 'without evidence', 'fake', 'false claims?',
  'falsely', 'baseless', 'unfounded', 'not true', "isn't true", 'is false', 'are false', 'fabricated', 'doctored', 'deepfakes?']);

const SPORTS_ENT = new RegExp([
  '\\b(?:nfl|nba|wnba|mlb|nhl|mls|ncaa|ncaaf|ufc|pga|lpga|nascar|fifa|uefa|wwe|aew|espn|atp|wta)\\b',
  '\\b(?:super bowl|world series|stanley cup|premier league|champions league|la liga|serie a|bundesliga|grand slam|wimbledon|us open|ryder cup|olympi(?:cs?|ans?)|paralympics?)\\b',
  '\\b(?:playoffs?|quarterbacks?|touchdowns?|wide receivers?|linebackers?|running backs?|tight ends?|home runs?|pitchers?|innings?|bullpen|dugout|slam dunks?|three-pointers?|3-pointers?|rebounds?|goalkeepers?|goalies?|hat[- ]tricks?|head coach|coach|coaches|roster|free agents?|draft picks?|varsity|maction|homecoming|bowl games?|tailgat\\w+|football|baseball|basketball|hockey|soccer|softball|volleyball|lacrosse|rugby|cricket|tennis|golf(?:ers?)?|wrestling|title fight|semifinals?|quarterfinals?|mvp|bowler|bowling|odds)\\b',
  '\\b(?:box office|movies?|films?|filmmakers?|trailers?|tv series|tv show|sitcoms?|netflix|hulu|disney\\+|hbo|prime video|apple tv|streaming|oscars?|emmys?|grammys?|tony awards?|golden globes?|billboard|albums?|soundtrack|singer|rapper|songwriter|actress|celebrit(?:y|ies)|broadway|reality tv|snl|saturday night live|video ?games?|gameplay|playstation|xbox|nintendo|league of legends|valorant|fortnite|minecraft|roblox|anime|manga|comic books?|superhero|marvel|star trek|horoscope|recipes?|cookbook|cooking|chef|fashion week)\\b',
  // "threat actor" and "state actor" are cyber and espionage terms, not casting news.
  '(?<!threat )(?<!state )(?<!bad )(?<!malicious )(?<!nation-state )(?<!foreign )\\bactors?\\b'
].join('|'), 'i');

// A real event at a stadium is still a real event. These lift the sports cap.
const HARD_EVENT = words(['killed', 'dead', 'dies', 'died', 'deaths?', 'wounded', 'injured', 'hospitalized', 'gunman', 'gunmen', 'gunfire',
  'gunshots?', 'shots fired', 'open(?:s|ed)? fire', 'mass shooting', 'active[- ]shooter', 'shooting', 'stabbed', 'stabbing', 'explosion',
  'bomb threats?', 'threats?', 'evacuat\\w+', 'hostages?', 'terror\\w*', 'lockdown', 'riots?', 'rioting']);

const RETRO = new RegExp([
  '\\b(?:anniversar(?:y|ies)|years? ago|decades? ago|years? later|years? after|months? after|retrial|sentenc\\w+|acquit\\w*|convict\\w*|pardon\\w*|remember\\w*|memorial|commemorat\\w+|flashback|looks? back|looking back|on this day|capitol riot|jan(?:\\.|uary)? 6(?:th)?)\\b',
  '\\btrial\\b',
  // A plea for calm is not a court appeal.
  '\\bappeal(?:s|ed|ing)?\\b(?! (?:for|to) )',
  // "Deadliest attack in US history" is the event, not a retrospective on one.
  '(?<!\\bin (?:[\\w.]+ )?)\\bhistory\\b',
  '\\b(?:in|since|during) (?:19\\d\\d|20[01]\\d|202[0-5])\\b'
].join('|'), 'i');

const OPINION = new RegExp([
  '\\b(?:opinion|op-ed|oped|columnist|editorial|commentary|analysis|explainer|explained|what to know|what we know|what you need to know|things to know|need to know|how to|guide|preview|podcast|quiz|reviews?|letters? to the editor|perspective|essay|newsletter|recap|takeaways|timeline of)\\b',
  '\\bcolumn\\b(?! of)'
].join('|'), 'i');
const OPINION_OPENER = /^(?:Why|How|What|Who|When|Where)\b/;   // case-sensitive: WHO is a health agency
const QUESTION = /\?\s*$/;

const MAY_MODAL = "(?<!in )(?<!since )(?<!last )(?<!this )(?<!next )(?<!early )(?<!late )(?<!mid-)may(?! \\d)";

// Conditional: the event has not happened. Sev 3 becomes 2.
const COND = words(['could', 'might', 'would', 'if', MAY_MODAL, 'considers?', 'considering', 'weighs?', 'weighing', 'fears? of', 'threat of',
  'ahead of', 'plans? to', 'planning to', 'mulls?', 'mulling', 'eyes', 'floats?', 'floated', 'threatens? to', 'threatened to', 'threatening to',
  'vows? to', 'vowed to', 'urges?', 'urged', 'calls? (?:for|on)', 'called (?:for|on)', 'asks?', 'asked', 'demands?', 'demanded', 'should',
  'possibl[ey]', 'potential(?:ly)?', 'likely', 'unlikely', 'risk of', 'prepar(?:es?|ing) to', 'expected to', 'set to', 'poised to', 'alleged(?:ly)?',
  'reportedly', 'hop(?:es?|ing) to', 'wants? to', 'seeks? to', 'seeking to', 'propos(?:es?|ed|al)', 'whether', 'in case', 'unless', 'scenario',
  'hypothetical', 'imagine', 'warn(?:s|ed|ing)? (?:of|that|about)', 'not', 'no', 'never', "won't", "wouldn't", "didn't", "doesn't", "isn't", "wasn't",
  "hasn't", "haven't", "can't", 'cannot', 'den(?:y|ies|ied)', 'rul(?:es?|ed) out', 'reject(?:s|ed)?', 'refus(?:es?|ed)', 'blocks?', 'blocked',
  'bars', 'barred', 'halts?', 'halted', 'overturn(?:s|ed)?', 'oppos(?:es?|ed)', 'condemn(?:s|ed)?']);

// Hypothetical: nothing has happened at all. A sev 2 rule becomes 1. Narrower than
// COND on purpose: "Guard deployed ahead of election" really was deployed.
const HYPO = words(['could', 'might', 'would', 'if', MAY_MODAL, 'considers?', 'considering', 'weighs?', 'weighing', 'fears?', 'threat of', 'threatens?',
  'threatened', 'threatening', 'warn(?:s|ed|ing)? (?:of|that|about)', 'possibl[ey]', 'potential(?:ly)?', 'risk of', 'looms?', 'looming', 'brac(?:es?|ing) for',
  'prepar(?:es?|ing) for', 'foiled', 'thwarted', 'averted', 'not', 'no', 'never', "won't", "didn't", 'den(?:y|ies|ied)', 'rul(?:es?|ed) out', 'whether',
  'in case', 'unless', 'hypothetical', 'scenario', 'imagine', 'lifted', 'ended', 'expired', 'all clear', 'cancel(?:l?ed|s)?', 'should']);

// ── Who is it about ──────────────────────────────────────────────────────────
const US_CS = /\b(?:US|USA|ICE|U\.S\.A?\.?(?![a-z]))|\bU\.S\b/;
const US_CI = words(['america', 'americans?', 'congress(?:ional|man|woman)?', 'scotus', 'fbi', 'cia', 'dhs', 'doj', 'fema', 'cdc', 'cisa', 'norad', 'gop', 'maga',
  'aclu', 'secret service', 'homeland security', 'justice department', 'state department', 'war department', 'insurrection act', 'republicans?', 'democrats?',
  'trump\\w*', 'biden', 'vance', 'harris', 'obama', 'hegseth', 'rubio', 'bondi', 'noem', 'newsom', 'desantis', 'abbott', 'pritzker', 'hochul', 'midterms?',
  'electoral college', 'white house', 'pentagon', 'capitol', 'senate', 'national guard']);
// Named here because a headline rarely says "South Korea" twice, and "Zelensky"
// must read as foreign even though no country is named.
const FOREIGN_NAMES = words(['zelensk(?:y|yy|iy)', 'putin', 'kremlin', 'netanyahu', 'xi jinping', 'modi', 'erdogan', 'khamenei', 'kim jong[- ]un', 'macron', 'starmer',
  'merz', 'meloni', 'orban', 'lukashenko', 'maduro', 'milei', 'lula', 'yoon', 'lee jae-myung', 'marcos', 'duterte', 'sheinbaum', 'carney', 'bolsonaro',
  'korean?', 'ukrain\\w+', 'russian?', 'iranian?', 'israeli?', 'chinese', 'palestinians?', 'hamas', 'hezbollah', 'houthis?']);

// ── Severity 3: an asserted catastrophe ──────────────────────────────────────
// Third person or past only: "declare" is what someone might do, "declares" happened.
const DECL_VERBS = '(?:declares|declared|imposes|imposed|invokes|invoked|enacts|enacted|orders|ordered)';
const MARTIAL_DECL = new RegExp(`\\b${DECL_VERBS}\\b.{0,40}\\bmartial law\\b|\\bmartial law\\b.{0,25}\\b(?:declared|imposed|invoked|enacted|in effect|takes effect)\\b`, 'i');
const INSURRECTION = /\b(?:invokes|invoked|signs|signed|enacts|enacted)\b.{0,30}\binsurrection act\b|\binsurrection act\b.{0,20}\b(?:invoked|in effect|enacted)\b/i;
const NATL_EMERGENCY = /\b(?:declares|declared|declaring)\b.{0,30}\bnational (?:state of )?emergency\b|\bnational (?:state of )?emergency\b.{0,20}\b(?:declared|in effect)\b/i;

const TERRORISH = /\b(?:terror(?:ist|ism)?|suicide (?:bomb\w*|attacks?)|car bomb\w*|truck bomb\w*|jihadists?|isis|al[- ]qaeda)\b/i;
const MASS = /\b(?:dozens|scores|hundreds|\d{2,}(?:,\d{3})?)\s+(?:\w+\s+){0,2}(?:killed|dead|die|died|wounded|injured|casualties)\b|\bkill(?:s|ed|ing)?\s+(?:at least |more than |over |nearly |some )?(?:\d{2,}|dozens|scores|hundreds)\b|\bmass[- ]casualty\b/i;

const OUTAGE_NOUN = '(?:blackouts?|power outages?|power failures?|grid (?:failures?|collapse)|internet outages?|cell(?:ular)? outages?|wireless outages?|mobile outages?|911 outages?|telecom outages?|network outages?|banking outages?)';
const NATIONWIDE = new RegExp(`\\b(?:nationwide|national|country-?wide|coast[- ]to[- ]coast)\\b.{0,30}\\b${OUTAGE_NOUN}\\b|\\b${OUTAGE_NOUN}\\b.{0,40}\\b(?:nationwide|across the (?:country|nation|us|u\\.s\\.|united states)|across america|coast to coast|country-?wide)\\b`, 'i');

const NUKE_DET = /\bnuclear (?:weapons? |bombs? |warheads? |devices? |missiles? )?(?:detonat\w+|explosions?|blasts?|strikes?|attacks?)\b|\b(?:detonat\w+|explod\w+|dropp?ed|launch\w*|fired?)\b.{0,25}\bnuclear (?:weapons?|bombs?|warheads?|devices?|missiles?)\b/i;

const STATE_ACTORS = '(?:iran|iraq|israel|russia|ukraine|china|taiwan|north korea|south korea|japan|india|pakistan|afghanistan|syria|lebanon|hezbollah|hamas|yemen|saudi arabia|turkey|egypt|sudan|venezuela|cuba|mexico|canada|the united states|the us|the u\\.s\\.|america|nato|poland|germany|france|britain|the uk)';
const WAR_DECL = new RegExp(`\\bdeclar\\w+ war (?:on|against) ${STATE_ACTORS}\\b|\\bdeclaration of war (?:on|against) ${STATE_ACTORS}\\b|\\b(?:congress|senate) (?:votes? to )?declares? war\\b|\\b${STATE_ACTORS} (?:formally )?declares? war\\b(?! on (?:drugs|crime|cartels|gangs|corruption|poverty|inflation|plastic|waste|fraud))|\\bdeclares? (?:a )?state of war\\b`, 'i');

const OFFICIAL_TITLE = '(?:president|vice president|prime minister|chancellor|senator|sen\\.|governor|gov\\.|congress(?:wo)?man|house speaker|speaker of the house|supreme court justice|chief justice|attorney general|secretary of (?:state|defense|war|homeland security|the treasury)|defense secretary|war secretary|homeland security secretary|national security adviser|fbi director|cia director|trump|vance)';
const ASSASSINATED = new RegExp(`\\b${OFFICIAL_TITLE}\\b.{0,60}\\b(?:assassinated|shot dead|gunned down|fatally shot)\\b|\\b(?:assassinated|assassinates|assassination of)\\b.{0,40}\\b${OFFICIAL_TITLE}\\b`, 'i');
const ASSASS_NOT = /\b(?:attempt\w*|plot\w*|foiled|tried|failed|surviv\w+|would-be|conspir\w+|jfk|kennedy|lincoln|garfield|mckinley|mlk|sadat|bhutto|gandhi|rabin|ferdinand|caesar|abe)\b/i;

const POLL_SITE = /\b(?:polling (?:places?|stations?|sites?|locations?|centers?)|poll sites?|vote centers?|voting (?:centers?|sites?|locations?)|ballot drop box(?:es)?|elections? (?:offices?|centers?|headquarters|warehouses?|department)|board of elections|county clerk's office|registrar's office)\b/i;
const CASUALTY = /\b(?:killed|kills?|dead|dies|died|shot|wounded|injured|stabbed|casualt\w+|fatal\w*)\b/i;

const NTAS = /\b(?:ntas|national terrorism advisory(?: system)?)\b.{0,50}\b(?:bulletin|alert|issued)\b|\bissues?\b.{0,30}\b(?:ntas|national terrorism advisory)\b/i;
const CISA_ED = /\bcisa\b.{0,50}\bemergency directive\b|\bemergency directive\b.{0,50}\bcisa\b|\bemergency directive \d{2}-\d{2}\b/i;
const TSUNAMI = /\btsunami warnings?\b/i;
const TSUNAMI_OFF = /\b(?:no|not|cancel\w*|lift\w*|ended|expired|downgraded|all clear|without)\b/i;
const NUKE_ALERT = /\b(?:nuclear power plant warning|radiological hazard warning)\b/i;

const MAG = /\b(?:m|mag|magnitude|mw|ml)[ .:-]*([1-9](?:\.\d{1,2})?)(?![\d.])|\b([1-9](?:\.\d{1,2})?)[- ]?(?:magnitude|richter)\b/i;
const QUAKE_WORD = /\b(?:earthquakes?|quakes?|temblors?|aftershocks?|seismic)\b|^M ?\d/i;

function quakeMagnitude(h) {
  if (!QUAKE_WORD.test(h)) return 0;
  const m = MAG.exec(h);
  return m ? parseFloat(m[1] || m[2]) : 0;
}

// ── Severity 2: serious and happening ────────────────────────────────────────
const RIOT = /\b(?:riots?|rioting)\b/i;
const CURFEW = /\b(?:impos\w+|declar\w+|order\w*|enact\w*|extend\w*|announc\w+|under|in effect|citywide|nighttime|overnight|emergency|dusk-to-dawn)\b.{0,30}\bcurfews?\b|\bcurfews?\b.{0,30}\b(?:imposed|declared|ordered|in effect|extended|after (?:unrest|protests?|riots?|violence|looting|clashes))\b/i;
const CURFEW_BENIGN = /\b(?:teens?|juvenile|youth|minors?|mall|beach|parks?|schools?|dorm|campus|noise|pets?)\b/i;

const GUARD = /\b(?:national guard|guardsmen|guard (?:troops|members|units|soldiers))\b/i;
const GUARD_MOVE = /\b(?:deploy\w*|activat\w*|mobiliz\w*|federaliz\w*|dispatch\w*|call(?:s|ed)? (?:up|in|out)|sends?|sending|sent|orders?|ordered|patrol\w*|arriv\w+|rolls? in|streets?)\b/i;
const GUARD_BENIGN = /\b(?:flood\w*|hurricanes?|tropical|wildfires?|fires?|storms?|tornado\w*|snow\w*|blizzards?|ice|rescu\w+|saves?|saved|relief|recovery|drought|earthquakes?|disasters?|food (?:banks?|pantr\w+)|snap|shutdown|training|recruit\w*|anniversary|birthday|bands?|homecoming|retire\w*|ceremony|scholarship|clean-?up|vaccin\w+|covid|medals?|awards?)\b/i;

const BOMB_THREAT = /\bbomb threats?\b/i;
const VOTING_WORD = /\b(?:poll\w*|precincts?|vot(?:e|es|ers?|ing)|ballots?|elections?|registrar|county clerk)\b/i;
const ELEC_EVAC = /\b(?:elections?|polling|ballots?|vote|voting|county clerk|registrar)\b.{0,40}\b(?:evacuat\w+|lockdown|locked down|suspicious (?:packages?|envelopes?|powder|substance)|white powder|fentanyl|hazmat)\b|\b(?:evacuat\w+|lockdown|locked down|suspicious (?:packages?|envelopes?|powder|substance)|white powder|fentanyl|hazmat)\b.{0,40}\b(?:elections?|polling|ballots?|vote|voting|county clerk|registrar)\b/i;
const SHOOTER = /\b(?:active[- ]shooter|mass shooting|shooting (?:rampage|spree)|gun(?:man|men) open(?:s|ed)? fire|open(?:s|ed)? fire (?:on|at|inside|outside)|shots fired (?:at|inside|outside|near))\b/i;
const SUBSTATION_WORD = /\b(?:substations?|power (?:grid|stations?|plants?)|electric(?:al)? grid|transformers?)\b/i;
const SABOTAGE = /\b(?:attack\w*|shot|shots|shooting|gunfire|sabotag\w*|vandal\w*|bomb\w*|explosives?)\b/i;
const CYBER_HIT = /\b(?:cyber[- ]?attacks?|cyber[- ]?incidents?|ransomware|hack(?:ed|ers?|ing)?|ddos|wiper|intrusions?)\b/i;
const CRITICAL_INFRA = /\b(?:power (?:grid|company|utility|plant|station)|grid|electric\w*|utilit(?:y|ies)|water (?:system|treatment|utility|supply|plant)s?|pipelines?|hospitals?|health systems?|elections?|voter (?:rolls?|databases?|registration)|voting (?:machines?|systems?)|poll books?|airports?|airlines?|ports?|911|banks?|banking|telecom\w*|railways?|railroads?|critical infrastructure|nuclear plants?|dams?)\b/i;
const STRIKE_STARTS = /\b(?:strike|walkout|work stoppage)\b.{0,30}\b(?:begins?|began|beginning|started?|starts|underway|under way|launch\w*|shuts?|shut down|halts?|kicks? off)\b|\b(?:go(?:es)?|went|walk(?:s|ed)?|are) (?:on strike|off the job|out on strike)\b/i;
const NWS_HIGH = /\b(?:civil danger warning|civil emergency message|law enforcement warning|evacuation immediate|shelter[- ]in[- ]place (?:warning|order)|local area emergency)\b/i;
const ASSASSINATION = /\b(?:assassinated|assassination attempt|attempted assassination)\b/i;
const TERROR_ATTACK = /\b(?:terror(?:ist)? attacks?|suicide (?:bomb\w*|attacks?)|car bomb(?:s|ing|ings)?|truck bomb(?:s|ing|ings)?)\b/i;

// Added after the first live run rated each of these 0 or 1.
// "Drone strikes on Ethiopia displacement camp kill at least 15"
const VIOLENCE = /\b(?:strikes?|air ?strikes?|attacks?|bomb\w*|shelling|blasts?|explosions?|massacres?|gunmen|gunfire|clashes)\b/i;
// "Saudi-led coalition reports intercepting ballistic missile and drone"
const LONG_MISSILE = /\b(?:ballistic|cruise|hypersonic) missiles?\b/i;
const MISSILE_ACT = /\b(?:launch\w*|fired?|intercept\w*|strikes?|struck|hits?|attack\w*|shot down|downs?|downed|destroy\w*)\b/i;
// "North Korean hackers steal over $6 billion from the largest cryptocurrency exchange"
const BIG_THEFT = /\b(?:hack\w*|stole|stolen|steals?|stealing|theft|heist|drain\w*)\b.{0,60}\b\d+(?:\.\d+)?\s*(?:billion|bn)\b|\$\d+(?:\.\d+)?\s*(?:billion|bn)\b.{0,60}\b(?:hack\w*|stole|stolen|theft|heist|breach)\b/i;
// "Binance Suspends Withdrawals After Crypto Hackers Steal $6.3 Billion"
const WITHDRAWALS = /\b(?:suspends?|suspended|halts?|halted|freezes?|froze|frozen)\b.{0,30}\bwithdrawals\b/i;
// "Italy's PM deploys troops as nation faces widespread strikes and port blockades"
const TROOPS_UNREST = /\b(?:deploys?|deployed|sends?|sent|orders?|ordered)\b.{0,25}\b(?:troops|army|soldiers|military)\b.{0,60}\b(?:protests?|strikes?|unrest|riots?|blockades?|demonstrations?)\b/i;
// "Mass protests sweep Italy during nationwide strike"
const NATION_UNREST = /\b(?:mass|nationwide|national|widespread)\s+(?:protests?|strikes?|demonstrations?|unrest)\b.{0,40}\b(?:sweeps?|swept|erupts?|erupted|paralyz\w+|paralys\w+|shuts?|grips?|gripped|rocks?|rocked|spreads?|hits?)\b/i;

// Bare "invade" and "mobilize" are mostly figurative: "Shriners invade Salina", "anti-land
// invasion units", and Portuguese "mobilizar" all fired on the first live run.
const INVASION = `(?:russian?|chinese|israeli|iranian|ground|military|full-scale|amphibious|imminent) invasion|invasion of ${STATE_ACTORS}|invad(?:es?|ed|ing) ${STATE_ACTORS}|${STATE_ACTORS} invad(?:es?|ed)`;
const MOBILIZE = '(?:military|troop|army|reserve|reservist|partial|general|full|wartime|forced) mobili[sz]ations?|mobili[sz](?:es?|ed|ing) (?:\\w+ ){0,2}(?:troops|reserves?|reservists|forces|army|soldiers|military)';
// "Charm offensive" and "offensive line" are not battles.
const OFFENSIVE = '(?:military|ground|counter|spring|summer|winter|major|russian|ukrainian|israeli|new) ?-?offensive';

// ── Severity 1: notable ──────────────────────────────────────────────────────
const NOTABLE = new RegExp('\\b(?:' + [
  // protests
  'protest(?:s|ers?|ed|ing)?', 'demonstrators?', 'clash(?:es)? with police', 'tear gas', 'looting', 'looters',
  // threats
  'death threats?', 'bomb threats?', 'terror threats?', 'threats? (?:against|to kill|of violence|to (?:shoot|bomb|attack))',
  'threatening (?:letters?|messages?|calls?|emails?|mail|packages?)', 'threatened to (?:kill|shoot|bomb|attack)',
  'swatting', 'swatted', 'doxx?(?:ed|ing)', 'suspicious (?:packages?|envelopes?|powder)', 'white powder', 'credible threats?',
  'imminent threats?', 'threat (?:assessment|bulletin|advisory)', 'terror plot', 'plot to (?:attack|kill|bomb|kidnap|assassinate|overthrow|blow up)',
  'militias?', 'extremists?', 'white nationalists?', 'neo-?nazis?', 'domestic terror\\w*', 'terrorists?',
  // cyber
  'cyber[- ]?attacks?', 'cyber[- ]?incidents?', 'ransomware', 'data breach(?:es)?', 'hacked', 'hackers?', 'ddos', 'zero-day', 'salt typhoon', 'volt typhoon',
  // military movement
  'air ?strikes?', '(?:missile|drone|rocket|artillery) (?:strikes?|attacks?)', 'warships?', 'aircraft carriers?', 'carrier strike group', MOBILIZE,
  INVASION, 'incursions?', 'defcon', 'troops? (?:deploy\\w*|mov\\w+|mass\\w*|sent|head\\w*|arriv\\w+|cross\\w*|withdraw\\w*)',
  '(?:deploy\\w*|send\\w*|sent|mov\\w+|mass\\w*) (?:\\w+ ){0,2}troops', 'shelling',
  // named crises, short of asserted
  'martial law', 'insurrection act', 'national emergency', 'state of emergency', 'coup(?:s| attempt| plot)?', "coup d'etat", 'civil war', 'general strike', 'bank runs?'
].join('|') + ')\\b', 'i');

// "Christa Pike Recounts Botched Execution" is the verb, not the procedure.
const RECOUNT = '(?:vote|ballot|hand|manual|machine|automatic|statewide|election|senate|county) recounts?|recounts? (?:of (?:the )?(?:votes?|ballots?)|ordered|underway|under way|begins?|requested|demanded)';

const ELECTION_DISPUTE = new RegExp('\\b(?:' + [
  'voter (?:intimidation|suppression|fraud|purges?|rolls?|challenges?)', 'election (?:fraud|interference|deniers?|rigging|rigged|security|threats?|violence|lawsuits?|disputes?|challenges?|integrity|observers?|monitors?)',
  'rigged', 'stolen election', 'stop the steal', 'ballot (?:harvesting|stuffing|fraud|tampering|box fires?|challenges?|disputes?|lawsuits?)', 'drop box(?:es)? (?:fires?|arson|vandal\\w*|damag\\w*)',
  'refus\\w+ to certify', 'certification (?:fights?|disputes?|delays?)', 'disenfranchis\\w+', 'poll (?:watchers?|workers?)', RECOUNT, 'contested'
].join('|') + ')\\b', 'i');
const LEGAL_ACTION = words(['doj', 'justice department', 'attorney general', 'fbi', 'courts?', 'judges?', 'justices', 'lawsuits?', 'sues?', 'sued', 'suing', 'injunctions?',
  'restraining orders?', 'emergency orders?', 'subpoena\\w*', 'indict\\w*', 'probes?', 'investigat\\w+', 'charged', 'charges']);

// ── Categories ───────────────────────────────────────────────────────────────
const ELECTION = words(['elections?', 'midterms?', 'ballots?', 'polling (?:places?|stations?|sites?|locations?)', 'voters?', 'voting', 'vote[- ]counting', 'vote counts?', 'absentee', 'mail-in',
  'early vot\\w+', 'drop box(?:es)?', 'electoral', RECOUNT, 'canvass\\w*', 'poll workers?', 'gerrymander\\w*', 'redistricting']);
// An election at the Rotary Club is not an election.
const NOT_CIVIC = /\b(?:club|society|sorority|fraternity|student (?:government|body|council|union)|alumni|rotary|kiwanis|yacht|hoa|homeowners association|condo board|booster|pta|pto|homecoming|chamber of commerce|papal|union)\b.{0,40}\b(?:elections?|voting|ballots?|voters?)\b|\b(?:elections?|voting|ballots?)\b.{0,40}\b(?:of officers|club|society|sorority|fraternity|homecoming)\b/i;

const CATS = {
  unrest: words(['protest(?:s|ers?|ed|ing)?', 'riots?', 'rioting', 'rioters?', 'civil unrest', 'unrest', 'demonstrators?', 'looting', 'looters', 'curfews?', 'clash(?:es)? with police', 'tear gas',
    'insurrection\\w*', 'uprising', 'martial law', 'coup(?:s| attempt| plot)?', "coup d'etat", 'civil war', 'national guard', 'general strike']),
  security: words(['terror\\w*', 'mass shooting', 'active[- ]shooter', 'school shooting', 'gun(?:man|men)', 'gunfire', 'open(?:s|ed)? fire', 'shots fired', 'sniper', 'shooting (?:at|near|outside|in|on|leaves?|kills?|wounds?|injures?|suspects?|victims?|spree|rampage)',
    'bomb threats?', '(?:pipe|car|truck|suicide) bomb\\w*', 'bomb squad', 'bomb(?:ing)? (?:at|in|near|outside|on|attack|blast|plot)', 'bombing', 'explosive devices?', 'improvised explosive', 'detonat\\w+',
    'assassinat\\w+', 'hostages?', 'stabbing', 'swatting', 'swatted', 'doxx?(?:ed|ing)', 'death threats?', 'threats? (?:against|to kill|of violence|to (?:shoot|bomb|attack))', 'credible threats?', 'imminent threats?',
    'suspicious (?:packages?|envelopes?|powder)', 'white powder', 'militias?', 'extremists?', 'white nationalists?', 'neo-?nazis?', '(?:mass|armed|gun|knife|vehicle|ramming|arson|lone[- ]wolf|bomb) attacks?',
    'attackers?', 'attacks? (?:on|at|against) (?:the )?(?:\\w+ ){0,3}(?:polling|election|elections|substation|grid|capitol|police|church|synagogue|mosque|school|embassy|hospital|mall|airport|civilians?|officers?)',
    'national terrorism advisory', 'ntas', 'civil danger', 'law enforcement warning', 'shelter[- ]in[- ]place']),
  military: words(['air ?strikes?', '(?:missile|drone|rocket|artillery|naval|military|cruise missile|retaliatory|pre-?emptive|deadly) (?:strikes?|attacks?)', 'missiles?', 'shelling', 'artillery', 'warships?', 'aircraft carriers?', 'carrier strike group',
    'destroyers?', 'submarines?', 'fighter jets?', 'bombers?', 'b-52s?', 'troops?', 'soldiers', 'battalions?', 'brigades?', MOBILIZE, INVASION, 'incursions?', OFFENSIVE, 'cease-?fire', 'truce',
    'defcon', 'nato', 'pentagon', 'norad', 'war department', 'department of war', 'centcom', 'national guard', 'guardsmen', 'marines', 'navy', 'air force', 'army', 'military', 'nuclear (?:weapons?|warheads?|bombs?|missiles?|strikes?|attacks?|detonat\\w+)', 'icbms?']),
  cyber: words(['cyber\\w*', 'ransomware', 'data breach(?:es)?', 'hack(?:ed|ers?|ing)', 'malware', 'ddos', 'zero-day', '0-day', 'phishing', 'spyware', 'botnets?', 'wiper', 'cve-\\d{4}-\\d+', 'infosec', 'exploited', 'vulnerabilit(?:y|ies)', 'cisa', 'threat actors?', 'salt typhoon', 'volt typhoon']),
  infra: words(['power outages?', 'outages?', 'blackouts?', 'power grid', 'electric(?:al)? grid', 'grid (?:attack|failure|collapse|down|operator|emergency)', 'substations?', 'rolling blackouts?', 'load shedding', 'ercot', '911 (?:service|lines?|system)', 'cell service', 'cellular network',
    'water (?:mains?|system|treatment)', 'boil water', 'pipelines?', 'bridge collapse', 'dam (?:failure|breach|collapse)', 'ground stops?', 'airport (?:closed|closure)', 'air traffic control', 'faa', 'port closures?']),
  disaster: words(['earthquakes?', 'quakes?', 'aftershocks?', 'tsunamis?', 'hurricanes?', 'tropical storms?', 'typhoons?', 'cyclones?', 'tornado(?:es)?', 'wildfires?', 'bushfires?', 'flood(?:s|ing)?', 'flash floods?', 'landslides?', 'mudslides?', 'avalanches?', 'eruptions?', 'volcano(?:es)?', 'blizzards?', 'ice storms?', 'heat waves?', 'droughts?', 'evacuat\\w+']),
  health: words(['outbreaks?', 'pandemics?', 'epidemics?', 'h5n1', 'bird flu', 'avian flu', 'measles', 'cholera', 'ebola', 'mpox', 'anthrax', 'ricin', 'sarin', 'bioterror\\w*', 'biological (?:attack|weapon)s?', 'cdc', 'quarantines?']),
  finance: words(['bank runs?', 'bank (?:failures?|collapses?)', 'stock market', 'stocks? (?:plunge|tumble|crash|fall|sink|slide)s?', 'wall street', 'dow jones', 's&p 500', 'nasdaq', 'circuit breakers?', 'federal reserve', 'interest rates?', 'treasur(?:y|ies)', 'bond market', 'liquidity crisis', 'credit crunch', 'recession', 'inflation', 'fdic', 'banking outages?']),
  gov: words(['executive orders?', 'proclamations?', 'white house', 'congress', 'senate', 'house of representatives', 'government shutdown', 'supreme court', 'scotus', 'attorney general', 'justice department', 'doj', 'fbi', 'homeland security', 'dhs', 'fema', 'state department', 'pentagon', 'federal register', 'presidential (?:actions?|memorandum|determination)', 'insurrection act', 'national emergency', 'state of emergency', 'martial law']),
  labor: new RegExp([
    '\\bgeneral strike\\b', '\\b(?:on|go(?:es|ing)? on|went on) strike\\b', '\\bstrike (?:deadline|vote|threat|action|notice|authorization|fund|looms?|begins?|ends?|enters?|continues?|talks?|date|mandate|pay|line)\\b',
    '\\bstrikes?\\b.{0,40}\\b(?:workers?|union|port|ports|terminals?|contract)\\b', '\\b(?:workers?|unions?|teachers?|nurses?|dockworkers?|longshore\\w*|port|ports|rail|transit|drivers?|pilots?|attendants?|machinists|teamsters|uaw|ilwu|security guards?|watchmen)\\b.{0,40}\\bstrik(?:e|es|ing)\\b',
    '\\bpicket(?:s|ing|ers?)?\\b', '\\bwalkouts?\\b', '\\blockouts?\\b', '\\blabou?r (?:disputes?|contracts?|talks|action)\\b', '\\bunion (?:contract|workers|members|leaders|vote|election|talks)\\b', '\\bteamsters\\b', '\\bsag-aftra\\b', '\\bilwu\\b', '\\bdockworkers?\\b', '\\blongshore(?:men|man|workers?)?\\b'
  ].join('|'), 'i')
};

// Vendor and legal boilerplate that repeats a scary word. "$2M data breach settlement" and
// "ransomware resilience framework" are not incidents.
const BOILER = /\b(?:settlements?|settles?|class[- ]action|webinars?|frameworks?|best practices|resilience|market report|to the test)\b/i;

// One person saying "hackers" or "protest" is conversation, not signal. A social post earns
// its place with a watch hit, rumor language, an election-integrity claim, or by naming a
// crisis outright. Everything else stays out, or the firehose buries the feed.
const SOCIAL_KEEP = words(['martial law', 'insurrection act', 'national emergency', 'state of emergency', 'coup', "coup d'etat", 'general strike',
  'bank runs?', 'tear gas', 'national guard', 'guardsmen', 'polling (?:places?|stations?|sites?)', 'poll workers?', 'drop box(?:es)?']);

// A witness. "Protesters are blocking the bridge downtown right now" is the post worth having
// before any outlet has it, and "protest" alone cannot tell it from an opinion.
const LIVE_NOW = words(['right now', 'happening now', 'just now', 'at this moment', 'breaking', 'on the ground', 'live from', 'unfolding', 'currently']);

// ── Rumor language ───────────────────────────────────────────────────────────
const RUMOR_LANG =words(['rumou?r(?:s|ed)?', 'unconfirmed', 'unverified', 'hearing that', 'reports? of', 'insiders? (?:say|says|claims?)', 'leaked',
  'something (?:big|bad|huge|major)(?: is)? (?:coming|happening|going down)', 'be prepared', 'stock up', 'get your money out', 'pull your money', 'withdraw your (?:money|cash)',
  'stay home', 'stay off the streets', 'false flags?', "they don't want you to know", "what they're not telling you", "it's happening"]);
const RUMOR_CTX = words(['elections?', 'midterms?', 'vot(?:e|es|ers?|ing)', 'ballots?', 'polls?', 'polling', 'national guard', 'guardsmen', 'troops', 'martial', 'insurrection', '(?:power )?grid', 'blackouts?',
  'banks?', 'atms?', 'cash', 'fema', 'civil war', 'coup', 'military']);

// ── Firehose filter ──────────────────────────────────────────────────────────
// Bluesky alone is ~48 posts a second. This is the one regex they all pass through,
// so it is deliberately loose: stems, no trailing boundary. classify() is what is
// precise. A miss here is permanent, so it covers everything the rules can act on.
const FIREHOSE_TERMS = [
  'attack', 'threat', 'warning', 'rumou?r', 'plot', 'protest', 'march', 'strik(?:e|ing)', 'walkout', 'shutdown', 'blackout', 'outage', 'riot', 'unrest',
  'emergenc', 'evacuat', 'martial', 'insurrection', 'national guard', 'civil war', 'coup', 'false flag', 'cyber', 'bomb', 'shoot', 'terror', 'militia',
  'collaps', 'bank run', 'something (?:big|bad|huge|major)', 'be prepared', 'stock up', 'get ready', "it['’]s happening",
  'unconfirmed', 'unverified', 'hearing that', 'reports of', 'insiders? say', 'leaked', 'get your money out', 'stay home', "they don['’]t want you to know",
  'air ?strike', 'missile', 'invasion', 'invade', 'mobiliz', 'ransomware', 'hack(?:ed|ers?)\\b', 'data breach', 'curfew', 'loot', 'gunman', 'gunmen', 'gunfire',
  'assassinat', 'polling (?:place|station|site)', 'poll worker', 'ballot box', 'drop box', 'voter (?:intimidation|suppression|fraud|purge)',
  'election (?:fraud|interference|violence|threat|security|rigg)', 'rigged', 'stolen election', 'swatt', 'substation', 'power grid', 'tear gas', 'state of emergency', 'defcon',
  'ilwu', 'longshore', 'dockworker', 'port of (?:los angeles|long beach)', 'long beach port'
];
const FIREHOSE = new RegExp('\\b(?:' + FIREHOSE_TERMS.join('|') + ')|' + NOV4_RE.source, 'i');

// ── Custom watch terms ───────────────────────────────────────────────────────
let CUSTOM = [];
let CUSTOM_ANY = null;

// Terms are literal by contract, so everything regex-special is escaped. No `-`:
// with the u flag an escaped hyphen outside a class is a syntax error.
function escapeTerm(t) {
  return t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const TERM_OPEN = '(?<![\\p{L}\\p{N}])';
const TERM_CLOSE = '(?![\\p{L}\\p{N}])';

/**
 * Replaces the owner's custom terms. Takes effect for the next classify() and
 * prefilter() without a restart. Returns the terms actually in force.
 */
function setCustomTerms(terms) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(terms) ? terms : []) {
    if (typeof raw !== 'string') continue;
    const term = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (term.length < 2 || term.length > 64) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const body = escapeTerm(norm(term)).replace(/ /g, '\\s+');
    out.push({ term, re: new RegExp(TERM_OPEN + body + TERM_CLOSE, 'iu'), body });
    if (out.length >= 40) break;
  }
  CUSTOM = out;
  CUSTOM_ANY = out.length ? new RegExp(TERM_OPEN + '(?:' + out.map(c => c.body).join('|') + ')' + TERM_CLOSE, 'iu') : null;
  return out.map(c => c.term);
}

function prefilter(text) {
  const t = String(text == null ? '' : text).slice(0, 1000);
  if (FIREHOSE.test(t)) return true;
  return CUSTOM_ANY ? CUSTOM_ANY.test(norm(t)) : false;
}

// ── Severity ─────────────────────────────────────────────────────────────────
function nationally(usOnly) {
  return usOnly ? 3 : 2;
}

// Returns the claim as written, before any downgrade: 3, 2, 1 or 0.
function claimedSeverity(h, f) {
  if (MARTIAL_DECL.test(h)) return nationally(f.usOnly);
  if (INSURRECTION.test(h)) return 3;
  if (NATL_EMERGENCY.test(h)) return nationally(f.usOnly);
  if (TERRORISH.test(h) && MASS.test(h)) return 3;
  if (NATIONWIDE.test(h)) return nationally(f.usOnly);
  if (NUKE_DET.test(h)) return 3;
  if (WAR_DECL.test(h)) return 3;
  if (ASSASSINATED.test(h) && !ASSASS_NOT.test(h)) return 3;
  if (POLL_SITE.test(h) && CASUALTY.test(h)) return f.foreign ? 2 : 3;
  if (NTAS.test(h) || CISA_ED.test(h) || NUKE_ALERT.test(h)) return 3;
  if (TSUNAMI.test(h)) return TSUNAMI_OFF.test(h) ? 1 : 3;

  const mag = quakeMagnitude(h);
  if (mag >= 7) return 3;
  if (mag >= 6) return 2;

  if (RIOT.test(h)) return 2;
  if (CURFEW.test(h) && !CURFEW_BENIGN.test(h)) return 2;
  if (GUARD.test(h) && GUARD_MOVE.test(h) && !GUARD_BENIGN.test(h)) return f.foreign ? 1 : 2;
  if (BOMB_THREAT.test(h) && VOTING_WORD.test(h)) return 2;
  if (ELEC_EVAC.test(h)) return 2;
  if (SHOOTER.test(h)) return 2;
  if (SUBSTATION_WORD.test(h) && SABOTAGE.test(h)) return 2;
  if (CYBER_HIT.test(h) && CRITICAL_INFRA.test(h)) return 2;
  if (f.ports && STRIKE_STARTS.test(h)) return 2;
  if (NWS_HIGH.test(h)) return 2;
  if (ASSASSINATION.test(h)) return 2;
  if (TERROR_ATTACK.test(h)) return 2;
  if (MASS.test(h) && VIOLENCE.test(h)) return 2;
  if (LONG_MISSILE.test(h) && MISSILE_ACT.test(h)) return 2;
  if (BIG_THEFT.test(h) || WITHDRAWALS.test(h)) return 2;
  if (TROOPS_UNREST.test(h) || NATION_UNREST.test(h)) return 2;

  if (NOTABLE.test(h)) return 1;
  if (f.election && (ELECTION_DISPUTE.test(h) || LEGAL_ACTION.test(h))) return 1;
  if (f.ports && f.labor) return 1;
  return 0;
}

/**
 * classify({h, x, cls, cat0, sev0, geo}) ->
 *   { cat, w, sev, noise, drill, rumor, debunk, us, geo? }
 *
 * `sev` is the claim, before the truth ladder caps it. A lone post can come out 3
 * here: the cap belongs to cluster.js, because it depends on who else said it.
 */
function classify(raw) {
  const r = raw || {};
  const h = norm(r.h);
  const x = norm(r.x);
  const hc = neutralize(h);
  const all = x ? hc + ' . ' + neutralize(x) : hc;

  const drill = DRILL.test(hc);
  const debunk = r.cls === 'factcheck' || DEBUNK.test(hc);
  const sportsEnt = SPORTS_ENT.test(hc) && !HARD_EVENT.test(hc);

  // Who it is about. Parser geo wins where there is one: it knows, we infer.
  const pl = places(all);
  const us = r.geo && r.geo.cc === 'US' ? true : (pl.us || US_CS.test(all) || US_CI.test(all));
  const foreign = (r.geo && r.geo.cc && r.geo.cc !== 'US') ? true : (pl.foreign || FOREIGN_NAMES.test(all));

  // Categories read the snippet as well.
  const cat = [];
  const addCat = (c) => { if (c && !cat.includes(c)) cat.push(c); };
  if (Array.isArray(r.cat0)) r.cat0.forEach(addCat);
  const election = ELECTION.test(all) && !NOT_CIVIC.test(all);
  if (election) addCat('election');
  for (const k of Object.keys(CATS)) if (CATS[k].test(all)) addCat(k);

  // Watches.
  const w = [];
  let novDropped = false;
  if (NOV4_RE.test(all)) {
    // Positive evidence only. Keeping every mention not ruled out as routine let a "Wed 4
    // Nov" panel talk and a flood-watch expiry time through on the first live run.
    const strong = STRONG.test(all);
    const routine = ROUTINE.test(all) || sportsEnt;
    const evidence = strong || (NOV4_SOFT.test(all) && !routine);
    if (drill || NOV4_RANGE.test(all) || NOV4_EXPIRY.test(all) || !evidence) novDropped = true;
    else w.push('nov4');
  }
  const ports = PORTS_CI.test(all) || PORTS_CS.test(all);
  if (ports) w.push('ports');

  const rumor = RUMOR_LANG.test(all) && (RUMOR_CTX.test(all) || w.includes('nov4'));
  if (rumor) addCat('rumor');

  for (const c of CUSTOM) if (c.re.test(all)) w.push('custom:' + c.term);

  // Severity is the headline's claim, then each downgrade in the spec's order.
  const flags = { usOnly: us && !foreign, foreign, election, ports, labor: cat.includes('labor') };
  let sev = claimedSeverity(hc, flags);
  if (sev === 3 && COND.test(hc)) sev = 2;
  else if (sev === 2 && HYPO.test(hc)) sev = 1;

  if (sev === 1 && BOILER.test(hc)) sev = 0;
  if (sev === 1 && r.cls === 'social' && !w.length && !(election && ELECTION_DISPUTE.test(hc)) && !SOCIAL_KEEP.test(hc) && !LIVE_NOW.test(hc)) sev = 0;
  if (w.includes('nov4') || rumor) sev = Math.max(sev, 1);

  if (RETRO.test(hc) || OPINION.test(hc) || OPINION_OPENER.test(hc) || QUESTION.test(hc)) sev = Math.min(sev, 1);
  // A headline that says the claim is false has not asserted an event.
  if (debunk) sev = Math.min(sev, 1);
  if (sportsEnt) sev = 0;
  if (drill) sev = 0;

  // A feed that knows its own severity is believed over our reading of its headline,
  // but nothing outranks a stated drill.
  const sev0 = Number.isInteger(r.sev0) ? Math.min(3, Math.max(0, r.sev0)) : 0;
  if (sev0 > sev && !drill) sev = sev0;

  const noise = !!drill || (novDropped && sev === 0);
  const out = { cat, w, sev, noise, drill: !!drill, rumor: !!rumor, debunk: !!debunk, us: !!us };
  return out;
}

module.exports = { classify, prefilter, setCustomTerms, BUCKETS, CATEGORIES };
