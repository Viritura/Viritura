export function formatPageRanges(pages: number[]): string {
  if (pages.length === 0) return "";
  const ranges: string[] = [];
  let start = pages[0]!;
  let end = start;
  for (const page of pages.slice(1)) {
    if (page === end + 1) {
      end = page;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}–${end}`);
    start = page;
    end = page;
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`);
  return ranges.join(", ");
}
