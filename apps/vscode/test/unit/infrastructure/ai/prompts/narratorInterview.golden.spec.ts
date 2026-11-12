import { describe, expect, it } from "vitest"

import {
  NarratorInterviewDistillPrompt,
  NarratorInterviewQuestionPrompt,
  coerceNarratorInterviewDistill,
  coerceNarratorInterviewQuestion,
  type NarratorInterviewVoice
} from "@storyboard/story-ai"

const narrator: NarratorInterviewVoice = {
  name: "하나의 시점",
  person: "3인칭",
  knowledge: "목격 범위",
  tense: "과거형",
  focal: "하나",
  voice: ["감정은 사물로 비춘다"]
}

describe("narrator interview prompts", () => {
  it("renders the question prompt", () => {
    expect(
      NarratorInterviewQuestionPrompt.build({
        narrator,
        sceneTitle: "등대의 밤",
        situation: "하나가 등대 문을 연다",
        priorAnswers: ["한 걸음 물러서 담담하게 적는다"],
        optionCount: 3
      })
    ).toMatchSnapshot()
  })

  it("renders the distill prompt", () => {
    expect(
      NarratorInterviewDistillPrompt.build({
        narrator,
        answers: [{ situation: "하나가 등대 문을 연다", answer: "손끝만 비춘다" }]
      })
    ).toMatchSnapshot()
  })

  it("reads a question with at least two distinct options and the voice lines", () => {
    expect(coerceNarratorInterviewQuestion({ question: "어떻게?", options: [{ text: "가" }, { text: "가" }] })).toBeUndefined()
    expect(coerceNarratorInterviewQuestion({ question: "어떻게?", options: [{ text: "가" }, "나"] })).toEqual({
      question: "어떻게?",
      options: ["가", "나"]
    })
    expect(coerceNarratorInterviewDistill({ voice: [" 짧게 끊는다 ", "짧게 끊는다", 3] })).toEqual(["짧게 끊는다"])
  })
})
