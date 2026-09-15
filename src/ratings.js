const STRIP = new Set([
  "fc",
  "cf",
  "afc",
  "cfc",
  "ud",
  "cd",
  "rcd",
  "sad",
  "ssc",
  "fsv",
  "tsv",
  "vfb",
  "vfl",
  "sbv",
  "pec",
  "ado",
  "club",
  "calcio",
  "hotspur",
  "de",
  "da",
  "do",
  "del",
  "the",
  "and",
]);

export function normTeam(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’.]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STRIP.has(w) && !/^\d+$/.test(w))
    .join(" ")
    .trim();
}

function hashJitter(value) {
  let h = 2166136261;
  for (const ch of String(value || "")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 41) - 20;
}

const ELO = Object.create(null);

function team(elo, ...names) {
  for (const name of names) {
    const n = normTeam(name);
    if (n) ELO[n] = elo;
  }
}

const LEAGUES = [
  { re: /premier league|epl/i, elo: 1680, goals: 2.85 },
  { re: /primera|laliga|la liga/i, elo: 1660, goals: 2.62 },
  { re: /serie a/i, elo: 1650, goals: 2.55 },
  { re: /bundesliga/i, elo: 1640, goals: 3.05 },
  { re: /ligue 1/i, elo: 1620, goals: 2.72 },
  { re: /eredivisie/i, elo: 1540, goals: 3.12 },
  { re: /championship/i, elo: 1480, goals: 2.55 },
  { re: /primeira liga|liga portugal/i, elo: 1560, goals: 2.58 },
  { re: /brasileiro|serie a brazil|brazil/i, elo: 1600, goals: 2.48 },
  { re: /libertadores/i, elo: 1580, goals: 2.45 },
  { re: /champions league|ucl/i, elo: 1780, goals: 2.92 },
  { re: /europa/i, elo: 1680, goals: 2.7 },
  { re: /ligue 2|segunda|serie b/i, elo: 1450, goals: 2.4 },
  { re: /liga portugal 2|eredivisie/i, elo: 1480, goals: 2.7 },
];

export function leagueProfile(league) {
  const raw = String(league || "");
  for (const row of LEAGUES) {
    if (row.re.test(raw)) return { elo: row.elo, goals: row.goals };
  }
  return { elo: 1520, goals: 2.62 };
}

team(1945, "Real Madrid CF", "real madrid");
team(1910, "FC Barcelona", "barcelona", "barca");
team(1830, "Club Atlético de Madrid", "atletico madrid", "atletico de madrid");
team(1720, "Athletic Club", "athletic bilbao", "athletic");
team(1700, "Villarreal CF", "villarreal");
team(1675, "Real Betis Balompié", "real betis", "betis");
team(1680, "Real Sociedad de Fútbol", "real sociedad");
team(1580, "RC Celta de Vigo", "celta vigo", "celta");
team(1575, "Valencia CF", "valencia");
team(1590, "Sevilla FC", "sevilla");
team(1560, "CA Osasuna", "osasuna");
team(1555, "Rayo Vallecano de Madrid", "rayo vallecano", "rayo");
team(1525, "Getafe CF", "getafe");
team(1520, "RCD Espanyol de Barcelona", "espanyol");
team(1505, "Deportivo Alavés", "alaves");
team(1470, "Levante UD", "levante");
team(1460, "Elche CF", "elche");
team(1455, "RC Deportivo La Coruña", "deportivo la coruna", "deportivo");
team(1435, "Real Racing Club de Santander", "racing santander", "racing de santander");
team(1420, "Málaga CF", "malaga");
team(1620, "Girona FC", "girona");
team(1530, "RCD Mallorca", "mallorca");
team(1510, "Real Valladolid CF", "valladolid");
team(1495, "UD Las Palmas", "las palmas");
team(1485, "CD Leganés", "leganes");

team(1910, "Arsenal FC", "arsenal");
team(1905, "Liverpool FC", "liverpool");
team(1920, "Manchester City FC", "manchester city", "man city");
team(1710, "Manchester United FC", "manchester united", "man united");
team(1785, "Chelsea FC", "chelsea");
team(1740, "Aston Villa FC", "aston villa");
team(1735, "Newcastle United FC", "newcastle united", "newcastle");
team(1710, "Tottenham Hotspur FC", "tottenham");
team(1680, "Nottingham Forest FC", "nottingham forest");
team(1670, "Brighton & Hove Albion FC", "brighton");
team(1610, "AFC Bournemouth", "bournemouth");
team(1600, "Brentford FC", "brentford");
team(1605, "Crystal Palace FC", "crystal palace");
team(1590, "West Ham United FC", "west ham united", "west ham");
team(1580, "Everton FC", "everton");
team(1565, "Wolverhampton Wanderers FC", "wolverhampton", "wolves");
team(1550, "Leeds United FC", "leeds united", "leeds");
team(1485, "Burnley FC", "burnley");
team(1540, "Fulham FC", "fulham");

team(1540, "Ipswich Town FC", "ipswich town", "ipswich");
team(1535, "Southampton FC", "southampton");
team(1520, "Coventry City FC", "coventry city", "coventry");
team(1510, "Middlesbrough FC", "middlesbrough");
team(1505, "Sheffield United FC", "sheffield united");
team(1500, "West Bromwich Albion FC", "west bromwich albion", "west brom");
team(1490, "Norwich City FC", "norwich city", "norwich");
team(1480, "Bristol City FC", "bristol city");
team(1475, "Watford FC", "watford");
team(1470, "Millwall FC", "millwall");
team(1465, "Birmingham City FC", "birmingham city", "birmingham");
team(1460, "Derby County FC", "derby county", "derby");
team(1455, "Queens Park Rangers FC", "queens park rangers", "qpr");
team(1450, "Stoke City FC", "stoke city", "stoke");
team(1450, "Swansea City AFC", "swansea city", "swansea");
team(1445, "Hull City AFC", "hull city", "hull");
team(1445, "Blackburn Rovers FC", "blackburn rovers", "blackburn");
team(1440, "Preston North End FC", "preston north end", "preston");
team(1440, "Portsmouth FC", "portsmouth");
team(1435, "Wrexham AFC", "wrexham");
team(1430, "Charlton Athletic FC", "charlton athletic", "charlton");
team(1425, "Cardiff City FC", "cardiff city", "cardiff");
team(1410, "Bolton Wanderers FC", "bolton wanderers", "bolton");
team(1390, "Lincoln City FC", "lincoln city", "lincoln");
team(1480, "Leicester City FC", "leicester city", "leicester");
team(1460, "Sunderland AFC", "sunderland");

team(1880, "FC Internazionale Milano", "internazionale milano", "inter", "inter milan");
team(1840, "SSC Napoli", "napoli");
team(1860, "Juventus FC", "juventus");
team(1800, "AC Milan", "milan");
team(1740, "AS Roma", "roma");
team(1710, "SS Lazio", "lazio");
team(1750, "Atalanta BC", "atalanta");
team(1680, "ACF Fiorentina", "fiorentina");
team(1670, "Bologna FC 1909", "bologna");
team(1600, "Torino FC", "torino");
team(1570, "Udinese Calcio", "udinese");
team(1560, "Como 1907", "como");
team(1555, "Genoa CFC", "genoa");
team(1520, "Cagliari Calcio", "cagliari");
team(1510, "Parma Calcio 1913", "parma");
team(1505, "US Sassuolo Calcio", "sassuolo");
team(1480, "AC Monza", "monza");
team(1465, "Venezia FC", "venezia");
team(1450, "Frosinone Calcio", "frosinone");
team(1540, "Hellas Verona FC", "hellas verona", "verona");
team(1510, "US Lecce", "lecce");
team(1490, "Empoli FC", "empoli");

team(1950, "FC Bayern München", "bayern munchen", "bayern munich", "bayern");
team(1810, "Borussia Dortmund", "dortmund");
team(1760, "Bayer 04 Leverkusen", "bayer leverkusen", "leverkusen");
team(1740, "RB Leipzig", "leipzig");
team(1700, "Eintracht Frankfurt", "frankfurt");
team(1690, "VfB Stuttgart", "stuttgart");
team(1640, "SC Freiburg", "freiburg");
team(1600, "Borussia Mönchengladbach", "borussia monchengladbach", "gladbach");
team(1580, "SV Werder Bremen", "werder bremen", "werder");
team(1575, "1. FSV Mainz 05", "mainz 05", "mainz");
team(1560, "1. FC Union Berlin", "union berlin");
team(1540, "FC Augsburg", "augsburg");
team(1520, "1. FC Köln", "koln", "cologne");
team(1510, "Hamburger SV", "hamburger sv", "hamburg");
team(1530, "VfL Wolfsburg", "wolfsburg");
team(1500, "TSG 1899 Hoffenheim", "hoffenheim");
team(1480, "1. FC Heidenheim 1846", "heidenheim");
team(1470, "FC St. Pauli 1910", "st pauli");

team(1960, "Paris Saint-Germain FC", "paris saint germain", "psg");
team(1760, "AS Monaco FC", "monaco");
team(1740, "Lille OSC", "lille");
team(1720, "Olympique Lyonnais", "lyon");
team(1730, "Olympique de Marseille", "marseille");
team(1680, "Racing Club de Lens", "lens");
team(1640, "Stade Rennais FC 1901", "stade rennais", "rennes");
team(1660, "OGC Nice", "nice");
team(1630, "RC Strasbourg Alsace", "strasbourg alsace", "strasbourg");
team(1560, "Toulouse FC", "toulouse");
team(1540, "FC Nantes", "nantes");
team(1500, "FC Lorient", "lorient");
team(1490, "Le Havre AC", "le havre");
team(1475, "Angers SCO", "angers");
team(1465, "Paris FC", "paris fc");
team(1440, "ES Troyes AC", "troyes");
team(1410, "Le Mans FC", "le mans");
team(1580, "Stade Brestois 29", "brest");
team(1520, "Montpellier HSC", "montpellier");
team(1510, "Stade de Reims", "reims");
team(1480, "AJ Auxerre", "auxerre");

team(1800, "PSV", "psv eindhoven");
team(1760, "Feyenoord Rotterdam", "feyenoord");
team(1720, "AFC Ajax", "ajax");
team(1660, "AZ", "az alkmaar");
team(1620, "FC Twente '65", "twente");
team(1580, "FC Utrecht", "utrecht");
team(1520, "SC Heerenveen", "heerenveen");
team(1510, "Sparta Rotterdam", "sparta rotterdam");
team(1500, "FC Groningen", "groningen");
team(1480, "Fortuna Sittard", "fortuna sittard");
team(1470, "PEC Zwolle", "zwolle");
team(1460, "Willem II Tilburg", "willem ii");
team(1450, "SBV Excelsior", "excelsior");
team(1440, "SC Cambuur-Leeuwarden", "cambuur leeuwarden", "cambuur");
team(1435, "ADO Den Haag", "ado den haag", "den haag");
team(1410, "Telstar 1963", "telstar");
team(1490, "Go Ahead Eagles", "go ahead eagles");
team(1475, "NEC Nijmegen", "nec");

team(1810, "Sporting Clube de Portugal", "sporting clube portugal", "sporting lisbon", "sporting cp");
team(1800, "FC Porto", "porto");
team(1790, "SL Benfica", "benfica");
team(1680, "SC Braga", "braga");
team(1520, "FC Famalicão", "famalicao");
team(1480, "Rio Ave FC", "rio ave");
team(1475, "Gil Vicente FC", "gil vicente");
team(1460, "FC Arouca", "arouca");
team(1450, "CD Nacional", "nacional");
team(1440, "CS Marítimo", "maritimo");
team(1420, "FC Alverca", "alverca");
team(1540, "Vitória SC", "vitoria guimaraes");
team(1500, "Casa Pia AC", "casa pia");

team(1770, "SE Palmeiras", "palmeiras");
team(1760, "CR Flamengo", "flamengo");
team(1700, "Botafogo FR", "botafogo");
team(1680, "São Paulo FC", "sao paulo");
team(1670, "CA Mineiro", "atletico mineiro", "atletico mg", "mineiro");
team(1600, "CAR Independiente del Valle", "independiente del valle", "independiente valle");
team(1650, "Fluminense FC", "fluminense");
team(1640, "SC Corinthians Paulista", "corinthians");
team(1630, "SC Internacional", "internacional");
team(1620, "Grêmio FBPA", "gremio");
team(1580, "CR Vasco da Gama", "vasco da gama", "vasco");
team(1560, "Santos FC", "santos");
team(1480, "Mirassol FC", "mirassol");
team(1470, "Coritiba FBC", "coritiba");
team(1420, "Chapecoense AF", "chapecoense");
team(1400, "Clube do Remo", "remo");
team(1600, "CAR Independiente del Valle", "independiente del valle");
team(1580, "LDU de Quito", "ldu quito");
team(1620, "Estudiantes de La Plata", "estudiantes");
team(1480, "CA Platense", "platense");
team(1660, "Club Atlético River Plate", "river plate");
team(1650, "Club Atlético Boca Juniors", "boca juniors");

team(1720, "Al Ahly SC", "al ahly");
team(1640, "Zamalek SC", "zamalek");
team(1680, "Mamelodi Sundowns FC", "mamelodi sundowns", "sundowns");
team(1660, "Espérance Sportive de Tunis", "esperance tunis", "esperance");
team(1650, "Wydad Athletic Club", "wydad");
team(1630, "Raja Club Athletic", "raja casablanca", "raja");
team(1600, "TP Mazembe", "mazembe");
team(1620, "Pyramids FC", "pyramids");
team(1590, "Renaissance Sportive de Berkane", "rs berkane", "berkane");
team(1580, "Orlando Pirates", "orlando pirates");
team(1570, "Young Africans SC", "young africans", "yanga");
team(1560, "Kaizer Chiefs", "kaizer chiefs");
team(1550, "ASEC Mimosas", "asec");
team(1580, "AS FAR Rabat", "far rabat");

export function teamElo(name, league) {
  const n = normTeam(name);
  if (n && ELO[n] != null) return ELO[n];
  if (n) {
    const parts = n.split(" ");
    if (parts.length >= 2) {
      const short = parts.slice(0, 2).join(" ");
      if (ELO[short] != null) return ELO[short];
    }
    if (parts.length >= 1 && ELO[parts[0]] != null && parts[0].length > 3) return ELO[parts[0]];
  }
  return leagueProfile(league).elo + hashJitter(n);
}

export function knownTeam(name) {
  const n = normTeam(name);
  if (!n) return false;
  if (ELO[n] != null) return true;
  const parts = n.split(" ");
  return parts.length >= 2 && ELO[parts.slice(0, 2).join(" ")] != null;
}
