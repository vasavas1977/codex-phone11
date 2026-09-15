import { expect, it } from "vitest";
import { normalizeDialInput } from "../lib/sip/dial-input";

it.each([
  ["+66 81-374-9422", "+66813749422"], ["(081) 374 9422", "0813749422"],
  ["tel:+66813749422", "+66813749422"], ["1001", "1001"], ["*9196#", "*9196#"],
  ["", ""], ["+", "+"], ["１２３", "123"],
  ["Call 0813749422", null], ["12+34", null], ["++66", null],
  ["tel:123;ext=42", null], ["1".repeat(65), null],
])("normalizes pasted dial input %s", (input, expected) => {
  expect(normalizeDialInput(input)).toBe(expected);
});
