import { scorePageSetupRole, type PageSetupOverride, type PageSetupRole, type Score } from "@viritura/core";
import { produce } from "../score/scoreClone";
import { readPageLayer, type ProfileScope } from "./pageScope";

function uniqueProfileId(score: Score, name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "profile";
  const taken = new Set((score.layoutProfiles ?? []).map((profile) => profile.id));
  let id = `profile-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `profile-${slug}-${n}`;
  return id;
}

/** Add a named profile, optionally seeded from another profile's values. */
export function createLayoutProfile(
  score: Score,
  role: PageSetupRole,
  name: string,
  seed?: ProfileScope,
): { score: Score; profile: ProfileScope } {
  const id = uniqueProfileId(score, name);
  const pageSetup: PageSetupOverride | undefined = seed ? readPageLayer(score, seed) : undefined;
  const next = produce(score, (draft) => {
    draft.layoutProfiles ??= [];
    draft.layoutProfiles.push({
      id,
      name: name.trim() || "Untitled profile",
      role,
      ...(pageSetup ? { pageSetup: structuredClone(pageSetup) } : {}),
    });
  });
  return { score: next, profile: { kind: "profile", role, id } };
}

export function renameLayoutProfile(score: Score, id: string, name: string): Score {
  const trimmed = name.trim();
  if (!trimmed) return score;
  return produce(score, (draft) => {
    const profile = draft.layoutProfiles?.find((entry) => entry.id === id);
    if (profile) profile.name = trimmed;
  });
}

/** Remove a named profile. Its layouts fall back to the role's default profile and keep their own overrides. */
export function deleteLayoutProfile(score: Score, id: string): Score {
  return produce(score, (draft) => {
    draft.layoutProfiles = draft.layoutProfiles?.filter((profile) => profile.id !== id);
    if (!draft.layoutProfiles?.length) delete draft.layoutProfiles;
    for (const view of draft.scores ?? []) {
      if (view.layoutProfile === id) delete view.layoutProfile;
    }
  });
}

/** Point a layout at a profile of its own role. Its overrides are kept. */
export function assignLayoutProfile(score: Score, index: number, profile: ProfileScope): Score {
  return produce(score, (draft) => {
    const view = draft.scores?.[index];
    if (!view) return;
    if (profile.id) view.layoutProfile = profile.id;
    else delete view.layoutProfile;
  });
}

/** Change whether a layout is treated as a score or a part. Its profile resets to the new role's default. */
export function setLayoutRole(score: Score, index: number, role: PageSetupRole): Score {
  if (scorePageSetupRole(score, index) === role && score.scores?.[index]?.pageSetupRole === role) return score;
  return produce(score, (draft) => {
    const view = draft.scores?.[index];
    if (!view) return;
    view.pageSetupRole = role;
    delete view.layoutProfile;
  });
}
