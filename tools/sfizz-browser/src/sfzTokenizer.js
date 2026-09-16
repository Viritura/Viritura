const opcodePattern = /(^|[\s\r\n])([A-Za-z_][A-Za-z0-9_]*)=/g;
const headerPattern = /<[A-Za-z_][A-Za-z0-9_]*>/g;

export function parseSfzOpcodes(text) {
  const sanitized = stripLineComments(text);
  rejectUnsupportedDirectives(sanitized);
  const headers = collectHeaders(sanitized);
  const opcodes = collectOpcodes(text, sanitized, headers);
  return { headers, opcodes };
}

function stripLineComments(text) {
  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "/" && text[index + 1] === "/") {
      output += "  ";
      index += 2;
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") {
        output += " ";
        index += 1;
      }
      index -= 1;
      continue;
    }
    output += text[index];
  }
  return output;
}

function rejectUnsupportedDirectives(sanitized) {
  const lines = sanitized.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("#")) {
      throw new Error(`Unsupported SFZ directive on line ${index + 1}: ${trimmed}`);
    }
  }
}

function collectHeaders(sanitized) {
  validateHeaderDelimiters(sanitized);
  return [...sanitized.matchAll(headerPattern)].map((match) => ({
    end: match.index + match[0].length,
    name: match[0].slice(1, -1).toLowerCase(),
    start: match.index,
  }));
}

function validateHeaderDelimiters(sanitized) {
  for (let index = 0; index < sanitized.length; index += 1) {
    if (sanitized[index] !== "<") {
      continue;
    }
    const end = sanitized.indexOf(">", index + 1);
    const lineEnd = findLineEnd(sanitized, index);
    if (end === -1 || end > lineEnd) {
      throw new Error("Malformed SFZ header");
    }
    const name = sanitized.slice(index + 1, end);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Malformed SFZ header <${name}>`);
    }
  }
}

function findLineEnd(text, start) {
  const newline = text.indexOf("\n", start);
  return newline === -1 ? text.length : newline;
}

function collectOpcodes(original, sanitized, headers) {
  const opcodeStarts = findOpcodeStarts(sanitized);
  const boundaries = [...headers.map((header) => header.start), ...opcodeStarts.map((opcode) => opcode.start)].sort(
    (left, right) => left - right,
  );
  return opcodeStarts.map((opcode, index) => {
    const valueEnd = findNextBoundary(boundaries, opcode.valueStart);
    return buildOpcode(original, sanitized, opcode, valueEnd ?? original.length, index);
  });
}

function findOpcodeStarts(sanitized) {
  const starts = [];
  for (const match of sanitized.matchAll(opcodePattern)) {
    const leading = match[1].length;
    starts.push({
      name: match[2].toLowerCase(),
      start: match.index + leading,
      valueStart: match.index + leading + match[2].length + 1,
    });
  }
  return starts;
}

function findNextBoundary(boundaries, valueStart) {
  return boundaries.find((boundary) => boundary > valueStart);
}

function buildOpcode(original, sanitized, opcode, rawEnd, ordinal) {
  let valueStart = opcode.valueStart;
  let valueEnd = rawEnd;
  while (valueStart < valueEnd && /\s/.test(sanitized[valueStart])) {
    valueStart += 1;
  }
  while (valueEnd > valueStart && /\s/.test(sanitized[valueEnd - 1])) {
    valueEnd -= 1;
  }
  return {
    name: opcode.name,
    ordinal,
    start: opcode.start,
    value: original.slice(valueStart, valueEnd),
    valueEnd,
    valueStart,
  };
}
