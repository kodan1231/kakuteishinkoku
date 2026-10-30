import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { MedicalRecord } from "../drive/records";
import { allocate } from "../drive/reimbursements";
import { buildCsv, buildFormRows, buildFormXlsx, fileTimestamp, fillFormSheet, forceRecalc, formDate, type FormRow } from "./medicalForm";

const record = (over: Partial<MedicalRecord>): MedicalRecord => ({
  id: "r",
  date: "2026-01-15",
  personId: "p1",
  personName: "小段圭司",
  payee: "順天堂医院",
  category: "診療・治療",
  amount: 1000,
  reimbursed: 0,
  memo: "",
  receiptFileIds: [],
  source: "manual",
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
  status: "final",
  ...over,
});

const records = [
  record({ id: "b", date: "2026-07-03", personId: "p2", personName: "小段あゆみ", amount: 20000 }),
  record({ id: "a", date: "2026-01-10", amount: 10000, reimbursed: 1000 }),
  record({ id: "c", date: "2026-07-03", personId: "p2", personName: "小段あゆみ", category: "医薬品購入", amount: 3000, createdAt: "2026-07-03T01:00:00.000Z" }),
  record({ id: "d", date: "2026-07-05", personId: "p2", personName: "小段あゆみ", payee: "ロハル薬局", category: "医薬品購入", amount: 500 }),
  record({ id: "x", amount: 99999, status: "draft" }),
];
const allocation = allocate(records, [
  { id: "m", month: "2026-07", personId: "p2", amount: 14600, kind: "健保給付", memo: "", createdAt: "", updatedAt: "" },
]);

describe("buildFormRows", () => {
  it("領収書1件ずつ: 支払日順、補填は記録ごとの補填と配分の合計、一時保存は除く", () => {
    const rows = buildFormRows(records, allocation, "each");
    expect(rows.map((r) => [r.person, r.payee, r.categories, r.amount, r.date])).toEqual([
      ["小段圭司", "順天堂医院", ["診療・治療"], 10000, "2026/1/10"],
      ["小段あゆみ", "順天堂医院", ["診療・治療"], 20000, "2026/7/3"],
      ["小段あゆみ", "順天堂医院", ["医薬品購入"], 3000, "2026/7/3"],
      ["小段あゆみ", "ロハル薬局", ["医薬品購入"], 500, "2026/7/5"],
    ]);
    expect(rows[0].reimbursed).toBe(1000);
    expect(rows.slice(1).reduce((s, r) => s + r.reimbursed, 0)).toBe(14600);
  });

  it("人・支払先ごとにまとめると区分は複数、支払日は空欄", () => {
    const rows = buildFormRows(records, allocation, "grouped");
    expect(rows.map((r) => [r.person, r.payee, r.categories, r.amount, r.date])).toEqual([
      ["小段圭司", "順天堂医院", ["診療・治療"], 10000, ""],
      ["小段あゆみ", "順天堂医院", ["診療・治療", "医薬品購入"], 23000, ""],
      ["小段あゆみ", "ロハル薬局", ["医薬品購入"], 500, ""],
    ]);
  });
});

// テンプレートの入力欄と同じ形（空のセル）を持つ最小のシート
function sheet(rows: number): string {
  const body = Array.from({ length: rows }, (_, i) => {
    const n = 9 + i;
    const cells = ["B", "C", "D", "E", "F", "G"].map((c) => `<c r="${c}${n}" s="6"/>`).join("");
    return `<row r="${n}"><c r="A${n}" s="4"><f>ROW()-8</f><v>${i + 1}</v></c>${cells}<c r="H${n}" s="5"/><c r="I${n}" s="5"/><c r="J${n}" s="40"/></row>`;
  }).join("");
  return `<worksheet><sheetData><row r="3"><c r="C3" s="15" t="str"><f>IF(0=SUM(H9:H1003),"",SUM(H9:H1003))</f><v/></c></row><row r="4"><c r="C4" s="17" t="str"><f>IF(0=SUM(I9:I1003),"",SUM(I9:I1003))</f><v/></c></row>${body}</sheetData></worksheet>`;
}

describe("fillFormSheet", () => {
  const rows: FormRow[] = [
    { person: "小段<圭司>", payee: "A&B病院", categories: ["診療・治療", "その他の医療費"], amount: 1200, reimbursed: 200, date: "2026/1/5" },
    { person: "小段あゆみ", payee: "薬局", categories: ["医薬品購入"], amount: 300, reimbursed: 0, date: "" },
  ];

  it("入力欄に値を入れ、合計の計算結果も入れる", () => {
    const xml = fillFormSheet(sheet(3), rows);
    expect(xml).toContain('<c r="B9" s="6" t="inlineStr"><is><t xml:space="preserve">小段&lt;圭司&gt;</t></is></c>');
    expect(xml).toContain('<c r="C9" s="6" t="inlineStr"><is><t xml:space="preserve">A&amp;B病院</t></is></c>');
    expect(xml).toContain('<c r="D9" s="6" t="inlineStr"><is><t xml:space="preserve">該当する</t></is></c>');
    expect(xml).toContain('<c r="E9" s="6"/>');
    expect(xml).toContain('<c r="G9" s="6" t="inlineStr">');
    expect(xml).toContain('<c r="H9" s="5"><v>1200</v></c>');
    expect(xml).toContain('<c r="I9" s="5"><v>200</v></c>');
    expect(xml).toContain('<c r="J9" s="40" t="inlineStr"><is><t xml:space="preserve">2026/1/5</t></is></c>');
    expect(xml).toContain('<c r="E10" s="6" t="inlineStr">');
    expect(xml).toContain('<c r="I10" s="5"/>');
    expect(xml).toContain('<c r="J10" s="40"/>');
    expect(xml).toContain('<c r="B11" s="6"/>');
    expect(xml).toContain('<c r="C3" s="15"><f>IF(0=SUM(H9:H1003),"",SUM(H9:H1003))</f><v>1500</v></c>');
    expect(xml).toContain('<c r="C4" s="17"><f>IF(0=SUM(I9:I1003),"",SUM(I9:I1003))</f><v>200</v></c>');
  });

  it("入力欄が足りなければエラー", () => {
    expect(() => fillFormSheet(sheet(1), rows)).toThrow("セル B10 が見つかりません");
  });

  it("995件を超えるとエラー", () => {
    expect(() => fillFormSheet(sheet(1), Array.from({ length: 996 }, () => rows[1]))).toThrow("995件まで");
  });
});

describe("buildFormXlsx", () => {
  it("シートとブックだけを書き換え、他のファイルはそのまま残す", () => {
    const template = zipSync({
      "xl/worksheets/sheet1.xml": strToU8(sheet(2)),
      "xl/workbook.xml": strToU8('<workbook><calcPr calcId="191028"/></workbook>'),
      "xl/media/image1.png": new Uint8Array([1, 2, 3]),
    });
    const files = unzipSync(buildFormXlsx(template, [{ person: "本人", payee: "病院", categories: ["診療・治療"], amount: 100, reimbursed: 0, date: "" }]));
    expect(strFromU8(files["xl/worksheets/sheet1.xml"])).toContain('<c r="H9" s="5"><v>100</v></c>');
    expect(strFromU8(files["xl/workbook.xml"])).toBe('<workbook><calcPr calcId="191028" fullCalcOnLoad="1"/></workbook>');
    expect([...files["xl/media/image1.png"]]).toEqual([1, 2, 3]);
  });

  it("再計算の指定は重ねない", () => {
    expect(forceRecalc('<calcPr calcId="1" fullCalcOnLoad="1"/>')).toBe('<calcPr calcId="1" fullCalcOnLoad="1"/>');
  });
});

describe("CSV・ファイル名", () => {
  it("BOM 付き・CRLF、カンマや引用符を含む値は囲む", () => {
    const csv = buildCsv([record({ memo: '通院: 自宅→病院, "往復"', receiptFileIds: ["f1", "f2"] })], allocate([], []));
    expect(csv.startsWith("﻿支払日,医療を受けた人,")).toBe(true);
    expect(csv.split("\r\n")[1]).toBe('2026-01-15,小段圭司,順天堂医院,診療・治療,1000,0,0,0,1000,"通院: 自宅→病院, ""往復""",2');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("日付の書き方", () => {
    expect(formDate("2026-01-05")).toBe("2026/1/5");
    expect(formDate("")).toBe("");
    expect(fileTimestamp(new Date(2026, 9, 30, 9, 5))).toBe("20261030-0905");
  });
});
