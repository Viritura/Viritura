import type { Root as RawScore } from "@viritura/core/raw";
import type { PartMeasureExtensions } from "@viritura/core/raw-viritura";

export function validateHarpPedals(score: RawScore) {
  const errors: { pointer: string; message: string; keyword: string }[] = [];
  const ids = new Set<string>();
  score.parts.forEach((part, partIndex) => {
    part.measures.forEach((measure, measureIndex) => {
      const ext = measure._x?.["viritura"] as PartMeasureExtensions | undefined;
      const positions: Array<readonly [number, number]> = [];
      ext?.harpPedals?.forEach((setting, settingIndex) => {
        const pointer = `/parts/${partIndex}/measures/${measureIndex}/_x/viritura/harpPedals/${settingIndex}`;
        if (ids.has(setting.id)) {
          errors.push({ pointer: `${pointer}/id`, message: "must be a unique harp setting ID", keyword: "uniqueId" });
        }
        ids.add(setting.id);
        const fraction = setting.position.fraction;
        const [numerator, denominator] = fraction;
        if (numerator === undefined || denominator === undefined || denominator === 0) {
          errors.push({
            pointer: `${pointer}/position`,
            message: "must have a positive denominator",
            keyword: "range",
          });
          return;
        }
        if (positions.some(([n, d]) => BigInt(n) * BigInt(denominator) === BigInt(numerator) * BigInt(d))) {
          errors.push({
            pointer: `${pointer}/position`,
            message: "must not repeat another harp setting's position in this part measure",
            keyword: "uniquePosition",
          });
        }
        positions.push([numerator, denominator]);
        if (setting.staff !== undefined && setting.staff > (part.staves ?? 1)) {
          errors.push({
            pointer: `${pointer}/staff`,
            message: "must reference a staff of this part",
            keyword: "reference",
          });
        }
      });
    });
  });
  return errors;
}
