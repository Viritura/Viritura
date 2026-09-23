import { useMemo } from "react";
import { Globe2, LockKeyhole } from "lucide-react";
import { Combobox, type ComboboxOption } from "@viritura/ui";
import type { CreatedGitHubRepository } from "../../github/api";

interface GitHubRepositoryComboboxProps {
  readonly value: string;
  readonly repositories: readonly CreatedGitHubRepository[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}

export function GitHubRepositoryCombobox(props: GitHubRepositoryComboboxProps) {
  const options = useMemo<ComboboxOption[]>(
    () =>
      props.repositories.map((repository) => ({
        id: String(repository.id),
        label: repository.fullName,
        icon: repository.private ? (
          <LockKeyhole size={14} aria-hidden="true" />
        ) : (
          <Globe2 size={14} aria-hidden="true" />
        ),
        trailingLabel: repository.private ? "Private" : "Public",
      })),
    [props.repositories],
  );

  return (
    <Combobox
      value={props.value}
      options={options}
      onValueChange={props.onChange}
      ariaLabel="Accessible GitHub repositories"
      placeholder="Search repositories or paste a GitHub URL"
      loading={props.loading}
      loadingMessage="Loading repositories"
      error={props.error}
      emptyMessage="No accessible repositories match this search."
    />
  );
}
