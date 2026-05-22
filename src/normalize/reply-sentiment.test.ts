import { describe, expect, it } from "vitest";
import { classifyReplySentiment } from "./reply-sentiment.js";

describe("classifyReplySentiment — 12-case smoke", () => {
  const agree = [
    "lgtm",
    "good catch, will fix",
    "fixed!",
    "동의합니다",
    "완료했습니다",
    "+1",
  ];

  const reject = [
    "this is intentional",
    "by design, won't fix",
    "특수케이스입니다",
    "의도적으로 작성됨",
  ];

  const neutral = ["can you explain more?", "what about the edge case?"];

  for (const body of agree) {
    it(`agree: ${JSON.stringify(body)}`, () => {
      expect(classifyReplySentiment(body)).toBe("agree");
    });
  }

  for (const body of reject) {
    it(`reject: ${JSON.stringify(body)}`, () => {
      expect(classifyReplySentiment(body)).toBe("reject");
    });
  }

  for (const body of neutral) {
    it(`neutral: ${JSON.stringify(body)}`, () => {
      expect(classifyReplySentiment(body)).toBe("neutral");
    });
  }
});

describe("classifyReplySentiment — Korean narrowing regressions", () => {
  it("'수정 필요' is neutral (not agree) — '수정' alone must not match", () => {
    expect(classifyReplySentiment("이 부분 수정 필요해요")).toBe("neutral");
  });

  it("'수정했어요' is agree", () => {
    expect(classifyReplySentiment("수정했어요")).toBe("agree");
  });

  it("'예외처리가 필요' is neutral (not reject) — '예외' alone must not match", () => {
    expect(classifyReplySentiment("이 경우 예외처리가 필요해 보입니다")).toBe(
      "neutral",
    );
  });

  it("'예외 케이스입니다' is reject", () => {
    expect(classifyReplySentiment("이건 예외 케이스입니다")).toBe("reject");
  });
});
