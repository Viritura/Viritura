import { useCallback } from "react";
import type {
  DynamicGroup,
  DynamicPrefix,
  DynamicSuffix,
  DynamicValue,
  MultiStaffOrientation,
  WedgeType,
} from "@viritura/core";

/** Applies one mutation to the currently selected dynamic group. */
type UpdateSelectedDynamic = (update: (dynamic: DynamicGroup) => void) => void;

/** Field editors the inspector exposes for one standard MNX dynamic group. */
export interface DynamicGroupHandlers {
  handleDynamicValueChange: (value: DynamicValue | undefined) => void;
  handleDynamicResidualValueChange: (value: DynamicValue | undefined) => void;
  handleDynamicAccentPrefixChange: (value: DynamicPrefix) => void;
  handleDynamicAccentSuffixChange: (value: DynamicSuffix) => void;
  handleDynamicRelativeValueChange: (value: "louder" | "softer") => void;
  handleDynamicWedgeTypeChange: (value: WedgeType) => void;
  handleDynamicPrefixChange: (value: string) => void;
  handleDynamicSuffixChange: (value: string) => void;
  handleDynamicOrientationChange: (value: MultiStaffOrientation | undefined) => void;
  handleDynamicStaffChange: (value: number | undefined) => void;
  handleDynamicStaffEndChange: (value: number | undefined) => void;
  handleDynamicVisuallyContinuesChange: (value: string) => void;
  handleDynamicVoiceChange: (value: string) => void;
}

/**
 * Field editors for the selected dynamic group.
 *
 * Every handler clears its field rather than writing an empty value, so the
 * serialized group stays minimal and MNX defaults keep applying.
 */
export function useDynamicGroupHandlers(updateSelectedDynamic: UpdateSelectedDynamic): DynamicGroupHandlers {
  const handleDynamicValueChange = useCallback(
    (value: DynamicValue | undefined) =>
      updateSelectedDynamic((dynamic) => {
        if (value === undefined && dynamic.type === "gradual") delete dynamic.value;
        else if (value !== undefined) dynamic.value = value;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicResidualValueChange = useCallback(
    (value: DynamicValue | undefined) =>
      updateSelectedDynamic((dynamic) => {
        if (value === undefined) delete dynamic.residualValue;
        else dynamic.residualValue = value;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicAccentPrefixChange = useCallback(
    (value: DynamicPrefix) =>
      updateSelectedDynamic((dynamic) => {
        // "s" is the MNX default, so it is never written out.
        if (value === "s") delete dynamic.accentPrefix;
        else dynamic.accentPrefix = value;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicAccentSuffixChange = useCallback(
    (value: DynamicSuffix) =>
      updateSelectedDynamic((dynamic) => {
        // "z" is the MNX default, so it is never written out.
        if (value === "z") delete dynamic.accentSuffix;
        else dynamic.accentSuffix = value;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicRelativeValueChange = useCallback(
    (value: "louder" | "softer") => updateSelectedDynamic((dynamic) => (dynamic.relativeValue = value)),
    [updateSelectedDynamic],
  );
  const handleDynamicWedgeTypeChange = useCallback(
    (value: WedgeType) => updateSelectedDynamic((dynamic) => (dynamic.wedgeType = value)),
    [updateSelectedDynamic],
  );
  const handleDynamicPrefixChange = useCallback(
    (value: string) =>
      updateSelectedDynamic((dynamic) => {
        if (value) dynamic.prefix = value;
        else delete dynamic.prefix;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicSuffixChange = useCallback(
    (value: string) =>
      updateSelectedDynamic((dynamic) => {
        if (value) dynamic.suffix = value;
        else delete dynamic.suffix;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicOrientationChange = useCallback(
    (value: MultiStaffOrientation | undefined) =>
      updateSelectedDynamic((dynamic) => {
        if (value === undefined) delete dynamic.orient;
        else dynamic.orient = value;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicStaffChange = useCallback(
    (value: number | undefined) =>
      updateSelectedDynamic((dynamic) => {
        if (value === undefined) delete dynamic.staff;
        else dynamic.staff = value;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicStaffEndChange = useCallback(
    (value: number | undefined) =>
      updateSelectedDynamic((dynamic) => {
        if (value === undefined) delete dynamic.staffEnd;
        else dynamic.staffEnd = value;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicVisuallyContinuesChange = useCallback(
    (value: string) =>
      updateSelectedDynamic((dynamic) => {
        if (value) dynamic.visuallyContinues = value;
        else delete dynamic.visuallyContinues;
      }),
    [updateSelectedDynamic],
  );
  const handleDynamicVoiceChange = useCallback(
    (value: string) =>
      updateSelectedDynamic((dynamic) => {
        if (value) dynamic.voice = value;
        else delete dynamic.voice;
      }),
    [updateSelectedDynamic],
  );

  return {
    handleDynamicValueChange,
    handleDynamicResidualValueChange,
    handleDynamicAccentPrefixChange,
    handleDynamicAccentSuffixChange,
    handleDynamicRelativeValueChange,
    handleDynamicWedgeTypeChange,
    handleDynamicPrefixChange,
    handleDynamicSuffixChange,
    handleDynamicOrientationChange,
    handleDynamicStaffChange,
    handleDynamicStaffEndChange,
    handleDynamicVisuallyContinuesChange,
    handleDynamicVoiceChange,
  };
}
