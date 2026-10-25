import { useNavigate } from "react-router";
import { handOffPhoto } from "../lib/ocr";
import { buttonClass } from "./Layout";

/** 「撮影して入力」「手入力で入力」の2つの入口 */
export function StartRecord() {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className={`${buttonClass} cursor-pointer text-center`}>
        撮影して入力
        {/* capture を付けないことで、iPhone ではカメラと写真ライブラリのどちらも選べる */}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            handOffPhoto(file);
            navigate("/records/new?photo=1");
          }}
        />
      </label>
      <button type="button" className={buttonClass} onClick={() => navigate("/records/new")}>
        手入力で入力
      </button>
    </div>
  );
}
