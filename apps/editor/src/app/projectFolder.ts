export const FOLDER_PROJECT_UNAVAILABLE_MESSAGE =
  "Local project folders are not available here. Open Viritura in Chrome or Edge, or use the desktop app when it becomes available.";

interface WindowWithDirectoryPicker {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
}

export function getDirectoryPicker(): WindowWithDirectoryPicker["showDirectoryPicker"] {
  if (typeof window === "undefined") return undefined;
  const picker = (window as unknown as WindowWithDirectoryPicker).showDirectoryPicker;
  return typeof picker === "function" ? picker : undefined;
}

export function isFolderProjectSupported(): boolean {
  return getDirectoryPicker() !== undefined;
}

export function getProjectFolderNameError(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a project name.";
  if (name === "." || name === "..") return "Choose a project name other than “.” or “..”.";
  if ([...name].some((character) => character.charCodeAt(0) < 32) || /[<>:"/\\|?*]/.test(name)) {
    return 'Project names cannot contain control characters or any of: < > : " / \\ | ? *';
  }
  if (name.endsWith(".")) return "Project names cannot end with a period.";
  return null;
}

export async function createProjectDirectory(
  parent: FileSystemDirectoryHandle,
  projectName: string,
): Promise<FileSystemDirectoryHandle> {
  const name = projectName.trim();
  const validationError = getProjectFolderNameError(name);
  if (validationError) throw new Error(validationError);

  let alreadyExists = false;
  try {
    await parent.getDirectoryHandle(name);
    alreadyExists = true;
  } catch (err) {
    if ((err as DOMException)?.name !== "NotFoundError") throw err;
  }
  if (alreadyExists) {
    throw new Error(`A folder named “${name}” already exists. Choose a different project name.`);
  }

  return parent.getDirectoryHandle(name, { create: true });
}
