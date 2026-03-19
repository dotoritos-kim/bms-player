/**
 * Simple className utility.
 * Joins class names, filtering out falsy values.
 */
export function cn(...inputs: (string | undefined | null | false | 0)[]): string {
  return inputs.filter(Boolean).join(' ');
}
