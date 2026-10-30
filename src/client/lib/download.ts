/**
 * ファイルを端末に保存する。スマホは共有メニュー（「ファイルに保存」「画像を保存」など）、PC はダウンロード。
 * 共有メニューは画面の操作の直後でないと開けないため、ボタンを押したときに呼ぶ。
 */
export async function saveToDevice(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // 共有できなければダウンロードにする
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
