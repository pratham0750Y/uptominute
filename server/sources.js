// Everything the server pulls from lives here. Edit freely.
const gn = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;

export const NEWS_FEEDS = [
  { name: "Google News", url: gn("Bengaluru when:2d") },
  { name: "The Hindu", url: "https://www.thehindu.com/news/cities/bangalore/feeder/default.rss" },
  { name: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeeds/-2128833038.cms" },
];

export const TRAFFIC_FEEDS = [
  { name: "Traffic advisories", url: gn("Bengaluru traffic advisory OR diversion OR road closure when:3d") },
  { name: "Traffic police", url: gn("Bengaluru Traffic Police when:2d") },
];

// Curated Bengaluru events with registration pages verified on 4 Nov 2026.
// Keep dates and registration state current; entries without a registrationDeadline
// should be checked with the organizer before being marked unavailable.
export const EVENTS = [
  {
    id: "krishna-to-kaveri-2026", title: "Krishna to Kaveri: Karnataka’s Cultural Confluences",
    category: "Arts & culture", startAt: "2026-11-07T11:00:00+05:30", endAt: "2026-11-08T20:00:00+05:30",
    venue: "Bangalore International Centre", area: "Domlur", lat: 12.9615, lon: 77.6387,
    registration: "https://bangaloreinternationalcentre.org/event/k2k26-day-1/", registrationLabel: "Event details & RSVP",
    price: "Check event page",
  },
  {
    id: "nafems-india-2026", title: "NAFEMS India Conference",
    category: "Technology", startAt: "2026-11-17T09:00:00+05:30", endAt: "2026-11-18T18:00:00+05:30",
    venue: "Hyatt Centric Hebbal", area: "Hebbal", lat: 13.0358, lon: 77.5913,
    registration: "https://nafems.duointernet.com/events/nafems/2026/nafems-india-conference/", registrationLabel: "Register",
    registrationDeadline: "2026-11-09T23:59:00+05:30", price: "Paid",
  },
  {
    id: "bengaluru-tech-summit-2026", title: "Bengaluru Tech Summit",
    category: "Technology", startAt: "2026-11-17T09:00:00+05:30", endAt: "2026-11-19T18:00:00+05:30",
    venue: "Bangalore International Exhibition Centre", area: "Tumkur Road", lat: 13.0688, lon: 77.4769,
    registration: "https://bengalurutechsummit.com/", registrationLabel: "Registration & details",
    price: "Check event page",
  },
  {
    id: "wordcamp-bengaluru-2026", title: "WordCamp Bengaluru 2026",
    category: "Community", startAt: "2026-11-21T09:00:00+05:30", endAt: "2026-11-22T18:00:00+05:30",
    venue: "St. Joseph’s Boys’ High School", area: "Museum Road", lat: 12.9688, lon: 77.6033,
    registration: "https://bengaluru.wordcamp.org/2026/tickets/", registrationLabel: "Get tickets",
    price: "Tickets available",
  },
  {
    id: "ieee-wie-ils-2026", title: "IEEE Women in Engineering Leadership Summit",
    category: "Technology & community", startAt: "2026-11-27T09:00:00+05:30", endAt: "2026-11-28T18:00:00+05:30",
    venue: "The Chancery Pavilion", area: "Residency Road", lat: 12.9685, lon: 77.6017,
    registration: "https://wieils.ieee.org/2026-bangaloreindia/", registrationLabel: "Register & details",
    price: "Check event page",
  },
  {
    id: "n-sprite-2026", title: "N-SPRITE International Conference on Suicide Prevention",
    category: "Health & wellbeing", startAt: "2026-11-30T09:00:00+05:30", endAt: "2026-12-03T18:00:00+05:30",
    venue: "NIMHANS Convention Centre", area: "Hosur Road", lat: 12.9437, lon: 77.5965,
    registration: "https://www.nspriteconference.com/", registrationLabel: "Register & details",
    registrationNote: "Regular rate through 10 Nov; late and spot registration after.", price: "Check event page",
  },
];

export const CITY = { lat: 12.9716, lon: 77.5946 };

// Bengaluru FM stations. `match` words are used to find a Bengaluru stream in the radio directory;
// if none is found the card simply opens the station's website. Check the frequencies if you move city.
export const BENGALURU_RADIO = [
  { name: "Radio City", freq: "91.1", match: ["radio city"], site: "https://www.radiocity.in" },
  { name: "Radio Mirchi", freq: "98.3", match: ["mirchi"], site: "https://www.radiomirchi.com" },
  { name: "Red FM", freq: "93.5", match: ["red fm"], site: "https://www.redfmindia.in" },
  { name: "BIG FM", freq: "92.7", match: ["big fm"], site: "https://www.bigfm.in" },
  { name: "Fever 104", freq: "104.0", match: ["fever"], site: "https://www.fever104.com" },
  { name: "Radio Indigo", freq: "91.9", match: ["indigo"], site: "https://www.radioindigo.in" },
  { name: "AIR FM Rainbow", freq: "101.3", match: ["rainbow", "air fm"], site: "https://newsonair.gov.in" },
];

// Known long-running closures (from news reports, Oct 2026). Update as they change.
export const KNOWN_CLOSURES = [
  { road: "Race Course Road", until: "about 4 Dec 2026", note: "closed for white-topping and utility work" },
  { road: "Basavanagara Main Road", until: "about 30 Oct 2026", note: "diverted for canal bridge work" },
];

// Areas offered in the weather picker (approximate centre points).
export const AREAS = [
  { name: "City centre (Majestic)", lat: 12.9767, lon: 77.5713 },
  { name: "Banashankari", lat: 12.9255, lon: 77.5468 },
  { name: "Bellandur", lat: 12.9304, lon: 77.6784 },
  { name: "Electronic City", lat: 12.8452, lon: 77.6602 },
  { name: "Hebbal", lat: 13.0358, lon: 77.5970 },
  { name: "HSR Layout", lat: 12.9116, lon: 77.6389 },
  { name: "Indiranagar", lat: 12.9784, lon: 77.6408 },
  { name: "Jayanagar", lat: 12.9250, lon: 77.5938 },
  { name: "JP Nagar", lat: 12.9063, lon: 77.5857 },
  { name: "Kempegowda Airport", lat: 13.1989, lon: 77.7068 },
  { name: "Kengeri", lat: 12.9077, lon: 77.4838 },
  { name: "Koramangala", lat: 12.9352, lon: 77.6245 },
  { name: "KR Puram", lat: 13.0075, lon: 77.6960 },
  { name: "Malleshwaram", lat: 13.0035, lon: 77.5710 },
  { name: "Marathahalli", lat: 12.9569, lon: 77.7011 },
  { name: "Peenya", lat: 13.0285, lon: 77.5197 },
  { name: "Silk Board", lat: 12.9177, lon: 77.6233 },
  { name: "Whitefield", lat: 12.9698, lon: 77.7500 },
  { name: "Yelahanka", lat: 13.1007, lon: 77.5963 },
];
