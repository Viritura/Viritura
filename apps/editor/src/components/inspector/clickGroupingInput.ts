export function parseClickGroupingInput(input: string): number[] | undefined {
  const text = input.trim();
  const groups: number[] = [];
  let index = 0;

  while (index < text.length) {
    const start = index;
    while (index < text.length && isDigit(text.charAt(index))) index += 1;
    if (index === start) return undefined;
    groups.push(Number(text.slice(start, index)));
    if (index === text.length) return groups;

    let hasWhitespace = false;
    while (index < text.length && isWhitespace(text.charAt(index))) {
      hasWhitespace = true;
      index += 1;
    }

    if (text.charAt(index) === "+" || text.charAt(index) === ",") {
      index += 1;
      while (index < text.length && isWhitespace(text.charAt(index))) index += 1;
    } else if (!hasWhitespace) {
      return undefined;
    }
  }

  return undefined;
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isWhitespace(character: string): boolean {
  return /\s/.test(character);
}
