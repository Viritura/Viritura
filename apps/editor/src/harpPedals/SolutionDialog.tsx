import { type HarpPedalSolution, type HarpPedalSolutionKind, type Score } from "@viritura/core";
import {
  ButtonGroup,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogTitle,
  type ButtonGroupOption,
} from "@viritura/ui";
import { SolutionPreview } from "./SolutionPreview";
import styles from "./HarpPedalPopover.module.css";

const SOLUTION_OPTIONS: ButtonGroupOption<HarpPedalSolutionKind>[] = [
  { value: "no-respelling", label: "No respelling" },
  { value: "suggest-respelling", label: "Suggest respelling" },
  { value: "maximum-respell", label: "Maximum respell" },
];

interface Props {
  solutions: HarpPedalSolution[] | null;
  selectedSolutionKind: HarpPedalSolutionKind | null;
  score: Score | null;
  partIndex: number;
  onSelect: (kind: HarpPedalSolutionKind) => void;
  onClose: () => void;
  onApply: (solution: HarpPedalSolution) => void;
}

export function SolutionDialog({
  solutions,
  selectedSolutionKind,
  score,
  partIndex,
  onSelect,
  onClose,
  onApply,
}: Props) {
  const selectedSolution = solutions?.find((item) => item.kind === selectedSolutionKind);

  return (
    <Dialog open={solutions !== null} onClose={onClose} size="wide">
      <DialogTitle>Calculate harp pedals</DialogTitle>
      <DialogBody className={styles.solutionDialog}>
        {solutions && (
          <>
            <ButtonGroup
              ariaLabel="Harp pedal calculation solution"
              value={selectedSolutionKind ?? solutions[0]!.kind}
              onChange={onSelect}
              options={SOLUTION_OPTIONS.filter((option) => solutions.some((item) => item.kind === option.value))}
            />
            {selectedSolution && <SolutionPreview solution={selectedSolution} score={score} partIndex={partIndex} />}
          </>
        )}
      </DialogBody>
      <DialogActions>
        <DialogCancelButton>Cancel</DialogCancelButton>
        <DialogPrimaryButton onClick={() => selectedSolution && onApply(selectedSolution)}>
          Apply solution
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
