import { describe, expect, it } from "vitest";
import { defaultTaxYear, filingDeadline, selectableYears } from "./taxYear";

describe("filingDeadline", () => {
  it("3月15日が平日ならその日", () => {
    expect(filingDeadline(2026)).toEqual(new Date(2027, 2, 15)); // 月曜
  });

  it("土曜なら17日、日曜なら16日", () => {
    expect(filingDeadline(2024)).toEqual(new Date(2025, 2, 17)); // 2025/3/15 は土曜
    expect(filingDeadline(2025)).toEqual(new Date(2026, 2, 16)); // 2026/3/15 は日曜
  });
});

describe("defaultTaxYear", () => {
  it("1月1日から申告期限までは前年", () => {
    expect(defaultTaxYear(new Date(2027, 0, 1))).toBe(2026);
    expect(defaultTaxYear(new Date(2027, 2, 15, 23, 59))).toBe(2026);
    expect(defaultTaxYear(new Date(2026, 2, 16, 12, 0))).toBe(2025);
  });

  it("申告期限の翌日からは今年", () => {
    expect(defaultTaxYear(new Date(2027, 2, 16))).toBe(2027);
    expect(defaultTaxYear(new Date(2026, 2, 17))).toBe(2026);
    expect(defaultTaxYear(new Date(2026, 11, 31))).toBe(2026);
  });
});

describe("selectableYears", () => {
  it("今年から5年前までを新しい順に返す", () => {
    expect(selectableYears(new Date(2026, 9, 22))).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });
});
