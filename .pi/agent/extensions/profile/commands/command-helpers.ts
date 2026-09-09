export function requireArgument(args: string[], index: number, usage: string): string {
  const value = args[index];
  if (!value) throw new Error(usage);
  return value;
}
