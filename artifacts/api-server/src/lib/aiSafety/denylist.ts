/**
 * Maintained denylist for AI generation prompts.
 *
 * Add a line, add a test row in aiSafety.test.ts. Entries are matched on
 * whole-word boundaries against the normalized prompt (lowercase, accents
 * stripped, apostrophes removed, punctuation and hyphens turned into spaces),
 * so write them that way: "levis", "spider man", "louis vuitton".
 *
 * Why these exist: image models will happily reproduce a famous person's face,
 * a fashion house's logo or a cartoon character. App Store Review Guideline
 * 5.2 (intellectual property) and the Google Play Impersonation / IP policies
 * make the publisher responsible for that output.
 */

/** Names distinctive enough to block on sight in a media prompt. */
export const BRAND_DENYLIST: readonly string[] = [
  // Apparel / footwear / luxury
  "nike", "adidas", "puma", "reebok", "new balance", "under armour", "converse", "vans", "air jordan", "jordan brand",
  "asics", "fila", "lululemon", "gymshark", "skims", "fashion nova", "shein", "zara", "h&m",
  "uniqlo", "levis", "carhartt", "patagonia", "the north face", "north face",
  "off white", "bape", "a bathing ape", "stussy", "yeezy", "fear of god",
  "gucci", "prada", "chanel", "louis vuitton", "dior", "christian dior", "birkin", "balenciaga", "versace",
  "burberry", "fendi", "givenchy", "saint laurent", "yves saint laurent", "valentino", "armani", "dolce and gabbana",
  "dolce gabbana", "moncler", "canada goose", "stone island", "ralph lauren", "tommy hilfiger", "calvin klein",
  "lacoste", "hugo boss", "michael kors", "kate spade", "tory burch", "bottega veneta",
  "loewe", "miu miu", "alexander mcqueen", "vetements", "rolex", "cartier", "swarovski",
  "ray ban", "oakley", "louboutin", "christian louboutin", "jimmy choo", "manolo blahnik", "timberland", "ugg", "crocs",
  "birkenstock", "dr martens", "hollister", "abercrombie", "american eagle", "urban outfitters", "victorias secret",
  // Tech / consumer / entertainment / sport leagues
  "iphone", "macbook", "airpods", "samsung", "netflix", "spotify", "tesla", "facebook", "instagram", "tiktok",
  "youtube", "snapchat", "whatsapp", "playstation", "xbox", "nintendo", "starbucks", "mcdonalds", "coca cola",
  "pepsi", "red bull", "monster energy", "budweiser", "jack daniels", "disney", "pixar", "marvel", "dc comics",
  "warner bros", "lego", "hasbro", "mattel", "ferrari", "lamborghini", "porsche", "bmw", "mercedes benz",
  "harley davidson", "nfl", "nba", "mlb", "nhl", "fifa", "olympics", "premier league",
];

/**
 * Words that are also ordinary English. Only blocked when they sit near a
 * trademark-context word ("gap logo", "coach bag replica", "logo like guess").
 */
export const AMBIGUOUS_BRAND_DENYLIST: readonly string[] = [
  "apple", "supreme", "tiffany", "celine", "elsa", "gap", "guess", "coach", "next", "fossil", "target", "shell", "polo", "diesel", "hermes", "jordan", "champion",
  "gant", "boss", "lee", "kenzo", "tumi", "element", "obey", "volcom", "quiksilver", "roxy", "billabong", "google",
  "microsoft", "amazon", "twitter", "coke", "wrangler", "columbia", "pandora",
];

/** Words that turn an ambiguous brand word into a trademark request. */
export const TRADEMARK_CONTEXT_WORDS: readonly string[] = [
  "logo", "logos", "trademark", "trademarked", "emblem", "swoosh", "monogram", "branded", "replica",
  "knockoff", "knock off", "counterfeit", "dupe", "inspired by", "in the style of", "copy of",
];

/** Generic phrasing that asks for someone else's mark no matter which brand. */
export const GENERIC_TRADEMARK_PHRASES: readonly string[] = [
  "counterfeit", "knockoff", "knock off", "replica of", "fake designer", "designer logo", "brand logo",
  "famous logo", "copy the logo", "copy this logo", "recreate the logo", "same logo as", "swoosh", "three stripes",
  "double c logo", "lv monogram", "red bottom sole",
];

/** Characters and franchises. */
export const CHARACTER_DENYLIST: readonly string[] = [
  "mickey mouse", "minnie mouse", "donald duck", "winnie the pooh", "pooh bear", "moana",
  "simba", "lion king", "lilo and stitch", "buzz lightyear", "cinderella", "snow white",
  "spider man", "spiderman", "iron man", "captain america", "black panther", "deadpool", "wolverine",
  "avengers", "x men", "batman", "superman", "wonder woman", "harley quinn", "aquaman",
  "darth vader", "yoda", "baby yoda", "grogu", "mandalorian", "star wars", "stormtrooper", "luke skywalker",
  "harry potter", "hogwarts", "hermione", "dumbledore", "gandalf", "frodo", "lord of the rings", "game of thrones",
  "pikachu", "pokemon", "charizard", "super mario", "mario kart", "luigi", "bowser", "princess peach", "sonic the hedgehog",
  "kirby", "donkey kong", "minecraft", "fortnite", "roblox", "among us", "pac man", "angry birds",
  "hello kitty", "sanrio", "kuromi", "my melody", "cinnamoroll", "snoopy", "charlie brown", "garfield",
  "spongebob", "patrick star", "bugs bunny", "daffy duck", "tom and jerry", "scooby doo", "looney tunes", "the simpsons",
  "homer simpson", "bart simpson", "family guy", "south park", "rick and morty", "peppa pig", "paw patrol", "bluey",
  "barbie", "ken doll", "bratz", "care bears", "my little pony", "transformers", "optimus prime", "minions", "despicable me",
  "shrek", "kung fu panda", "naruto", "goku", "dragon ball", "luffy", "sailor moon", "demon slayer",
  "attack on titan", "studio ghibli", "totoro", "spirited away", "jujutsu kaisen", "squid game",
  "stranger things", "hunger games", "teletubbies", "sesame street", "elmo", "cookie monster", "big bird", "grinch",
  "kermit the frog",
];

/** Real people: celebrities, athletes, politicians, creators. Full names only. */
export const PUBLIC_FIGURE_DENYLIST: readonly string[] = [
  // Music
  "taylor swift", "beyonce", "rihanna", "kanye west", "jay z", "kendrick lamar", "travis scott",
  "ariana grande", "selena gomez", "billie eilish", "dua lipa", "olivia rodrigo", "harry styles", "justin bieber",
  "bad bunny", "cardi b", "nicki minaj", "megan thee stallion", "doja cat", "lady gaga", "katy perry",
  "ed sheeran", "the weeknd", "post malone", "eminem", "snoop dogg", "lizzo", "lana del rey",
  "bruno mars", "shakira", "britney spears", "michael jackson", "elvis presley", "freddie mercury",
  "bob marley", "tupac", "frank ocean", "tyler the creator", "asap rocky", "playboi carti",
  // Film / TV
  "zendaya", "tom holland", "timothee chalamet", "margot robbie", "ryan gosling", "emma watson", "emma stone",
  "scarlett johansson", "jennifer lawrence", "anne hathaway", "angelina jolie", "brad pitt", "leonardo dicaprio",
  "tom cruise", "keanu reeves", "robert downey jr", "chris hemsworth", "chris evans", "dwayne johnson",
  "kevin hart", "will smith", "denzel washington", "morgan freeman", "samuel l jackson", "jennifer aniston",
  "sydney sweeney", "jenna ortega", "millie bobby brown", "florence pugh", "pedro pascal", "henry cavill", "idris elba",
  "marilyn monroe", "audrey hepburn", "gal gadot", "ryan reynolds", "hugh jackman",
  // Sports
  "lebron james", "michael jordan", "kobe bryant", "stephen curry", "kevin durant", "giannis antetokounmpo",
  "cristiano ronaldo", "lionel messi", "neymar", "kylian mbappe", "erling haaland", "david beckham", "serena williams",
  "venus williams", "naomi osaka", "roger federer", "rafael nadal", "novak djokovic", "tom brady", "patrick mahomes",
  "travis kelce", "tiger woods", "simone biles", "usain bolt", "conor mcgregor", "mike tyson", "muhammad ali",
  "max verstappen", "lewis hamilton", "caitlin clark", "shohei ohtani",
  // Politics / business / public
  "donald trump", "joe biden", "barack obama", "michelle obama", "kamala harris", "hillary clinton", "bill clinton",
  "george w bush", "vladimir putin", "xi jinping", "kim jong un", "emmanuel macron", "justin trudeau", "narendra modi",
  "boris johnson", "king charles", "prince william", "prince harry", "meghan markle", "queen elizabeth", "pope francis",
  "elon musk", "jeff bezos", "mark zuckerberg", "bill gates", "tim cook", "steve jobs", "sam altman", "warren buffett",
  "oprah winfrey", "martin luther king", "malcolm x", "abraham lincoln", "adolf hitler",
  // Creators / socialites / fashion figures
  "kim kardashian", "kylie jenner", "kendall jenner", "khloe kardashian", "kris jenner", "hailey bieber", "gigi hadid",
  "bella hadid", "kate moss", "naomi campbell", "cara delevingne", "paris hilton", "mrbeast", "mr beast", "pewdiepie",
  "charli damelio", "addison rae", "khaby lame", "logan paul", "jake paul", "ishowspeed", "emma chamberlain",
  "james charles", "huda kattan", "chiara ferragni", "anna wintour", "virgil abloh", "pharrell williams", "tyra banks",
];

/** Phrases that request a real person's likeness without naming them. */
export const LIKENESS_PHRASES: readonly string[] = [
  "deepfake", "deep fake", "face swap", "faceswap", "swap the face", "swap her face", "swap his face",
  "put my face on", "put his face on", "put her face on", "looks exactly like", "lookalike", "look alike of",
  "in the likeness of", "likeness of", "photo of a celebrity", "famous actor", "famous actress", "famous singer",
  "famous rapper", "famous athlete", "famous influencer", "a celebrity", "the president of", "the prime minister of",
  "my ex girlfriend", "my ex boyfriend", "my ex wife", "my ex husband", "my coworker", "my teacher", "my neighbor",
];

export const SEXUAL_TERMS: readonly string[] = [
  "porn", "porno", "pornography", "pornographic", "nsfw", "xxx", "hentai", "erotic", "erotica", "explicit sex", "sex scene",
  "sex act", "having sex", "sexual intercourse", "blowjob", "handjob", "orgy", "bdsm", "genitals", "genitalia", "vagina",
  "penis", "testicles", "nipples", "areola", "topless", "bottomless", "naked", "nudity", "fully nude", "nude woman", "nude man",
  "nude body", "nude model", "nude girl", "nude boy", "nude photo", "nude photos", "nude picture", "nudes",
  "camel toe", "upskirt", "cumshot", "onlyfans", "fetish", "dominatrix", "stripper",
];

export const VIOLENCE_TERMS: readonly string[] = [
  "gore", "gory", "beheading", "beheaded", "decapitated", "decapitation", "dismembered", "dismemberment", "mutilated",
  "mutilation", "disemboweled", "torture", "torturing", "mass shooting", "school shooting", "massacre", "genocide",
  "lynching", "execution video", "severed head", "severed limb", "blood splatter", "dead body", "bloody corpse",
  "suicide", "kill myself", "self harm", "cutting myself", "slit wrists", "how to make a bomb", "pipe bomb",
  "terrorist attack", "kill him", "kill her", "kill them", "murder scene", "snuff",
];

export const HATE_TERMS: readonly string[] = [
  "swastika", "nazi flag", "ss bolts", "white power", "heil hitler", "kkk", "ku klux klan", "isis flag", "hate symbol",
  "gas the", "race war",
];

/** Always-block minor-safety terms, regardless of context. */
export const MINOR_ABUSE_TERMS: readonly string[] = [
  "csam", "child porn", "child pornography", "kiddie porn", "loli", "lolicon", "shota", "shotacon", "jailbait",
  "pedophile", "underage sex", "underage nude", "preteen nude",
];

/** Minor words. Combined with SEXUALIZING_TERMS anywhere in the prompt => block. */
export const MINOR_TERMS: readonly string[] = [
  "child", "children", "kid", "kids", "minor", "minors", "underage", "under age", "toddler", "toddlers", "preteen", "pre teen",
  "tween", "teen", "teens", "teenager", "teenagers", "schoolgirl", "schoolboy", "school girl", "school boy", "little girl",
  "little boy", "young girl", "young boy", "baby girl", "infant", "juvenile", "high schooler", "middle schooler",
];

export const SEXUALIZING_TERMS: readonly string[] = [
  "sexy", "sexual", "sexualized", "seductive", "seduce", "erotic", "nude", "naked", "topless", "provocative", "sensual",
  "lingerie", "thong", "lewd", "horny", "bedroom eyes", "naughty", "suggestive", "stripping", "fetish",
];
