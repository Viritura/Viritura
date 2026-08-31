import type { ReactNode } from "react";
import { Button, GlassCard, Text, VirituraLogo } from "@viritura/ui";
import { Check, FileMusic, LockKeyhole, MousePointer2, PencilLine, ShieldCheck, type LucideIcon } from "lucide-react";
import type { OAuthConsentData } from "./oauthConsentData";
import styles from "./OAuthConsentPage.module.css";

interface OAuthConsentPageProps {
  readonly data: OAuthConsentData;
}

interface PermissionDetails {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const PERMISSIONS: Readonly<Record<string, PermissionDetails>> = {
  "score:read": {
    title: "Read the open score",
    description: "View its notation, structure, parts, and measures.",
    icon: FileMusic,
  },
  "selection:read": {
    title: "Read your current selection",
    description: "View the notes and measures currently selected in the editor.",
    icon: MousePointer2,
  },
  "score:propose": {
    title: "Propose score changes",
    description: "Create reviewable suggestions that you can accept or reject.",
    icon: PencilLine,
  },
};

const FALLBACK_PERMISSION: PermissionDetails = {
  title: "Use an additional capability",
  description: "Access the requested Viritura feature.",
  icon: Check,
};

export function OAuthConsentPage({ data }: OAuthConsentPageProps) {
  return (
    <main className={styles.page}>
      <VirituraLogo markSize={27} wordmarkWidth={112} className={styles.logo} />
      <GlassCard className={styles.card}>
        <div className={styles.content}>
          <span className={styles.requestMark} aria-hidden="true">
            <ShieldCheck />
          </span>
          <Text variant="eyebrow" tone="accent" className={styles.eyebrow}>
            External client access
          </Text>
          <Text variant="display" className={styles.title}>
            Allow access to Viritura?
          </Text>
          <Text variant="body" tone="muted" className={styles.lede}>
            <strong>{data.clientName}</strong> wants to connect to the score open in your editor.
          </Text>

          <Text variant="small" as="h2" tone="bright" className={styles.permissionHeading} id="permissions-heading">
            Requested permissions
          </Text>
          <ul className={styles.permissions} aria-labelledby="permissions-heading">
            {data.scopes.map((scope) => {
              const permission = PERMISSIONS[scope] ?? FALLBACK_PERMISSION;
              const PermissionIcon = permission.icon;
              return (
                <li key={scope} className={styles.permission}>
                  <span className={styles.permissionIcon} aria-hidden="true">
                    <PermissionIcon />
                  </span>
                  <span>
                    <Text variant="small" as="span" tone="bright" className={styles.permissionTitle}>
                      {permission.title}
                    </Text>
                    <Text variant="small" as="span" tone="muted" className={styles.permissionDescription}>
                      {permission.description}
                    </Text>
                  </span>
                </li>
              );
            })}
          </ul>

          <Text variant="small" tone="muted" className={styles.safetyNote}>
            <LockKeyhole aria-hidden="true" />
            <span>
              Access is limited to this editor session and expires after one hour. Proposed changes still require your
              approval in Viritura.
            </span>
          </Text>
        </div>

        <div className={styles.actions}>
          <ConsentForm data={data} decision="deny">
            <Button type="submit" size="lg" fullWidth>
              Deny
            </Button>
          </ConsentForm>
          <ConsentForm data={data} decision="allow">
            <Button type="submit" size="lg" variant="primary" fullWidth>
              Allow access
            </Button>
          </ConsentForm>
        </div>
      </GlassCard>
    </main>
  );
}

function ConsentForm({
  data,
  decision,
  children,
}: {
  readonly data: OAuthConsentData;
  readonly decision: "allow" | "deny";
  readonly children: ReactNode;
}) {
  return (
    <form method="post" action={data.action} className={styles.form}>
      {data.fields.map((field, index) => (
        <input key={`${field.name}-${index}`} type="hidden" name={field.name} value={field.value} />
      ))}
      <input type="hidden" name="decision" value={decision} />
      {children}
    </form>
  );
}
