export function markPerformance(name: string): PerformanceMark {
  performance.clearMarks(name);
  return performance.mark(name);
}

export function measurePerformance(name: string, startMark: string, endMark: string): PerformanceMeasure {
  performance.clearMeasures(name);
  return performance.measure(name, startMark, endMark);
}
