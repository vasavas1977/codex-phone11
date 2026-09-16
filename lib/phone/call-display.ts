import { internationalHistoryNumber } from "./phone-number";
import { deviceContactName, type DeviceContact } from "./device-contacts";

/** Presentation only. Never feed this value back into SIP routing. */
export function callDisplayNumber(value: string | undefined): string {
  let text = (value || "").trim();
  const uri = text.match(/<?sips?:([^@;>?\s]+)(?:[^>]*)/i);
  if (uri) {
    try {
      text = decodeURIComponent(uri[1]);
    } catch {
      text = uri[1];
    }
  } else {
    text = text.replace(/^tel:/i, "").split(/[;?]/)[0];
    if (text.includes("@")) text = text.split("@")[0];
  }
  // Do not render a malformed URI or host as caller identity.
  if (!text || /[:<>@/]/.test(text)) return "Unknown caller";
  return internationalHistoryNumber(text);
}

export function callDisplayIdentity(
  number: string | undefined,
  remoteName: string | undefined,
  contacts: DeviceContact[],
) {
  const displayNumber = callDisplayNumber(number);
  const contactName = deviceContactName(contacts, displayNumber);
  const name = remoteName?.trim();
  const friendlyName =
    name &&
    !/[<@>]|sips?:|tel:/i.test(name) &&
    !/^[+\d\s().-]+$/.test(name) &&
    !/^(unknown|anonymous)$/i.test(name)
      ? name
      : undefined;
  return {
    title: contactName || friendlyName || displayNumber,
    number: displayNumber,
  };
}
