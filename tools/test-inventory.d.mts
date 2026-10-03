export interface Assertion {
  fullName?: string;
  title?: string;
  status: string;
  duration?: number;
  startTime?: number;
  endTime?: number;
}
export interface TestResult {
  testResults?: { name: string; assertionResults?: Assertion[] }[];
}
export function inventory(
  result: TestResult,
  root: string,
): { file: string; name: string; status: string; durationMs: number | null }[];
export function writeInventory(input?: string): Promise<void>;
