import { WeeklyPromptsPayload } from "../types/weeklyPrompt";

export const WEEKLY_PROMPTS_FALLBACK: WeeklyPromptsPayload = {
  version: 1,
  timezone: "Asia/Tokyo",
  updatedAt: "2026-02-28T02:00:00+09:00",
  prompts: [
    {
      weekStart: "2026-02-09",
      id: "2026-02-09",
      title: "小さく続く習慣",
      prompt:
        "今週、仕事や生活の質を上げるために毎日繰り返せる小さな習慣を1つ挙げるとしたら何ですか？",
      why: "小さな継続は、たまの気合いよりも早く積み上がります。",
      action: "実行のきっかけと最低行動を1つずつ決めましょう。",
      status: "published",
    },
    {
      weekStart: "2026-02-16",
      id: "2026-02-16",
      title: "エネルギー棚卸し",
      prompt:
        "先週、エネルギーが増えた活動と消耗した活動は何でしたか？今週はどう調整しますか？",
      why: "集中力は有限なので、エネルギーを基準にすると実行力が上がります。",
      action: "消耗する作業を1つ減らし、回復する時間を1つ守りましょう。",
      status: "published",
    },
    {
      weekStart: "2026-02-23",
      id: "2026-02-23",
      title: "仮説より検証",
      prompt:
        "今あなたが置いている前提は何ですか？それを検証または否定するために、今週どんな証拠を集めますか？",
      why: "根拠が明確になると、判断のズレを早く修正できます。",
      action: "小さな検証を1つ設計して、結果を記録しましょう。",
      status: "published",
    },
    {
      weekStart: "2026-03-02",
      id: "2026-03-02",
      title: "忙しさは本物か",
      prompt: "あなたの今週の忙しさは、本当に重要なことか？",
      why: "優先順位の再確認は、行動の質を一段引き上げます。",
      action: "今週やらないことを1つ決めて、集中先を明確にしましょう。",
      status: "published",
    },
  ],
};
