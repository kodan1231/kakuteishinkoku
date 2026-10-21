import { describe, expect, it } from "vitest";
import { buildLedgerRequests, FAMILY_HEADERS, parseFamily, pickFamilySourceYear, validateName } from "./ledger";

describe("validateName", () => {
  it("空欄と11文字以上はエラー", () => {
    expect(validateName("  ")).not.toBeNull();
    expect(validateName("あいうえおかきくけこさ")).not.toBeNull();
  });

  it("10文字までは OK（前後の空白は数えない）", () => {
    expect(validateName(" 国税　太郎 ")).toBeNull();
    expect(validateName("あいうえおかきくけこ")).toBeNull();
  });
});

describe("parseFamily", () => {
  it("削除済みを除いて並び順に並べ、行番号を付ける", () => {
    const { members, problems } = parseFamily([
      FAMILY_HEADERS,
      ["a", "国税　太郎", "本人", 2, false],
      ["b", "国税　花子", "配偶者", 1, false],
      ["c", "削除した人", "子", 3, true],
    ]);
    expect(problems).toEqual([]);
    expect(members.map((m) => [m.id, m.row])).toEqual([
      ["b", 3],
      ["a", 2],
    ]);
  });

  it("見出しの変更と id の重複を検知する", () => {
    const { members, problems } = parseFamily([
      ["id", "名前"],
      ["a", "太郎", "本人", 1, false],
      ["a", "太郎2", "本人", 2, false],
      [],
    ]);
    expect(members).toHaveLength(1);
    expect(problems).toHaveLength(2);
  });

  it("空のシートでも落ちない", () => {
    expect(parseFamily([]).problems).toHaveLength(1);
  });
});

describe("buildLedgerRequests", () => {
  it("4枚のシートを作り、既定のシートを消して、見出しと家族を書き込む", () => {
    const requests = buildLedgerRequests([0], {
      year: 2026,
      family: [{ id: "a", name: "国税　太郎", relationship: "本人", order: 1 }],
      createdAt: "2026-10-22T00:00:00.000Z",
      consentedAt: "2026-10-22T00:00:00.000Z",
    }) as Record<string, any>[];
    const titles = requests.filter((r) => r.addSheet).map((r) => r.addSheet.properties.title);
    expect(titles).toEqual(["医療費", "家族", "設定", "_meta"]);
    expect(requests.find((r) => r.deleteSheet)?.deleteSheet.sheetId).toBe(0);
    const family = requests.find((r) => r.updateCells?.start.sheetId === 1002)?.updateCells;
    expect(family.rows[1].values[1]).toEqual({ userEnteredValue: { stringValue: "国税　太郎" } });
    expect(requests.filter((r) => r.addProtectedRange).every((r) => r.addProtectedRange.protectedRange.warningOnly)).toBe(
      true,
    );
  });
});

describe("pickFamilySourceYear", () => {
  it("前年度を優先し、なければ近い年度", () => {
    expect(pickFamilySourceYear([2024, 2025, 2027], 2026)).toBe(2025);
    expect(pickFamilySourceYear([2023, 2027], 2026)).toBe(2027);
    expect(pickFamilySourceYear([2024, 2028], 2026)).toBe(2024);
  });

  it("他の年度がなければ null", () => {
    expect(pickFamilySourceYear([2026], 2026)).toBeNull();
    expect(pickFamilySourceYear([], 2026)).toBeNull();
  });
});
