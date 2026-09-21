import { useMemo, useState } from "react";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogTitle,
  FormInput,
} from "@viritura/ui";
import { parsePickupDuration } from "../commands/pickupBar";

export function PickupBarDialog({
  meter,
  onClose,
  onCreate,
}: {
  meter: { count: number; unit: number };
  onClose: () => void;
  onCreate: (duration: string) => void;
}): React.JSX.Element {
  const [duration, setDuration] = useState("1/4");
  const error = useMemo(() => {
    const parsed = parsePickupDuration(duration);
    if (!parsed) return "Enter a positive fraction such as 1/4.";
    if (parsed.numerator / parsed.denominator >= meter.count / meter.unit) {
      return `Pickup duration must be shorter than ${meter.count}/${meter.unit}.`;
    }
    return null;
  }, [duration, meter]);

  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>Create Pickup Bar</DialogTitle>
      <DialogBody>
        <p>
          Opening meter: {meter.count}/{meter.unit}
        </p>
        <FormInput
          large
          value={duration}
          aria-label="Pickup duration"
          onChange={(event) => setDuration(event.target.value)}
          placeholder="e.g. 1/4 or 5/8"
          list="pickup-duration-presets"
        />
        <datalist id="pickup-duration-presets">
          <option value="1/8" />
          <option value="1/4" />
          <option value="3/8" />
          <option value="1/2" />
          <option value="3/4" />
        </datalist>
        {error && <p role="alert">{error}</p>}
      </DialogBody>
      <DialogActions>
        <DialogCancelButton />
        <DialogPrimaryButton disabled={error !== null} onClick={() => onCreate(duration.trim())}>
          Create Pickup Bar
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
