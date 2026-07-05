import { WeeklyPrompt } from "../types/weeklyPrompt";

// Local seed data. Keep shape API-compatible for future remote fetch replacement.
export const WEEKLY_PROMPTS: WeeklyPrompt[] = [
  {
    id: "wp-2026-02-09",
    weekStart: "2026-02-09",
    title: "小さく続く習慣",
    prompt:
      "今週、仕事や生活の質を上げるために毎日繰り返せる小さな習慣を1つ挙げるとしたら何ですか？",
    why: "小さな継続は、たまの気合いよりも早く積み上がります。",
    action: "実行のきっかけと最低行動を1つずつ決めましょう。",
  },
  {
    id: "wp-2026-02-16",
    weekStart: "2026-02-16",
    title: "エネルギー棚卸し",
    prompt:
      "先週、エネルギーが増えた活動と消耗した活動は何でしたか？今週はどう調整しますか？",
    why: "集中力は有限なので、エネルギーを基準にすると実行力が上がります。",
    action: "消耗する作業を1つ減らし、回復する時間を1つ守りましょう。",
  },
  {
    id: "wp-2026-02-23",
    weekStart: "2026-02-23",
    title: "仮説より検証",
    prompt:
      "今あなたが置いている前提は何ですか？それを検証または否定するために、今週どんな証拠を集めますか？",
    why: "根拠が明確になると、判断のズレを早く修正できます。",
    action: "小さな検証を1つ設計して、結果を記録しましょう。",
  },
  {
    id: "wp-2026-03-02",
    weekStart: "2026-03-02",
    title: "再利用できる学び",
    prompt:
      "今週の気づきのうち、未来の自分やチームが再利用できる知見にするべきものは何ですか？",
    why: "記録された学びは、次の意思決定のレバレッジになります。",
    action: "将来の判断を助ける短いノートを1つ書きましょう。",
  },
];
