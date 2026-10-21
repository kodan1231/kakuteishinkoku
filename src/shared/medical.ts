/** 医療費控除の明細書・医療費集計フォームで使う区分 */
export const MEDICAL_CATEGORIES = [
  "診療・治療",
  "医薬品購入",
  "介護保険サービス",
  "その他の医療費",
] as const;

export type MedicalCategory = (typeof MEDICAL_CATEGORIES)[number];
