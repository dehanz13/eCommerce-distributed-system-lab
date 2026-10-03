/** Encode one literal argument for a POSIX shell, including nested remote shell commands. */
export const quoteShell = (value: string) => "'" + value.replaceAll("'", `'"'"'`) + "'";
