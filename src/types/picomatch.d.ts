declare module "picomatch" {
  export default function picomatch(
    patterns: string | string[],
    options?: Record<string, unknown>,
  ): (value: string) => boolean;
}
