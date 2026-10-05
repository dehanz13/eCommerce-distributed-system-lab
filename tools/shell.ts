/** Encode one literal argument for a POSIX shell, including nested remote shell commands.
 * Input: value, from a literal argument selected by the operations adapter.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export const quoteShell = (value: string) => "'" + value.replaceAll("'", `'"'"'`) + "'";
