import * as Menubar from "@radix-ui/react-menubar";
import type { MenuItemDef } from "@viritura/ui";
import {
  buildMenuBarMenus,
  type MenuBarCallbacks,
  type MenuBarState,
  type RecentMenuEntry,
  type SampleScore,
} from "./menuBarItems";
import styles from "./MenuBar.module.css";

export type { MenuBarCallbacks, MenuBarState, RecentMenuEntry } from "./menuBarItems";

interface MenuBarProps {
  readonly callbacks: MenuBarCallbacks;
  readonly state?: MenuBarState;
  readonly sampleScores?: readonly SampleScore[];
  /** Recent projects + files for the File → Open Recent submenu. */
  readonly recentEntries?: readonly RecentMenuEntry[];
}

/** Renders a single MenuItemDef as a Radix Menubar item, separator, or sub-menu. */
function RenderItem({ item }: { readonly item: MenuItemDef }) {
  if (item.separator) {
    return <Menubar.Separator className={styles.separator} />;
  }

  if (item.children && item.children.length > 0) {
    return (
      <Menubar.Sub>
        <Menubar.SubTrigger className={styles.menuItem}>
          <span>{item.label}</span>
          <span className={styles.submenuArrow}>&#x25B8;</span>
        </Menubar.SubTrigger>
        <Menubar.Portal>
          <Menubar.SubContent className={styles.submenu} sideOffset={2} alignOffset={-4}>
            {item.children.map((child, i) => (
              <RenderItem key={i} item={child} />
            ))}
          </Menubar.SubContent>
        </Menubar.Portal>
      </Menubar.Sub>
    );
  }

  return (
    <Menubar.Item className={styles.menuItem} disabled={item.disabled} onSelect={item.action}>
      <span>{item.label}</span>
      {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
    </Menubar.Item>
  );
}

export function MenuBar({ callbacks, state = {}, sampleScores = [], recentEntries = [] }: MenuBarProps) {
  const menus = buildMenuBarMenus(callbacks, state, sampleScores, recentEntries);

  return (
    <Menubar.Root className={styles.menuBar} aria-label="Menu bar">
      <span className={styles.appMark} aria-hidden="true">
        <img src="/favicon.svg" alt="" draggable={false} />
      </span>
      {menus.map((menu) => (
        <Menubar.Menu key={menu.id}>
          <Menubar.Trigger className={styles.trigger}>{menu.label}</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className={styles.dropdown} align="start" sideOffset={2}>
              {menu.items.map((item, i) => (
                <RenderItem key={i} item={item} />
              ))}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      ))}
    </Menubar.Root>
  );
}
