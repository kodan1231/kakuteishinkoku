import { describe, expect, it } from "vitest";
import {
  editDistance,
  emptyCorrections,
  matchFamilyMember,
  normalizePayee,
  parseCorrections,
  payeeCandidates,
  recordCorrection,
  removeCorrection,
} from "./ocrCorrections";

describe("normalizePayee", () => {
  it("長音・ひらがな・全角半角・空白・小書き文字の違いを無視する", () => {
    expect(normalizePayee("ロハール")).toBe(normalizePayee("ロハル"));
    expect(normalizePayee("ろはる")).toBe(normalizePayee("ロハル"));
    expect(normalizePayee("ﾛﾊﾙ 津田沼")).toBe(normalizePayee("ロハル津田沼"));
    expect(normalizePayee("キャノン")).toBe(normalizePayee("キヤノン"));
  });
});

describe("editDistance", () => {
  it("1文字の違いは1", () => {
    expect(editDistance("ロホル", "ロハル")).toBe(1);
    expect(editDistance("つだめ", "つだぬま")).toBe(2);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("payeeCandidates", () => {
  const corrections = [{ read: "ロホル", corrected: "ロハル", count: 1, updatedAt: "2026-10-01" }];

  it("以前の修正 → 似た過去の支払先 → 読み取り結果の順に並べる", () => {
    expect(payeeCandidates(["ロホル"], corrections, ["ロハル", "順天堂"])).toEqual([
      { name: "ロハル", source: "correction" },
      { name: "ロホル", source: "ocr" },
    ]);
  });

  it("修正記録が無くても、似た過去の支払先を候補にする", () => {
    expect(payeeCandidates(["ロハール"], [], ["ロハル"])).toEqual([
      { name: "ロハル", source: "past" },
      { name: "ロハール", source: "ocr" },
    ]);
    expect(payeeCandidates(["つだめ頭痛・脳神経外科クリニック"], [], ["つだぬま頭痛・脳神経外科クリニック"])[0]).toEqual({
      name: "つだぬま頭痛・脳神経外科クリニック",
      source: "past",
    });
  });

  it("似ていない支払先は候補にしない", () => {
    expect(payeeCandidates(["順天堂医院"], [], ["日本調剤 新浦安薬局"])).toEqual([{ name: "順天堂医院", source: "ocr" }]);
  });

  it("短い名前は1文字違いまで", () => {
    expect(payeeCandidates(["ABC"], [], ["AXY"]).map((c) => c.source)).toEqual(["ocr"]);
  });
});

describe("matchFamilyMember", () => {
  const family = [
    { id: "k", name: "小段圭司" },
    { id: "a", name: "小段あゆみ" },
  ];

  it("空白・様・ひらがなカタカナの違いを無視して一致させる", () => {
    expect(matchFamilyMember("小段 あゆみ 様", family)).toBe("a");
    expect(matchFamilyMember("小段 アユミ", family)).toBe("a");
    expect(matchFamilyMember("小段圭司", family)).toBe("k");
  });

  it("名前だけの表記でも1人に決まれば一致させる", () => {
    expect(matchFamilyMember("あゆみ", family)).toBe("a");
  });

  it("苗字だけなど1人に決まらない・該当しない場合は null", () => {
    expect(matchFamilyMember("小段", family)).toBeNull();
    expect(matchFamilyMember("山田太郎", family)).toBeNull();
    expect(matchFamilyMember("", family)).toBeNull();
  });
});

describe("recordCorrection", () => {
  it("修正の組を記録し、同じ組なら回数を増やす", () => {
    let data = recordCorrection(emptyCorrections(), "ロホル", "ロハル", "t1");
    data = recordCorrection(data, " ロホル ", "ロハル", "t2");
    expect(data.corrections).toEqual([{ read: "ロホル", corrected: "ロハル", count: 2, updatedAt: "t2" }]);
  });

  it("表記ゆれだけの違いや空欄は記録しない", () => {
    expect(recordCorrection(emptyCorrections(), "ロハール", "ロハル", "t").corrections).toEqual([]);
    expect(recordCorrection(emptyCorrections(), "", "ロハル", "t").corrections).toEqual([]);
  });

  it("削除できる", () => {
    const data = recordCorrection(emptyCorrections(), "ロホル", "ロハル", "t");
    expect(removeCorrection(data, "ロホル", "ロハル").corrections).toEqual([]);
  });
});

describe("parseCorrections", () => {
  it("壊れた内容は空として扱う", () => {
    expect(parseCorrections("{壊れた").corrections).toEqual([]);
    expect(parseCorrections('{"corrections":[{"read":"a","corrected":"b","count":1,"updatedAt":""},{"x":1}]}').corrections).toHaveLength(1);
  });
});
