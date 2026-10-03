export function typingText(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  const additional = names.length - 2;
  return `${names[0]}, ${names[1]} and ${additional} ${additional === 1 ? "other" : "others"} are typing…`;
}
