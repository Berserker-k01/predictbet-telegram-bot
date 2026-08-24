const BY_ID = {
  57: "Emirates Stadium",
  58: "Villa Park",
  61: "Stamford Bridge",
  62: "Goodison Park",
  63: "Craven Cottage",
  64: "Anfield",
  65: "Etihad Stadium",
  66: "Old Trafford",
  67: "St. James' Park",
  73: "Tottenham Hotspur Stadium",
  76: "Molineux Stadium",
  328: "Turf Moor",
  338: "King Power Stadium",
  340: "St Mary's Stadium",
  341: "Elland Road",
  346: "Vicarage Road",
  349: "Portman Road",
  351: "The City Ground",
  354: "Selhurst Park",
  356: "Bramall Lane",
  389: "Kenilworth Road",
  397: "American Express Stadium",
  402: "Gtech Community Stadium",
  563: "London Stadium",
  1044: "Vitality Stadium",
  71: "Stadium of Light",
  86: "Santiago Bernabéu",
  81: "Spotify Camp Nou",
  78: "Riyadh Air Metropolitano",
  90: "Real Sociedad — Reale Arena",
  94: "Villarreal — Estadio de la Cerámica",
  95: "Valencia — Mestalla",
  559: "Sevilla — Ramón Sánchez-Pizjuán",
  5: "Bayern Munich — Allianz Arena",
  4: "Borussia Dortmund — Signal Iduna Park",
  3: "Bayer Leverkusen — BayArena",
  18: "Borussia Mönchengladbach — Borussia-Park",
  11: "VfL Wolfsburg — Volkswagen Arena",
  19: "Eintracht Frankfurt — Deutsche Bank Park",
  12: "Werder Bremen — Weserstadion",
  16: "FC Augsburg — WWK Arena",
  2: "TSG Hoffenheim — PreZero Arena",
  15: "1. FSV Mainz 05 — Mewa Arena",
  10: "VfB Stuttgart — MHPArena",
  17: "SC Freiburg — Europa-Park Stadion",
  28: "1. FC Union Berlin — Stadion An der Alten Försterei",
  36: "RB Leipzig — Red Bull Arena",
  109: "Juventus — Allianz Stadium",
  108: "Inter — Stadio Giuseppe Meazza",
  98: "AC Milan — Stadio Giuseppe Meazza",
  113: "Napoli — Stadio Diego Armando Maradona",
  100: "AS Roma — Stadio Olimpico",
  110: "Lazio — Stadio Olimpico",
  102: "Atalanta — Gewiss Stadium",
  99: "Fiorentina — Stadio Artemio Franchi",
  107: "Genoa — Stadio Luigi Ferraris",
  115: "Udinese — Bluenergy Stadium",
  103: "Bologna — Stadio Renato Dall'Ara",
  106: "Torino — Stadio Olimpico Grande Torino",
  524: "Parc des Princes",
  516: "Orange Vélodrome",
  548: "Stade Louis-II",
  523: "Groupama Stadium",
  521: "Decathlon Arena",
  522: "Allianz Riviera",
  529: "Roazhon Park",
  543: "Stade de la Beaujoire",
  556: "Stade Pierre-Mauroy",
  511: "Stade de l'Aube",
  512: "Stade Francis-Le Blé",
  518: "Stade de la Mosson",
  525: "Stade Louis-Fonteneau",
  526: "Matmut Atlantique",
  527: "Stade Saint-Symphorien",
  532: "Stade Bollaert-Delelis",
  533: "Stade de la Meinau",
  541: "Stadium de Toulouse",
  545: "Stade Geoffroy-Guichard",
  547: "Stade de Reims",
  576: "Stade de la Meinau",
  721: "Stade de l'Abbé-Deschamps",
  1040: "Stade Auguste-Delaune",
};

const BY_NAME = {
  "fulham fc": "Craven Cottage",
  fulham: "Craven Cottage",
  "chelsea fc": "Stamford Bridge",
  chelsea: "Stamford Bridge",
  "arsenal fc": "Emirates Stadium",
  arsenal: "Emirates Stadium",
  "liverpool fc": "Anfield",
  liverpool: "Anfield",
  "manchester city fc": "Etihad Stadium",
  "manchester city": "Etihad Stadium",
  "manchester united fc": "Old Trafford",
  "manchester united": "Old Trafford",
  "tottenham hotspur fc": "Tottenham Hotspur Stadium",
  tottenham: "Tottenham Hotspur Stadium",
  "newcastle united fc": "St. James' Park",
  "aston villa fc": "Villa Park",
  "west ham united fc": "London Stadium",
  "brighton & hove albion fc": "American Express Stadium",
  "crystal palace fc": "Selhurst Park",
  "nottingham forest fc": "The City Ground",
  "afc bournemouth": "Vitality Stadium",
  "brentford fc": "Gtech Community Stadium",
  "wolverhampton wanderers fc": "Molineux Stadium",
  "everton fc": "Goodison Park",
  "leeds united fc": "Elland Road",
  "burnley fc": "Turf Moor",
  "sunderland afc": "Stadium of Light",
  "paris saint-germain fc": "Parc des Princes",
  "olympique de marseille": "Orange Vélodrome",
  "olympique lyonnais": "Groupama Stadium",
};

function norm(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPlaceholder(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v || v === "—" || v === "-" || v === "n/a" || v === "na") return true;
  return /a confirmer|à confirmer|a designer|à désigner|tbd|unknown|to be (announced|confirmed)|stade a confirmer|venue tbc/.test(
    v,
  );
}

export function resolveStadium(m) {
  const raw = m?.stadium || m?.venue || m?.venueName || m?.ground || m?.home?.stadium || m?.home?.venue;
  if (raw && !isPlaceholder(raw)) return String(raw).trim();
  const id = Number(m?.home?.id);
  if (id && BY_ID[id]) {
    const val = String(BY_ID[id]);
    const cut = val.lastIndexOf(" — ");
    return cut >= 0 ? val.slice(cut + 3) : val;
  }
  const name = norm(m?.home?.name);
  return BY_NAME[name] || "";
}

export function resolveReferee(m) {
  const raw = m?.referee || m?.refereeName;
  if (!raw || isPlaceholder(raw)) return "";
  return String(raw).trim();
}
