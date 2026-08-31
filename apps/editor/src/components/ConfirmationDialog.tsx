import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
} from "@viritura/ui";

export interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  secondaryLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onSecondary?: () => void;
}

/** Consistent app confirmation surface for potentially destructive workflow transitions. */
export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  secondaryLabel,
  onConfirm,
  onCancel,
  onSecondary,
}: ConfirmationDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogBody>
        <p>{message}</p>
      </DialogBody>
      <DialogActions>
        <DialogCancelButton onClick={onCancel}>{cancelLabel}</DialogCancelButton>
        {secondaryLabel && onSecondary && (
          <DialogSecondaryButton onClick={onSecondary}>{secondaryLabel}</DialogSecondaryButton>
        )}
        <DialogPrimaryButton onClick={onConfirm}>{confirmLabel}</DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
