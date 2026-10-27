import {
  type Option,
  type OptionLink,
  type SealContext,
  decrypt,
  encrypt,
  isSealed,
} from "@decisionator/core";

/** Reads a sealed string; plaintext written by older versions is returned unchanged. */
async function open(value: string, key: CryptoKey, context: SealContext): Promise<string> {
  if (!isSealed(value)) return value;
  return decrypt(value, key, context);
}

type OptionText = Pick<Option, "title" | "description" | "category" | "tags" | "pros" | "cons"> & {
  links: OptionLink[];
};

/**
 * Applies `fn` to every user-content string of an option (title, description, category, tags,
 * pros, cons, link titles and URLs) and leaves the rest (id, order, status, effort, stamps) as is.
 * Each string gets the seal context of its place (`["option", id, field, index?, part?]`), so a
 * sealed value moved to another option or field no longer decrypts. Fields absent from `o` stay
 * absent, so it works on partial updates too (arrays are always written whole).
 */
async function mapOptionText<T extends Partial<OptionText> & { id?: string }>(
  o: T,
  fn: (value: string, context: SealContext) => Promise<string>
): Promise<T> {
  if (typeof o.id !== "string" || o.id === "") {
    throw new Error("Option id required to seal or open option text");
  }
  const id = o.id;
  const out = { ...o };
  const list = (field: string, values: string[]) =>
    Promise.all(values.map((v, i) => fn(v, ["option", id, field, i])));
  if (typeof o.title === "string") out.title = await fn(o.title, ["option", id, "title"]);
  if (typeof o.description === "string") {
    out.description = await fn(o.description, ["option", id, "description"]);
  }
  if (typeof o.category === "string") {
    out.category = await fn(o.category, ["option", id, "category"]);
  }
  if (Array.isArray(o.tags)) out.tags = await list("tags", o.tags);
  if (Array.isArray(o.pros)) out.pros = await list("pros", o.pros);
  if (Array.isArray(o.cons)) out.cons = await list("cons", o.cons);
  if (Array.isArray(o.links)) {
    out.links = await Promise.all(
      o.links.map(async (link, i) => ({
        ...(typeof link.title === "string"
          ? { title: await fn(link.title, ["option", id, "links", i, "title"]) }
          : {}),
        url: await fn(link.url, ["option", id, "links", i, "url"]),
      }))
    );
  }
  return out;
}

/** Encrypts every user-content field of an option of a protected project. */
export function sealOption<T extends Partial<OptionText> & { id?: string }>(
  o: T,
  key: CryptoKey
): Promise<T> {
  return mapOptionText(o, (value, context) => encrypt(value, key, context));
}

/** Decrypts what `sealOption` encrypted; plaintext from older versions reads back unchanged. */
export function openOption<T extends Partial<OptionText> & { id?: string }>(
  o: T,
  key: CryptoKey
): Promise<T> {
  return mapOptionText(o, (value, context) => open(value, key, context));
}
