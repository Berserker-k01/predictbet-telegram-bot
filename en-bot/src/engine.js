import { predictMatch, predictLive } from "./model.js";
import { liveElo, loadClubElo } from "./clubelo.js";
import { loadOdds, lookupMarket } from "./odds.js";
import { loadFootballData, lookupTeamStats } from "./football-data.js";

export async function refreshEngine(config, matches = []) {
  await Promise.all([loadClubElo(), loadOdds(config, matches), loadFootballData(config, matches)]);
}

export function predictFixture(match) {
  return predictMatch(match, {
    eloLookup: (name) => liveElo(name, match?.league || match?.leagueId),
    market: lookupMarket(match),
    stats: lookupTeamStats(match),
  });
}

export function predictFixtureLive(match, score, minute) {
  return predictLive(match, score, minute, {
    eloLookup: (name) => liveElo(name, match?.league || match?.leagueId),
    stats: lookupTeamStats(match),
  });
}
