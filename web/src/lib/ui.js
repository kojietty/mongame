/** 表示ヘルパ(レア度クラスなど)。 */
export const rarityTextClass = (name) => "r-" + name;      // r-N / r-R / r-SR / r-UR
export const ringClass = (name) => (name === "N" ? "" : "ring-" + name); // 発光リング(R以上)
export const stripTags = (s) => s.replace(/<[^>]+>/g, "");
