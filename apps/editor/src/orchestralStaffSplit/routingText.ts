export type PlayerRouting =
  | { readonly kind: "players"; readonly players: readonly number[] }
  | { readonly kind: "all"; readonly count: number };

const PLAYER_TOKEN = "(?:1|2|3|I|II|III)";
const SEPARATED_PLAYERS = new RegExp(`^(${PLAYER_TOKEN})\\.?\\s*(?:,|/|&)\\s*(${PLAYER_TOKEN})\\.?$`, "i");
const DOTTED_ROMAN_PLAYERS = /^(I{1,3})\.\s*(I{1,3})\.$/i;

/** Parse a complete player-routing expression without consuming ordinary expressive text. */
export function parsePlayerRoutingLabel(text: string): PlayerRouting | null {
  const value = text.trim();
  if (value.length === 0) return null;

  const allMatch = /^(?:a|à)\.?\s*([23])\.?$/i.exec(value);
  if (allMatch) return { kind: "all", count: Number(allMatch[1]) };

  const singleMatch = new RegExp(`^(${PLAYER_TOKEN})\\.?$`, "i").exec(value);
  if (singleMatch) return { kind: "players", players: [playerNumber(singleMatch[1]!)] };

  const explicitMatch = SEPARATED_PLAYERS.exec(value) ?? DOTTED_ROMAN_PLAYERS.exec(value);
  if (!explicitMatch) return null;

  const players = [...new Set([playerNumber(explicitMatch[1]!), playerNumber(explicitMatch[2]!)])].sort(
    (left, right) => left - right,
  );
  return { kind: "players", players };
}

function playerNumber(token: string): number {
  if (/^\d$/.test(token)) return Number(token);
  return token.toUpperCase().length;
}
