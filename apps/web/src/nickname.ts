import { getMeta, setMeta } from "./db.js";

/**
 * The name other people see.
 *
 * Google sign-in hands over a real name, and publishing a deck under it
 * would put that name in front of every user of the library. So the real
 * name is never displayed anywhere: what shows is a nickname the person
 * chose, stored with their account on this device and stamped onto
 * anything they share.
 */

const KEY = "nickname";
const MAX = 40;

export async function getNickname(): Promise<string> {
  return ((await getMeta<string>(KEY)) ?? "").trim().slice(0, MAX);
}

export async function setNickname(name: string): Promise<void> {
  await setMeta(KEY, name.trim().slice(0, MAX));
}

/**
 * The nickname, asking for one when none is set yet — for the moments that
 * cannot proceed anonymously, like putting a deck in the shared library.
 */
export async function requireNickname(): Promise<string> {
  const existing = await getNickname();
  if (existing) return existing;
  const entered = (
    window.prompt("Pick a nickname to share under — your real name is never shown:") ?? ""
  ).trim();
  if (!entered) {
    throw new Error("sharing needs a nickname, so nothing is listed under your real name");
  }
  await setNickname(entered);
  return entered.slice(0, MAX);
}
