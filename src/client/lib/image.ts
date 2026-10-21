/**
 * 画像を長辺 maxEdge px に縮小して JPEG にする。
 * canvas で再エンコードするため EXIF（位置情報など）は残らない。
 */
export async function resizeToDataUrl(file: Blob, maxEdge: number, quality = 0.85): Promise<string> {
  return (await drawResized(file, maxEdge)).toDataURL("image/jpeg", quality);
}

export async function resizeToBlob(file: Blob, maxEdge: number, quality = 0.8): Promise<Blob> {
  const canvas = await drawResized(file, maxEdge);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を変換できませんでした"))), "image/jpeg", quality),
  );
}

async function drawResized(file: Blob, maxEdge: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas を利用できません");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}
