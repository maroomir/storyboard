# Claude Max 구독자를 위한 API 키 발급 안내

Storyboard는 AI 서비스의 **API 키**로 글을 씁니다. 키는 사용자 본인의 것이고, 쓴 만큼의 비용도
사용자가 AI 서비스에 직접 냅니다. Claude 앱을 **Max 요금제**로 구독하고 있다면 그 구독에
매달 API 크레딧이 포함돼 있어, 추가 결제 없이 키를 만들어 Storyboard에 연결할 수 있습니다.

이 문서는 2026년 10월 24일 기준 Anthropic 공식 문서를 따릅니다. 금액과 절차는 바뀔 수 있으니
막히면 문서 끝의 원문 링크를 확인하세요.

## 누가 받을 수 있나

| 요금제    | 매달 받는 API 크레딧 |
| --------- | -------------------- |
| Max 5x    | 100달러              |
| Max 20x   | 200달러              |
| Free, Pro | 해당 없음            |

- 요금제를 **7일 이상** 유지한 뒤부터 받을 수 있습니다.
- 크레딧은 결제 주기마다 새로 들어오고, 쓰지 않은 만큼은 **이월되지 않고 사라집니다**.
- 크레딧은 Claude Console의 API에만 쓰입니다. Claude 앱이나 Claude Code의 사용 한도는 그대로이고,
  반대로 이 크레딧으로 Claude 앱의 추가 사용량을 살 수도 없습니다.

## 1단계: 크레딧 받기

1. 웹 브라우저로 [claude.ai](https://claude.ai)에 로그인합니다. 모바일 앱에서는 되지 않습니다.
2. **Settings > Billing**으로 갑니다.
3. **API credits** 항목에서 크레딧을 받을 **Console 조직**을 고릅니다. Console 조직이 없으면 이 자리에서
   새로 만들 수 있습니다. 약관에 동의하면 연결됩니다.
4. [platform.claude.com/settings/billing](https://platform.claude.com/settings/billing)의
   **Promotional credits**에 금액과 만료일이 보이면 끝입니다. 결제 수단은 등록하지 않아도 됩니다.

> 요금제 하나는 Console 조직 하나에만 연결되고, 한번 연결하면 직접 바꿀 수 없습니다. 앞으로 계속 쓸
> 조직을 고르세요. 설정 화면에 API credits 항목이 보이지 않으면 아직 대상이 아니거나 7일이 지나지
> 않은 것입니다.

## 2단계: API 키 만들기

1. [platform.claude.com](https://platform.claude.com)에서 1단계에서 연결한 조직을 엽니다.
2. **Settings > API Keys**에서 **Create Key**를 누릅니다.
3. 이름을 `storyboard`처럼 알아볼 수 있게 짓고 만듭니다.
4. 키는 `sk-ant-`로 시작하는 긴 문자열이며 **이 화면에서만 한 번** 보입니다. 바로 복사해 두세요.
   잃어버리면 지우고 새로 만들면 됩니다.

같은 조직의 모든 키가 한 크레딧 잔액을 나눠 씁니다. Storyboard 전용으로 지출을 묶어 두고 싶다면
Console에서 **워크스페이스**를 하나 만들어 그 안에서 키를 만들고, 워크스페이스에 **지출 한도**를
걸어 두세요.

## 3단계: Storyboard에 연결하기

세 앱 중 하나에서 한 번만 넣으면 됩니다. 키는 이 컴퓨터의 `~/.storyboard/secrets.json`에 저장되고
세 앱이 함께 씁니다.

**데스크톱 앱**: 첫 실행 마법사의 **AI 연결** 화면에서 서비스로 **Claude**를 고르고 키를 붙여 넣은 뒤
**연결하기**를 누릅니다. 나중에 바꾸려면 설정 화면의 **API 키** 칸입니다.

**CLI**: 터미널에서 다음을 실행하고 안내를 따릅니다. 키는 입력해도 화면에 보이지 않습니다.

```bash
storyboard setup --provider claude
```

이미 설정을 마쳤고 키만 바꾸려면 다음 명령입니다.

```bash
storyboard apikey set claude
```

**VS Code 확장**: 명령 팔레트에서 **Storyboard: 설정 열기**를 실행하고 Claude 카드에 키를 입력한 뒤
저장합니다.

연결이 됐는지는 어느 앱에서나 확인할 수 있습니다. CLI라면 다음 명령이 `API 키` 줄에 **ok**를 보여 주어야
합니다.

```bash
storyboard doctor
```

## 비용 감각

- 크레딧이 **다 떨어지면 요청이 멈춥니다**. Claude 구독에 청구되거나 자동으로 결제되는 일은 없습니다.
  다음 결제 주기에 크레딧이 다시 들어오거나, Console에서 크레딧을 따로 사면 다시 돌아갑니다.
- 그때 Storyboard는 다음 문구가 든 오류로 실패합니다. 키 문제가 아니라 잔액 문제입니다.

  ```text
  Your credit balance is too low to access the Anthropic API.
  ```

- 쓴 양은 Console의 [Cost](https://platform.claude.com/cost) 페이지에서 봅니다.
- 한 번의 생성이 쓸 수 있는 상한을 작품마다 걸어 둘 수 있습니다. 작품 폴더 안에서 다음을 실행하면
  그 작품의 실행이 상한에서 멈춥니다.

  ```bash
  storyboard config set budget.run.limitUsd 20
  ```

- 모델은 비용 차이가 큽니다. 기본값인 `claude-sonnet-5`로 시작해 결과가 아쉬운 단계만
  `claude-opus-5-5` 같은 상위 모델로 올리는 편이 크레딧을 오래 씁니다.

## 자주 하는 질문

**Claude Code에 로그인돼 있는데 키 없이 그걸로 쓰면 안 되나요?**
Anthropic은 구독 로그인을 Claude Code와 자사 앱의 통상적인 사용에 한정하고, 다른 프로그램이 그
구독으로 요청을 보내는 것은 허용하지 않습니다. Storyboard가 공식적으로 안내하는 길은 API 키뿐입니다.

**Pro 요금제인데요.**
Pro에는 API 크레딧이 없습니다. 같은 절차로 키를 만들 수는 있지만 Console에 결제 수단을 등록하고
쓴 만큼 내야 합니다.

**키를 다른 사람과 나눠 써도 되나요?**
안 됩니다. 키와 계정 자격은 Anthropic 약관상 본인만 쓸 수 있습니다.

## 원문

- [API credits for Max and Team plans](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers) — Claude Platform 문서
- [API credits for Max and Team plans](https://support.claude.com/en/articles/17154008-api-credits-for-max-and-team-plans) — 고객 지원 문서
- [Claude Code: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) — 인증 방식별 허용 범위
