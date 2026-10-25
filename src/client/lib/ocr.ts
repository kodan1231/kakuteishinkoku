import { useCallback } from "react";
import { OCR_IMAGE_MAX_EDGE, type OcrRequest, type OcrResponse, type OcrUsage } from "../../shared/ocr";
import { useApi } from "./api";
import { resizeToDataUrl } from "./image";

/** 領収書の読み取り API（Worker 経由で Workers AI を呼ぶ） */
export function useOcr() {
  const api = useApi();
  const read = useCallback(
    async (file: File): Promise<OcrResponse> => {
      const body: OcrRequest = { image: await resizeToDataUrl(file, OCR_IMAGE_MAX_EDGE) };
      return api<OcrResponse>("/api/ocr", { method: "POST", body: JSON.stringify(body) });
    },
    [api],
  );
  const usage = useCallback(() => api<OcrUsage>("/api/ocr/usage"), [api]);
  return { read, usage };
}

/**
 * 「撮影して入力」で選んだ写真を記録画面へ渡す。
 * ファイルは履歴の state に入れられないため、画面遷移の間だけここに置く。
 */
let handedOffPhoto: File | null = null;

export function handOffPhoto(file: File): void {
  handedOffPhoto = file;
}

/** 受け取る（StrictMode で初期化が2回呼ばれても同じ写真を返すよう、消すのは clearHandedOffPhoto で行う） */
export function peekHandedOffPhoto(): File | null {
  return handedOffPhoto;
}

export function clearHandedOffPhoto(): void {
  handedOffPhoto = null;
}
