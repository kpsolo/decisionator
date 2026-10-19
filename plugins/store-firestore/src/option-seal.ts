import { type Option, type OptionLink, decrypt, encrypt } from "@decisionator/core";

const ENCRYPTED_PREFIX = "enc:v1:";

/** Reads a sealed string; plaintext written by older versions is returned unchanged. */
async function open(value: string, key: CryptoKey): Promise<string> {
  if (typeof value !== "string" || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  return decrypt(value, key);
}

type OptionText = Pick<Option, "title" | "description" | "category" | "tags" | "pros" | "cons"> & {
  links: OptionLink[];
};

/**
 * Applies `fn` to every user-content string of an option (title, description, category, tags,
 * pros, cons, link titles and URLs) and leaves the rest (id, order, status, effort, stamps) as is.
 * Fields absent from `o` stay absent, so it works on partial updates too.
 */
async function mapOptionText<T extends Partial<OptionText>>(
  o: T,
  fn: (value: string) => Promise<string>
): Promise<T> {
  const out = { ...o };
  const list = (values: string[]) => Promise.all(values.map(fn));
  if (typeof o.title === "string") out.title = await fn(o.title);
  if (typeof o.description === "string") out.description = await fn(o.description);
  if (typeof o.category === "string") out.category = await fn(o.category);
  if (Array.isArray(o.tags)) out.tags = await list(o.tags);
  if (Array.isArray(o.pros)) out.pros = await list(o.pros);
  if (Array.isArray(o.cons)) out.cons = await list(o.cons);
  if (Array.isArray(o.links)) {
    out.links = await Promise.all(
      o.links.map(async (link) => ({
        ...(typeof link.title === "string" ? { title: await fn(link.title) } : {}),
        url: await fn(link.url),
      }))
    );
  }
  return out;
}

/** Encrypts every user-content field of an option of a protected project. */
export function sealOption<T extends Partial<OptionText>>(o: T, key: CryptoKey): Promise<T> {
  return mapOptionText(o, (value) => encrypt(value, key));
}

/** Decrypts what `sealOption` encrypted; plaintext from older versions reads back unchanged. */
export function openOption<T extends Partial<OptionText>>(o: T, key: CryptoKey): Promise<T> {
  return mapOptionText(o, (value) => open(value, key));
}
