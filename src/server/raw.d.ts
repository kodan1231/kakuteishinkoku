// テストでマイグレーション SQL を文字列として読み込むため（Vite の ?raw）
declare module "*?raw" {
  const content: string;
  export default content;
}
