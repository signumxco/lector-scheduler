export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function optionalEnv(name: string, fallback = ''): string {
  return Deno.env.get(name) || fallback;
}
